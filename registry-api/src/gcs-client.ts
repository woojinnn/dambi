/**
 * registry-api — private GCS bucket reader.
 *
 * proxy 는 PRIVATE 버킷 (Public Access Prevention enforced, allUsers binding
 * 없음) 에서 object 를 읽는다. 인증 없는 fetch 로는 불가. google-auth-library
 * 가 ambient SA 의 OAuth access token 을 ADC 로 발급하고, Cloud Run 에선 ADC
 * 가 key 파일 없이 runtime SA 로 resolve 된다. GCS access itself uses the
 * JSON API media endpoint to keep the proxy dependency surface small.
 *
 * ObjectReader 인터페이스 뒤에 둬서 HTTP 서버를 in-memory fake 로 unit-test
 * 가능 — 테스트는 실제 GCS / ADC 를 안 건드린다.
 */
import { GoogleAuth } from "google-auth-library";

export interface ObjectFound {
  kind: "found";
  body: Buffer;
  contentType: string;
}
export interface ObjectNotFound {
  kind: "not_found";
}
export interface ObjectUpstreamError {
  kind: "upstream_error";
  message: string;
}
export type ObjectResult = ObjectFound | ObjectNotFound | ObjectUpstreamError;

export interface ObjectReader {
  read(objectName: string): Promise<ObjectResult>;
}

type GcsErrorClass = "not_found" | "upstream_error";
type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<Pick<Response, "arrayBuffer" | "ok" | "status" | "statusText">>;

interface AccessTokenProvider {
  getAccessToken(): Promise<string | null | undefined>;
}

const GCS_READ_SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";

/**
 * throw 된 GCS error 분류. 404 (object 없음) 는 정상·예상 결과 — registry 에
 * 그 callkey entry 가 없다는 뜻. 그 외 (403=IAM misconfig, 5xx, network) 는
 * upstream fault.
 */
export function classifyGcsError(error: unknown): GcsErrorClass {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === 404 || code === "404") return "not_found";
  return "upstream_error";
}

export interface GcsObjectReaderOptions {
  bucketName: string;
  auth?: AccessTokenProvider; // 테스트 주입용
  fetchImpl?: FetchLike; // 테스트 주입용
}

export class GcsObjectReader implements ObjectReader {
  private readonly auth: AccessTokenProvider;
  private readonly bucketName: string;
  private readonly fetchImpl: FetchLike;

  constructor(o: GcsObjectReaderOptions) {
    this.auth = o.auth ?? new GoogleAuth({ scopes: [GCS_READ_SCOPE] });
    this.bucketName = o.bucketName;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  async read(objectName: string): Promise<ObjectResult> {
    try {
      const token = await this.auth.getAccessToken();
      if (!token) {
        return { kind: "upstream_error", message: "GCS auth token unavailable" };
      }
      const response = await this.fetchImpl(
        gcsMediaUrl(this.bucketName, objectName),
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );
      if (response.status === 404) return { kind: "not_found" };
      if (!response.ok) {
        return {
          kind: "upstream_error",
          message: `GCS read failed: ${response.status} ${response.statusText}`,
        };
      }
      const body = Buffer.from(await response.arrayBuffer());
      return {
        kind: "found",
        body,
        // registry object 는 항상 JSON; builder 가 .json 만 쓴다.
        // 저장된 object metadata 는 신뢰하지 않는다.
        contentType: "application/json; charset=utf-8",
      };
    } catch (error) {
      if (classifyGcsError(error) === "not_found") return { kind: "not_found" };
      const message = error instanceof Error ? error.message : "GCS read failed";
      return { kind: "upstream_error", message };
    }
  }
}

export function gcsMediaUrl(bucketName: string, objectName: string): string {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(
    bucketName,
  )}/o/${encodeURIComponent(objectName)}?alt=media`;
}
