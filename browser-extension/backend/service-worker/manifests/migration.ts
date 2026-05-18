// V0 → V1 policy migration helper (D10).
//
// Before Phase 5, enriched fields lived at the top level of `context`
// (e.g. `context.totalInputUsd.value`). The Phase-5 enriched schema
// moves them under `context.custom`, so any user policies authored
// against the v0 layout have to be rewritten.
//
// This module only does the string-level rewrite + tracks pending
// migrations; the actual atomic re-install is glued together by the
// SDK / SW handler that calls `rewritePolicyText`, loads the managed
// policy, and pushes the rewritten text through `dashboard:put-raw`.

import Browser from "webextension-polyfill";

export const KEY_PENDING_MIGRATION = "migration:pending";

/**
 * Rewrite a Cedar policy text from the v0 `context.<field>` layout to
 * the v1 `context.custom.<field>` layout for the supplied
 * `knownFields`. For each known field that appears as a direct
 * `context.<field>` reference:
 *
 * 1. Every `context.<field>` occurrence becomes `context.custom.<field>`.
 * 2. The `when { ... }` body gets a single `context.custom has <field>`
 *    guard prepended (conservative — fail-open at runtime if the field
 *    is missing).
 *
 * Fields that don't appear in the source are left alone, so passing a
 * superset of known fields is safe. Identifiers not in `knownFields`
 * are never touched.
 *
 * The rewrite is idempotent: a policy already using
 * `context.custom.<field>` will not be modified, and a policy that
 * already has the `context.custom has <field>` guard will keep exactly
 * one guard.
 */
export function rewritePolicyText(
  text: string,
  knownFields: readonly string[],
): string {
  let out = text;
  for (const field of knownFields) {
    if (!isAsciiIdent(field)) continue;

    // Match `context.<field>` where `<field>` is followed by a non-
    // identifier character. Excludes `context.custom.<field>` (already
    // migrated) by requiring the preceding char to NOT be ".custom"
    // (we use a lookahead-style guard via a tiny tokenizer below).
    const directRef = new RegExp(
      `(^|[^.\\w])context\\.${field}(?![\\w])`,
      "g",
    );
    if (!directRef.test(out)) continue;
    // Reset the regex since we test()ed and want to replace().
    directRef.lastIndex = 0;
    out = out.replace(directRef, (_match, prefix: string) => {
      return `${prefix}context.custom.${field}`;
    });

    // Add exactly one `context.custom has <field> &&` guard inside each
    // `when { ... }` body that doesn't already declare the guard.
    out = addHasGuardForField(out, field);
  }
  return out;
}

function isAsciiIdent(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

function addHasGuardForField(text: string, field: string): string {
  const guard = `context.custom has ${field}`;
  // For each `when {` opener, prepend the guard if the immediately-
  // following body doesn't already contain it.
  return text.replace(/when\s*\{/g, (match, offset) => {
    // Look at the body until the closing brace to decide if the guard
    // is already there.
    const rest = text.slice(offset);
    const closeIdx = findMatchingClose(rest);
    if (closeIdx === -1) return match;
    const body = rest.slice(0, closeIdx + 1);
    if (body.includes(guard)) return match;
    return `${match} ${guard} && `;
  });
}

function findMatchingClose(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Policy ids waiting to be migrated. Populated when the SW boots and
 * notices a managed-policy text that still uses the v0 layout. The
 * dashboard's migration banner reads this list to surface the action
 * to the user.
 */
export async function listPending(): Promise<string[]> {
  const r = (await Browser.storage.local.get(KEY_PENDING_MIGRATION)) as Record<
    string,
    unknown
  >;
  const raw = r[KEY_PENDING_MIGRATION];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export async function setPending(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    await Browser.storage.local.remove(KEY_PENDING_MIGRATION);
    return;
  }
  await Browser.storage.local.set({ [KEY_PENDING_MIGRATION]: [...ids] });
}
