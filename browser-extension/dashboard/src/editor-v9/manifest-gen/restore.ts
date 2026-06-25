import {
  ENRICHMENT_FIELDS,
  type CustomType,
  type EnrichmentRegistry,
} from "./registry";

/** Convert manifest output/custom_context spellings into registry type spelling. */
export function normalizeCustomType(raw: unknown): CustomType | null {
  switch (raw) {
    case "decimal":
    case "Decimal":
      return "decimal";
    case "Long":
    case "Bool":
    case "String":
      return raw;
    default:
      return null;
  }
}

function paramsRecord(raw: unknown): EnrichmentRegistry[string]["params"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as EnrichmentRegistry[string]["params"];
}

/** Restore non-built-in context.custom fields from a saved policy manifest.
 *
 * `context.custom.<X>` is bound by each output's `field`, not by `policy_rpc.id`.
 * The type canonically lives in `custom_context.fields` (`decimal`), while
 * output projections use capitalized spellings (`Decimal`), so both are accepted.
 */
export function userFieldsFromManifest(
  manifest: unknown,
  actionTag: string | null,
): EnrichmentRegistry {
  const out: EnrichmentRegistry = {};
  const m = manifest as
    | {
        policy_rpc?: unknown;
        custom_context?: { fields?: Record<string, unknown> };
      }
    | null
    | undefined;
  if (!m || !Array.isArray(m.policy_rpc)) return out;

  const customContextTypes = m.custom_context?.fields ?? {};
  for (const raw of m.policy_rpc) {
    const rpc = raw as {
      method?: unknown;
      params?: unknown;
      outputs?: unknown;
    };
    if (typeof rpc?.method !== "string" || !Array.isArray(rpc.outputs)) continue;

    for (const rawOutput of rpc.outputs) {
      const output = rawOutput as {
        kind?: unknown;
        field?: unknown;
        type?: unknown;
        from?: unknown;
      };
      if (output?.kind !== "context" || typeof output.field !== "string") continue;

      const field = output.field;
      if (field in ENRICHMENT_FIELDS) continue;

      const type =
        normalizeCustomType(customContextTypes[field]) ??
        normalizeCustomType(output.type);
      if (!type) continue;

      out[field] = {
        type,
        label: { ko: field, en: field },
        appliesTo: actionTag ? [actionTag] : [],
        method: rpc.method,
        projection: typeof output.from === "string" ? output.from : "$.result.value",
        params: paramsRecord(rpc.params),
      };
    }
  }
  return out;
}
