/** Step 1 — pick wallets (card grid). Each card shows the wallet's donut
 *  allocation + positions/approvals, and a toggle to include it in the run. */
import { useTranslation } from "react-i18next";

import { WalletDonutCard } from "./WalletDonutCard";
import type { SimController } from "./useSimController";

export function Step1Wallets({ c }: { c: SimController }) {
  const { t } = useTranslation("simulation");
  const selCount = c.selected.size;
  return (
    <div className="sw-step sw-step-wide">
      <header className="sw-step-head sw-step-head-row">
        <div className="sw-step-head-tx">
          <h2>{t("wizard.step1.title")}</h2>
          <p>{t("wizard.step1.desc")}</p>
        </div>
        <div className="sw-wallnote">
          <span className="sw-wallnote-n">{selCount}</span>
          <span>{t("wizard.step1.includedCount")}</span>
        </div>
      </header>

      <div className="sw-wallstack">
        {c.wallets.map((w) => {
          const s = c.statesByAddr[w.address];
          if (!s) return null;
          return (
            <WalletDonutCard
              key={w.address}
              s={s}
              on={c.selected.has(w.address)}
              onToggle={() => c.toggleWallet(w.address)}
            />
          );
        })}
      </div>
    </div>
  );
}
