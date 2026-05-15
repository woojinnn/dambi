// localStorage-backed CRUD for user-authored policies.
//
// Persisted shape (one JSON blob under STORAGE_KEY):
//   { "<rule.id>": { rule: PolicyRule, enabled: boolean, savedAt: number } }
//
// Rule id is the storage key; saving a rule with an existing id replaces
// the previous entry (the UI confirms this via the saved-list rendering).

import type { PolicyRule } from "./types";

export interface SavedPolicy {
  rule: PolicyRule;
  enabled: boolean;
  /** Unix ms — for stable display ordering when the user hasn't intervened. */
  savedAt: number;
}

const STORAGE_KEY = "policy-builder/saved";

function readAll(): Record<string, SavedPolicy> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SavedPolicy>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Corrupt blob — drop it rather than break the page. The user can
    // re-save any policy they still need.
    return {};
  }
}

function writeAll(record: Record<string, SavedPolicy>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

/** All saved policies, sorted by `savedAt` ascending (oldest first). */
export function list(): SavedPolicy[] {
  return Object.values(readAll()).sort((a, b) => a.savedAt - b.savedAt);
}

/** Persist (upsert) one policy. Returns the saved entry. */
export function save(rule: PolicyRule, enabled: boolean = true): SavedPolicy {
  const record = readAll();
  const existing = record[rule.id];
  const entry: SavedPolicy = {
    rule,
    enabled: existing?.enabled ?? enabled,
    savedAt: existing?.savedAt ?? Date.now(),
  };
  record[rule.id] = entry;
  writeAll(record);
  return entry;
}

/** Toggle the `enabled` flag for one policy. No-op if id absent. */
export function toggle(id: string): void {
  const record = readAll();
  const entry = record[id];
  if (!entry) return;
  entry.enabled = !entry.enabled;
  writeAll(record);
}

/** Remove one policy. No-op if id absent. */
export function remove(id: string): void {
  const record = readAll();
  delete record[id];
  writeAll(record);
}

/** Look up one policy by id. */
export function get(id: string): SavedPolicy | undefined {
  return readAll()[id];
}

/** Subset of policies whose `enabled` is true, sorted oldest-first. */
export function enabledOnly(): SavedPolicy[] {
  return list().filter((p) => p.enabled);
}
