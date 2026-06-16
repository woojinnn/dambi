import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { addWallet, ServerError, type AddWalletResp } from "../server-api";

import { Modal } from "./Modal";

interface AddWalletModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful add. Parent can show a toast / refetch. */
  onAdded?: (resp: AddWalletResp) => void;
}

/** Chains tracked for a newly added wallet. The UI tracks ALL of these (no
 *  per-chain toggle) — the list is shown read-only and sent verbatim. */
const CHAIN_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "eip155:1", label: "Ethereum" },
  { id: "eip155:42161", label: "Arbitrum" },
  { id: "eip155:8453", label: "Base" },
  { id: "eip155:10", label: "Optimism" },
  { id: "eip155:137", label: "Polygon" },
];

const ADDR_RX = /^0x[0-9a-fA-F]{40}$/;

export function AddWalletModal({ open, onClose, onAdded }: AddWalletModalProps) {
  const { t } = useTranslation("common");
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [touched, setTouched] = useState(false);

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
        chains: CHAIN_OPTIONS.map((c) => c.id),
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
