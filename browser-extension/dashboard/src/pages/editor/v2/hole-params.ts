/** HoleSpec.type별 입력 문자열 ↔ HoleValue 직렬화(순수). */
import { normalizeDecimal } from "../../../cedar/form";
import { i18n } from "../../../i18n";
import type { HoleSpec, HoleValue } from "../../../server-api/policy-store";

export type HoleParse = { ok: true; value: HoleValue } | { ok: false; error: string };

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function parseHoleInput(type: HoleSpec["type"], raw: string): HoleParse {
  const t = raw.trim();
  switch (type) {
    case "long": {
      if (!t) return { ok: false, error: i18n.t("editor:holes.numberRequired") };
      if (!/^-?\d+$/.test(t)) return { ok: false, error: i18n.t("editor:holes.numberRequired") };
      const n = Number(t);
      if (!Number.isSafeInteger(n)) return { ok: false, error: i18n.t("editor:holes.numberRequired") };
      return { ok: true, value: n };
    }
    case "decimal": {
      const normalized = normalizeDecimal(t);
      if (normalized === null) return { ok: false, error: i18n.t("editor:holes.numberRequired") };
      return { ok: true, value: normalized };
    }
    case "bool":
      return { ok: true, value: t === "true" };
    case "address":
      return EVM_ADDRESS_RE.test(t)
        ? { ok: true, value: t.toLowerCase() }
        : { ok: false, error: i18n.t("editor:holes.addressRequired") };
    case "addressSet": {
      const values = t.split(/[\s,]+/).filter(Boolean);
      if (values.length === 0 || !values.every((v) => EVM_ADDRESS_RE.test(v))) {
        return { ok: false, error: i18n.t("editor:holes.addressRequired") };
      }
      return { ok: true, value: values.map((v) => v.toLowerCase()) };
    }
    case "string":
      return t
        ? { ok: true, value: t }
        : { ok: false, error: i18n.t("editor:holes.valueRequired") };
    case "field":
      return t
        ? { ok: true, value: { field: t } }
        : { ok: false, error: i18n.t("editor:holes.fieldPathRequired") };
  }
}

export function formatHoleValue(v: HoleValue | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? v.map(String).join("\n") : String(v);
}
