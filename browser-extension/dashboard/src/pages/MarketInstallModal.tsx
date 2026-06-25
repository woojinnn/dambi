import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { getListing, pickI18n, type ListingSummary } from "../server-api";
import { getDashboardSummary } from "../server-api/dashboard";
import { getOverview, putPackage, UNCATEGORIZED_PKG } from "../server-api/policy-store";
import { listWallets } from "../server-api/wallets";
import {
  installFormDefs,
  installListingV2,
  installListingWalletOnlyV2,
  type InstallParams,
} from "./market-install-v2";
import { CATEGORY_COLOR, CategoryGlyph, categoryOf } from "./market-domain";
import type { MarketLocale } from "./market-locale";
import {
  ScopeInstallModal,
  type LibraryApply,
  type ScopeFormDef,
  type WalletApply,
} from "./ScopeInstallModal";

function splitCombo(ck: string): [string, string] {
  const i = ck.indexOf("|");
  return [ck.slice(0, i), ck.slice(i + 1)];
}
function Glyph({ d, size, color = "currentColor", sw = 1.8 }: { d: string; size: number; color?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** "받기" 모달 — 공유 ScopeInstallModal 에 리스팅 소스/설치 핸들러만 주입한다. */
export function MarketInstallModal({
  listing,
  locale,
  onClose,
}: {
  listing: ListingSummary;
  locale: MarketLocale;
  onClose: () => void;
}) {
  const ko = locale === "ko";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const detailQ = useQuery({ queryKey: ["market-listing", listing.slug], queryFn: () => getListing(listing.slug) });
  const walletsQ = useQuery({ queryKey: ["wallets"], queryFn: listWallets });
  const overviewQ = useQuery({ queryKey: ["ps2-overview"], queryFn: getOverview });
  const summaryQ = useQuery({ queryKey: ["dashboard-summary"], queryFn: getDashboardSummary });
  const snap = overviewQ.data ?? null;

  const wallets = useMemo(() => {
    const labelOf = new Map(
      (summaryQ.data?.wallets ?? []).map((w) => [w.address.toLowerCase(), w.label ?? null] as const),
    );
    const addrs = new Set([
      ...(walletsQ.data ?? []).map((w) => w.address.toLowerCase()),
      ...Object.keys(snap?.wallets.byAddress ?? {}),
    ]);
    return [...addrs].sort().map((address) => ({
      address,
      label: labelOf.get(address.toLowerCase()) ?? null,
      packages: Object.values(snap?.wallets.byAddress[address]?.packages ?? {})
        .map((p) => ({ id: p.id, displayName: p.displayName }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko")),
    }));
  }, [walletsQ.data, snap, summaryQ.data]);
  const libPackages = useMemo(
    () =>
      Object.values(snap?.library.packages ?? {}).map((p) => ({
        id: p.id,
        // 마켓 다운로드 = 라이브러리 "템플릿" 폴더 선택. UNCAT은 "개별 템플릿"으로
        // 표시해 패키지 컨텍스트의 "미분류"와 구분한다. 일반 폴더는 데이터 그대로
        // (builtin은 재시드로 "기본 안전팩 템플릿").
        displayName: p.id === UNCATEGORIZED_PKG ? "개별 템플릿" : p.displayName,
      })),
    [snap],
  );

  const isSet = listing.kind === "set";
  const name = pickI18n(listing.display_name) || listing.slug;
  const cat = categoryOf(listing.slug);
  const catColor = CATEGORY_COLOR[cat];

  const formDefsQ = useQuery({
    queryKey: ["market-form-defs", listing.slug, detailQ.data?.current_version ?? ""],
    queryFn: () => installFormDefs(detailQ.data!),
    enabled: !!detailQ.data,
  });
  const formDefs: ScopeFormDef[] = useMemo(
    () => (formDefsQ.data ?? []).map((f) => ({ defId: f.defId, defName: f.defName, model: f.model, manifest: f.manifest })),
    [formDefsQ.data],
  );

  const [done, setDone] = useState<{ message: string } | null>(null);
  const mut = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ps2-overview"] });
      await qc.invalidateQueries({ queryKey: ["market-listing", listing.slug] });
    },
  });

  const finishDone = (message: string) => setDone({ message });

  const onApplyWallets = (a: WalletApply) => {
    const paramsByAddressPkg: Record<string, Record<string, InstallParams>> = {};
    const severityByAddressPkg: Record<string, Record<string, Record<string, "deny" | "warn">>> = {};
    for (const ck of Object.keys(a.paramsByCombo)) {
      const [addr, key] = splitCombo(ck);
      (paramsByAddressPkg[addr] ??= {})[key] = a.paramsByCombo[ck];
    }
    for (const ck of Object.keys(a.severityByCombo)) {
      const [addr, key] = splitCombo(ck);
      (severityByAddressPkg[addr] ??= {})[key] = a.severityByCombo[ck];
    }
    mut.mutate(
      () =>
        installListingWalletOnlyV2(detailQ.data!, locale, {
          addresses: a.addresses,
          walletPackages: a.walletPackages,
          walletNewName: a.walletNewName,
          snap: snap!,
          params: {},
          paramsByAddressPkg,
          ...(Object.keys(severityByAddressPkg).length ? { severityByAddressPkg } : {}),
        }),
      {
        onSuccess: () =>
          finishDone(
            ko ? `"${name}"을(를) 지갑 ${a.addresses.length}개에 적용했어요.` : `Applied "${name}" to ${a.addresses.length} wallet(s).`,
          ),
      },
    );
  };

  const onApplyLibrary = (a: LibraryApply) => {
    mut.mutate(
      async () => {
        let pid = a.packageId;
        if (!isSet && pid === "__new__") {
          pid = `pkg::${crypto.randomUUID()}`;
          await putPackage({
            id: pid,
            displayName: a.newPackageName || (ko ? "새 폴더" : "New folder"),
            source: "mine",
            updatedAtMs: Date.now(),
          });
        }
        return installListingV2(detailQ.data!, locale, {
          scope: a.applyToAllNow ? { kind: "all" } : { kind: "library-only" },
          applyToNewWallets: a.applyToNewWallets,
          packageId: isSet || pid === UNCATEGORIZED_PKG || pid === "__new__" ? null : pid,
          params: a.libParams,
          snap,
        });
      },
      {
        onSuccess: () =>
          finishDone(ko ? `"${name}"을(를) 정책 라이브러리에 추가했어요.` : `Added "${name}" to your library.`),
      },
    );
  };

  const icon = isSet ? (
    <Glyph d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8" size={22} color="var(--blue-700)" sw={1.7} />
  ) : (
    <CategoryGlyph category={cat} size={22} color={catColor.hex} />
  );

  return (
    <ScopeInstallModal
      open
      ko={ko}
      icon={icon}
      kindLabel={isSet ? (ko ? "패키지" : "Package") : ko ? "정책" : "Policy"}
      title={name}
      walletOptTitle={ko ? "지갑 전용 설정으로 받기" : "Per-wallet settings"}
      walletOptDesc={ko ? "고른 지갑의 패키지에 적용하며 받아요. 템플릿은 라이브러리에도 보여요." : "Apply to the chosen wallets' packages. The template stays in the Library too."}
      libraryOptTitle={ko ? "라이브러리로 받기" : "Into the library"}
      libraryOptDesc={ko ? "여러 지갑에서 함께 쓰는 공용 템플릿으로 저장 — 언제든 적용할 수 있어요." : "Saved as a shared template you can apply later."}
      formDefs={formDefs}
      formDefsLoading={!detailQ.data || formDefsQ.isLoading}
      wallets={wallets}
      libPackages={libPackages}
      libraryIsSet={isSet}
      busy={mut.isPending}
      error={mut.isError ? (mut.error as Error).message : null}
      onApplyWallets={onApplyWallets}
      onApplyLibrary={onApplyLibrary}
      onClose={onClose}
      done={
        done
          ? {
              message: done.message,
              primaryLabel: ko ? "지갑별 정책 보기" : "View wallet policies",
              onPrimary: () => navigate("/editor2"),
            }
          : null
      }
    />
  );
}
