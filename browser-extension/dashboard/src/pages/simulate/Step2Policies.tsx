/**
 * Step 2 — pick policies, managed PER WALLET. Ported to the simulation-frontend
 * layout: per-wallet switcher + the wallet's policy packages on the left, the
 * active wallet's state (donut card) on the right. The standalone "library
 * policy" list and the click-to-open policy detail are intentionally omitted.
 *
 * Each package is a collapsible group (closed by default) with a binary
 * green/gray gate toggle; the per-policy checkbox selects which policies the
 * gate activates (checkbox AND gate → effective).
 */
import { useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import { StateDashboard } from "./StateDashboard";
import type { SimController } from "./useSimController";
import type { PolicyView } from "./types";

export function Step2Policies({ c }: { c: SimController }) {
  const { t } = useTranslation("simulation");
  const filtering = c.hasRelevanceFilter;
  // Which packages are expanded — empty by default, so every package renders
  // CLOSED (the policies inside are hidden until you open it). Keyed by id so it
  // survives wallet switches (new wallet's packages start closed too).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="sw-step">
      <header className="sw-step-head">
        <h2>{t("wizard.step2.title")}</h2>
        <p>
          <Trans t={t} i18nKey="wizard.step2.desc" components={{ b: <b /> }} />
        </p>
      </header>

      <WalletSwitcher c={c} />

      <div className="sw-cols">
        <section className="sw-policies">
          <Group title={t("wizard.step2.groupPackages")} hint={t("wizard.step2.groupPackagesHint")}>
            {c.packages.map((pkg) => {
              const open = expanded.has(pkg.id);
              const state = c.packageState(pkg.id);
              // Effective on-count = checked policies when the gate is on (0 otherwise).
              const total = pkg.policyIds.length;
              const onCount =
                state === "on" ? pkg.policyIds.filter((id) => c.isPolicyOn(pkg.id, id)).length : 0;
              const stateLabel =
                onCount === 0
                  ? t("wizard.step2.pkgStateOff")
                  : onCount >= total
                    ? t("wizard.step2.pkgStateOn")
                    : t("wizard.step2.pkgStateSome", { count: onCount });
              return (
                <div key={pkg.id} className={`sw-pkg${open ? " open" : ""}`}>
                  <div className="sw-pkg-head">
                    <button
                      type="button"
                      className="sw-pkg-main"
                      onClick={() => toggleExpand(pkg.id)}
                      aria-expanded={open}
                    >
                      <span className={`sw-pkg-caret${open ? " open" : ""}`} aria-hidden>
                        ›
                      </span>
                      <span className="sw-pkg-name">{pkg.name}</span>
                      <span className="sw-mut">
                        {t("wizard.step2.pkgCount", { count: total })} · {stateLabel}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`sw-pkgtog ${state}`}
                      onClick={() => c.togglePackage(pkg.id)}
                      role="switch"
                      aria-checked={state === "on"}
                      aria-label={pkg.name}
                    >
                      <span className="sw-pkgtog-dot" />
                    </button>
                  </div>
                  {open && (
                    <div className="sw-pkg-kids">
                      {pkg.policyIds
                        .map((id) => c.policies.find((p) => p.id === id))
                        .filter((p): p is PolicyView => Boolean(p))
                        .map((p) => (
                          <PolicyRow
                            key={p.id}
                            p={p}
                            on={c.isPolicyOn(pkg.id, p.id)}
                            toggle={() => c.togglePolicy(pkg.id, p.id)}
                            small
                          />
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </Group>
        </section>

        <aside className="sw-relstate">
          <div className="sw-relstate-head">
            <b>{t("wizard.step2.relatedState")}</b>
            <span className="sw-mut">
              {filtering ? t("wizard.step2.relatedStateFiltering") : t("wizard.step2.relatedStateIdle")}
            </span>
          </div>
          {c.activeState && (
            <StateDashboard
              key={c.activeWallet}
              s={c.activeState}
              entrance={false}
              filter={{
                active: filtering,
                isWidgetRelevant: c.isWidgetRelevant,
                isTokenRelevant: c.isTokenRelevant,
                isProtocolRelevant: c.isProtocolRelevant,
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/** Per-wallet tabs — pick which selected wallet's policy set you're editing.
 *  Always the pill style, even for a single wallet (one "성준 5" pill). */
function WalletSwitcher({ c }: { c: SimController }) {
  const { t } = useTranslation("simulation");
  const sel = c.wallets.filter((w) => c.selected.has(w.address));
  if (sel.length === 0) {
    return (
      <div className="sw-wsw">
        <span className="sw-mut">{t("wizard.step2.noWalletSelected")}</span>
      </div>
    );
  }
  return (
    <div className="sw-wsw">
      {sel.map((w) => (
        <button
          key={w.address}
          type="button"
          className={`sw-wtab${c.activeWallet === w.address ? " on" : ""}`}
          onClick={() => c.setActiveWallet(w.address)}
        >
          <span className="sw-wtab-name">{w.name}</span>
          <span className="sw-wtab-count">{c.enabledCount(w.address)}</span>
        </button>
      ))}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="sw-group">
      <div className="sw-group-head">
        <span className="sw-group-title">{title}</span>
        <span className="sw-mut">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function PolicyRow({ p, on, toggle, small }: { p: PolicyView; on: boolean; toggle: () => void; small?: boolean }) {
  return (
    <label className={`sw-policy${on ? " on" : ""}${small ? " small" : ""}`}>
      <input type="checkbox" checked={on} onChange={toggle} />
      <span className="sw-policy-name">{p.name}</span>
      <span className="sw-policy-action">{p.action}</span>
    </label>
  );
}
