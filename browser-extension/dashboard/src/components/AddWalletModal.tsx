import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { addWallet, listSyncChains, ServerError, type AddWalletResp } from "../server-api";

import { Modal } from "./Modal";

interface AddWalletModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful add. Parent can show a toast / refetch. */
  onAdded?: (resp: AddWalletResp) => void;
}

const ADDR_RX = /^0x[0-9a-fA-F]{40}$/;

const CHAIN_LABELS: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:10": "Optimism",
  "eip155:137": "Polygon",
  "eip155:8453": "Base",
  "eip155:42161": "Arbitrum",
};

function chainLabel(chain: string): string {
  return CHAIN_LABELS[chain] ?? chain;
}

export function AddWalletModal({ open, onClose, onAdded }: AddWalletModalProps) {
  const { t } = useTranslation("common");
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [touched, setTouched] = useState(false);
  const syncChainsQ = useQuery({
    queryKey: ["capabilities", "sync-chains"],
    queryFn: listSyncChains,
    enabled: open,
    staleTime: 60_000,
  });

  const reset = () => {
    setAddress("");
    setLabel("");
    setTouched(false);
  };

  const addressOk = ADDR_RX.test(address.trim());
  const labelOk = label.trim().length > 0;

  const mut = useMutation({
    mutationFn: () =>
      addWallet({
        address: address.trim().toLowerCase(),
        label: label.trim(),
      }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      onAdded?.(resp);
      // Keep modal open so user sees the sync result. They close it manually.
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!addressOk || !labelOk) return;
    mut.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!mut.isPending) {
          reset();
          onClose();
        }
      }}
      title={t("wallet.addTitle")}
      footer={
        mut.data ? (
          <button className="btn primary" onClick={() => window.location.reload()}>{t("confirm")}</button>
        ) : (
          <>
            <button className="btn" type="button" onClick={onClose} disabled={mut.isPending}>
              {t("cancel")}
            </button>
            <button className="btn primary" type="submit" form="add-wallet-form" disabled={mut.isPending || !addressOk || !labelOk}>
              {mut.isPending ? t("wallet.adding") : t("add")}
            </button>
          </>
        )
      }
    >
      {mut.data ? (
        <div style={{ padding: "8px 0 4px", textAlign: "center", fontSize: 15, fontWeight: 600 }}>
          {t("wallet.addSuccess")}
        </div>
      ) : (
      <form id="add-wallet-form" onSubmit={onSubmit}>
        <div className="form-row">
          <label htmlFor="aw-addr">{t("wallet.addressLabel")}</label>
          <input
            id="aw-addr"
            type="text"
            placeholder="0x0000000000000000000000000000000000000000"
            autoComplete="off"
            spellCheck={false}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => setTouched(true)}
            style={{ fontFamily: "var(--ff-mono)" }}
          />
          {touched && !addressOk && (
            <div className="err">{t("wallet.addressInvalid")}</div>
          )}
        </div>

        <div className="form-row">
          <label>{t("wallet.chainsLabel")}</label>
          <div className="chain-chip-row" aria-live="polite">
            {syncChainsQ.data?.chains.length ? (
              syncChainsQ.data.chains.map((chain) => (
                <span key={chain} className="chain-chip">
                  {chainLabel(chain)}
                </span>
              ))
            ) : (
              <span className="chain-chip muted">
                {syncChainsQ.isLoading ? t("loading") : t("wallet.chainsServerDefault")}
              </span>
            )}
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            {t("wallet.chainsHint")}
          </div>
        </div>

        <div className="form-row">
          <label htmlFor="aw-label">{t("wallet.label")}</label>
          <input
            id="aw-label"
            type="text"
            placeholder={t("wallet.labelPlaceholder")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          {touched && !labelOk && (
            <div className="err">{t("wallet.labelRequired")}</div>
          )}
        </div>

        {mut.error && (
          <div className="err" style={{ marginTop: 8 }}>
            {t("wallet.addFailed")}&nbsp;
            {mut.error instanceof ServerError
              ? `${mut.error.status} ${String(mut.error.body)}`
              : String(mut.error)}
          </div>
        )}
      </form>
      )}
    </Modal>
  );
}
