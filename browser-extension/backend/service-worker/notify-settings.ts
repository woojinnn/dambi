/**
 * 알림 강도 설정의 SW 단일 소스.
 *
 * 팝업 설정 오버레이(`frontend/popup/popup.js` renderSettingsOverlay)가
 * `chrome.storage.sync` 의 `"settings"` 키에 `{preset, desk, modal, ribbon, sound}`
 * 를 저장한다. 이 모듈은 그 값을 SW 쪽에서 읽어 캐시하고, OS 데스크톱 알림 ·
 * 인페이지 토스트(리본) · WARN 인터셉트 모달을 사용자 설정대로 게이팅한다.
 *
 * 순환 import 회피: `webextension-polyfill` 만 의존하므로 index 와 orchestrator
 * 양쪽에서 안전하게 import 할 수 있다(둘 다 표시 게이팅에 쓴다).
 *
 * 표시 전용 advisory 정책: 이 모듈은 알림 "표시 여부" 만 결정한다. WARN 모달
 * 게이팅(`shouldWarnModal`)도 FAIL 차단에는 절대 관여하지 않는다(호출자가 FAIL
 * 모달을 항상 띄움).
 */

import Browser from "webextension-polyfill";

export type DeskLevel = "block" | "both" | "all";
export type ModalLevel = "block" | "both";

export interface NotifySettings {
  preset: string;
  /** OS 데스크톱 알림 강도. block=차단(FAIL)만, both=+검토(WARN), all=+요약 등. */
  desk: DeskLevel;
  /** 서명 직전 인터셉트 모달. block=차단(FAIL)만, both=+검토(WARN). */
  modal: ModalLevel;
  /** 인페이지 토스트("상단 리본 배너") 표시 on/off. */
  ribbon: boolean;
  /** 차단 시 알림음 — 현재 미구현(범위 외). */
  sound: boolean;
}

// frontend/popup/store.js 의 SETTINGS_PRESETS.std + SETTINGS_DEFAULT 와 동일하게
// 유지할 것. 두 곳의 기본값이 어긋나면 첫 로드 시 게이팅이 UI 표시와 달라진다.
export const NOTIFY_DEFAULTS: NotifySettings = {
  preset: "std",
  desk: "both",
  modal: "both",
  ribbon: true,
  sound: false,
};

const STORAGE_KEY = "settings";

let cache: NotifySettings = { ...NOTIFY_DEFAULTS };
let loaded: Promise<NotifySettings> | null = null;

/** 저장된 raw 값을 안전한 NotifySettings 로 정규화(미지정/이상값은 기본값). */
function coerce(raw: unknown): NotifySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<NotifySettings>;
  return {
    preset: typeof r.preset === "string" ? r.preset : NOTIFY_DEFAULTS.preset,
    desk:
      r.desk === "block" || r.desk === "both" || r.desk === "all"
        ? r.desk
        : NOTIFY_DEFAULTS.desk,
    modal:
      r.modal === "block" || r.modal === "both" ? r.modal : NOTIFY_DEFAULTS.modal,
    ribbon: typeof r.ribbon === "boolean" ? r.ribbon : NOTIFY_DEFAULTS.ribbon,
    sound: typeof r.sound === "boolean" ? r.sound : NOTIFY_DEFAULTS.sound,
  };
}

/**
 * 설정을 1회 로드해 캐시(idempotent). 첫 tx 가 캐시 선로딩보다 빨라도 게이팅이
 * 기본값으로 새지 않도록, 게이팅 직전에 await 해서 쓴다.
 */
export function ensureLoaded(): Promise<NotifySettings> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const got = (await Browser.storage.sync.get(STORAGE_KEY)) as Record<
          string,
          unknown
        >;
        cache = coerce(got[STORAGE_KEY]);
      } catch {
        cache = { ...NOTIFY_DEFAULTS };
      }
      return cache;
    })();
  }
  return loaded;
}

/** 동기 캐시 반환(이미 로드됐다는 가정 — 미로드면 기본값). */
export function getNotifySettings(): NotifySettings {
  return cache;
}

// 라이브 갱신: 팝업이 설정을 저장하면 sync onChanged 로 즉시 캐시 반영 →
// 다음 tx 부터 새 게이팅 적용(SW 재시작 불필요). storage.onChanged 가 없는
// 환경(테스트 목 등)에서도 import 가 깨지지 않도록 방어 — 그 경우 라이브 갱신만
// 비활성화되고 게이팅은 ensureLoaded 로 정상 동작한다.
try {
  Browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const ch = changes[STORAGE_KEY];
    if (!ch) return;
    cache = coerce(ch.newValue);
  });
} catch {
  /* storage.onChanged 미지원 — best-effort */
}

// 모듈 로드 시 1회 선로딩(best-effort) — 이후 ensureLoaded 는 캐시 재사용.
void ensureLoaded();

export type NotifySeverity = "fail" | "warn" | "summary" | "system";

/**
 * OS 데스크톱 알림을 표시할지 — desk 단계 × 심각도.
 *  - fail:    block · both · all 모두에서 표시
 *  - warn:    both · all 에서 표시
 *  - summary: all 에서만 표시(주간 요약은 가장 약한 신호)
 *  - system:  세션 만료 등 안전·시스템 통지 → 게이팅 없이 항상 표시
 */
export function shouldDesktop(sev: NotifySeverity): boolean {
  const { desk } = cache;
  switch (sev) {
    case "system":
      return true;
    case "fail":
      return desk === "block" || desk === "both" || desk === "all";
    case "warn":
      return desk === "both" || desk === "all";
    case "summary":
      return desk === "all";
    default:
      return true;
  }
}

/** 인페이지 토스트("상단 리본 배너")를 표시할지. */
export function shouldRibbon(): boolean {
  return cache.ribbon;
}

/**
 * WARN 인터셉트 모달을 띄울지. FAIL 모달은 호출자가 항상 띄우므로 여기 미관여.
 * modal="block"(차단만)이면 WARN 은 모달 없이 자동 진행(advisory 알림은 별도).
 */
export function shouldWarnModal(): boolean {
  return cache.modal === "both";
}
