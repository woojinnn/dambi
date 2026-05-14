// Policy Builder UI.
//
// Boot order:
// 1. Load WASM bridge.
// 2. Fetch action list + selected action's schema.
// 3. Hydrate saved-policies + enabled-set panels from localStorage.
//
// State lives in module-scoped variables: the loaded schema, the in-flight
// predicate rows being edited, and (read-through) the localStorage-backed
// saved policy list. Saved policies are the source of truth — the editor
// is just a staging area until "Save policy" persists.

import type {
  ActionSchema,
  FieldSchema,
  OperatorMeta,
  PolicyRule,
  Predicate,
  Severity,
} from "./types";
import { compilePolicy, getActionSchema, listActions, WasmCallError } from "./wasm";
import * as storage from "./storage";
import type { SavedPolicy } from "./storage";

interface PredicateRow {
  fieldPath: string;
  opId: string;
  /** Raw textual input; the compile call interprets it per operator arity. */
  rawValue: string;
}

let currentSchema: ActionSchema | null = null;
let predicates: PredicateRow[] = [];

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element: #${id}`);
  return el as T;
};

const ruleIdInput = $<HTMLInputElement>("rule-id");
const actionSelect = $<HTMLSelectElement>("rule-action");
const reasonInput = $<HTMLInputElement>("rule-reason");
const predicatesContainer = $<HTMLDivElement>("predicates");
const addPredicateBtn = $<HTMLButtonElement>("add-predicate");
const compileBtn = $<HTMLButtonElement>("compile");
const saveBtn = $<HTMLButtonElement>("save");
const statusEl = $<HTMLSpanElement>("status");
const outputEl = $<HTMLPreElement>("output");
const errorEl = $<HTMLDivElement>("error");
const savedListEl = $<HTMLDivElement>("saved-list");
const savedSummaryEl = $<HTMLSpanElement>("saved-summary");
const enabledOutputEl = $<HTMLPreElement>("enabled-output");
const copyEnabledBtn = $<HTMLButtonElement>("copy-enabled");
const copyStatusEl = $<HTMLSpanElement>("copy-status");

async function boot() {
  try {
    const actions = await listActions();
    if (actions.length === 0) {
      showError("No actions registered in the schema registry.");
      return;
    }
    actionSelect.innerHTML = actions
      .map((a) => `<option value="${a}">${a}</option>`)
      .join("");
    await loadSchema(actions[0]!);
    await renderSaved();
  } catch (e) {
    showError(formatError(e));
  }

  actionSelect.addEventListener("change", () => {
    void loadSchema(actionSelect.value);
  });
  addPredicateBtn.addEventListener("click", () => addPredicate());
  compileBtn.addEventListener("click", () => void onPreview());
  saveBtn.addEventListener("click", () => void onSave());
  copyEnabledBtn.addEventListener("click", () => void onCopyEnabled());
}

async function loadSchema(action: string) {
  try {
    currentSchema = await getActionSchema(action);
    predicates = [];
    renderPredicates();
    clearError();
  } catch (e) {
    showError(formatError(e));
  }
}

function addPredicate() {
  if (!currentSchema || currentSchema.fields.length === 0) return;
  const firstField = currentSchema.fields[0]!;
  predicates.push({
    fieldPath: firstField.path,
    opId: firstField.operators[0]?.id ?? "",
    rawValue: "",
  });
  renderPredicates();
}

function removePredicate(index: number) {
  predicates.splice(index, 1);
  renderPredicates();
}

function fieldByPath(path: string): FieldSchema | undefined {
  return currentSchema?.fields.find((f) => f.path === path);
}

function defaultOpFor(field: FieldSchema): string {
  return field.operators[0]?.id ?? "";
}

function renderPredicates() {
  predicatesContainer.innerHTML = "";
  if (predicates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "No predicates. An empty rule is an unconditional forbid (matches every request).";
    predicatesContainer.appendChild(empty);
    return;
  }
  predicates.forEach((row, index) => {
    predicatesContainer.appendChild(renderRow(row, index));
  });
}

function renderRow(row: PredicateRow, index: number): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "predicate";

  const fieldLabel = document.createElement("label");
  fieldLabel.textContent = "Field";
  const fieldSelect = document.createElement("select");
  fieldSelect.innerHTML = (currentSchema?.fields ?? [])
    .map(
      (f) =>
        `<option value="${f.path}" ${f.path === row.fieldPath ? "selected" : ""}>${
          f.label ?? f.path
        }</option>`,
    )
    .join("");
  fieldSelect.addEventListener("change", () => {
    const newField = fieldByPath(fieldSelect.value);
    row.fieldPath = fieldSelect.value;
    if (newField) row.opId = defaultOpFor(newField);
    row.rawValue = "";
    renderPredicates();
  });
  fieldLabel.appendChild(fieldSelect);

  const field = fieldByPath(row.fieldPath);
  const ops: OperatorMeta[] = field?.operators ?? [];

  const opLabel = document.createElement("label");
  opLabel.textContent = "Operator";
  const opSelect = document.createElement("select");
  opSelect.innerHTML = ops
    .map(
      (o) =>
        `<option value="${o.id}" ${o.id === row.opId ? "selected" : ""}>${o.label}</option>`,
    )
    .join("");
  opSelect.addEventListener("change", () => {
    row.opId = opSelect.value;
    row.rawValue = "";
    renderPredicates();
  });
  opLabel.appendChild(opSelect);

  const valueLabel = document.createElement("label");
  const op = ops.find((o) => o.id === row.opId);
  const hint = valueHint(field?.type, op?.arity);
  valueLabel.textContent = hint.label;
  if (op?.arity === "none") {
    const placeholder = document.createElement("span");
    placeholder.textContent = "(no value)";
    placeholder.style.color = "var(--muted)";
    placeholder.style.padding = "8px 10px";
    valueLabel.appendChild(placeholder);
  } else {
    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.placeholder = hint.placeholder;
    valueInput.value = row.rawValue;
    valueInput.addEventListener("input", () => {
      row.rawValue = valueInput.value;
    });
    valueLabel.appendChild(valueInput);
  }

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "Remove";
  removeBtn.className = "remove";
  removeBtn.addEventListener("click", () => removePredicate(index));

  container.append(fieldLabel, opLabel, valueLabel, removeBtn);
  return container;
}

function valueHint(
  cedarType: FieldSchema["type"] | undefined,
  arity: OperatorMeta["arity"] | undefined,
): { label: string; placeholder: string } {
  if (arity === "none") return { label: "Value", placeholder: "" };
  if (arity === "many") {
    return {
      label: "Values (comma-separated)",
      placeholder: cedarType === "set_of_long" ? "1, 137" : "USDC, USDT",
    };
  }
  switch (cedarType) {
    case "long":
      return { label: "Value (integer)", placeholder: "100" };
    case "decimal":
      return { label: "Value (e.g. 100.00)", placeholder: "100.00" };
    case "bool":
      return { label: "Value", placeholder: "" };
    default:
      return { label: "Value", placeholder: "" };
  }
}

function getSelectedSeverity(): Severity {
  const checked = document.querySelector<HTMLInputElement>(
    "input[name=severity]:checked",
  );
  return (checked?.value as Severity) ?? "warn";
}

function setSeverity(severity: Severity) {
  const radio = document.querySelector<HTMLInputElement>(
    `input[name=severity][value=${severity}]`,
  );
  if (radio) radio.checked = true;
}

function buildRule(): PolicyRule {
  if (!currentSchema) throw new Error("schema not loaded");
  return {
    id: ruleIdInput.value.trim(),
    action: currentSchema.action,
    severity: getSelectedSeverity(),
    reason: reasonInput.value,
    predicates: predicates.map((row): Predicate => {
      const field = fieldByPath(row.fieldPath);
      const op = field?.operators.find((o) => o.id === row.opId);
      const arity = op?.arity ?? "one";
      const value =
        arity === "none"
          ? null
          : arity === "many"
            ? row.rawValue
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
            : row.rawValue.trim();
      return { field: row.fieldPath, op: row.opId, value };
    }),
  };
}

async function onPreview() {
  clearError();
  clearStatus();
  try {
    const rule = buildRule();
    const cedar = await compilePolicy(rule);
    outputEl.textContent = cedar;
  } catch (e) {
    outputEl.textContent = "";
    showError(formatError(e));
  }
}

async function onSave() {
  clearError();
  clearStatus();
  try {
    const rule = buildRule();
    // Validate the rule by compiling once before persisting. Failures here
    // surface the same error UI the Preview button uses, so the user knows
    // exactly which predicate is broken.
    const cedar = await compilePolicy(rule);
    outputEl.textContent = cedar;
    storage.save(rule);
    showStatus(`Saved “${rule.id}”.`);
    await renderSaved();
  } catch (e) {
    showError(formatError(e));
  }
}

async function renderSaved() {
  const saved = storage.list();
  savedSummaryEl.textContent =
    saved.length === 0
      ? "(none yet)"
      : `${saved.filter((p) => p.enabled).length} enabled · ${saved.length} total`;

  savedListEl.innerHTML = "";
  if (saved.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "Saved policies appear here. Use Save policy above to add the current rule.";
    savedListEl.appendChild(empty);
  } else {
    for (const entry of saved) {
      savedListEl.appendChild(renderSavedRow(entry));
    }
  }

  await renderEnabledOutput();
}

function renderSavedRow(entry: SavedPolicy): HTMLDivElement {
  const row = document.createElement("div");
  row.className = `saved-row ${entry.enabled ? "enabled" : "disabled"}`;

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "saved-toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = entry.enabled;
  toggle.addEventListener("change", () => {
    storage.toggle(entry.rule.id);
    void renderSaved();
  });
  toggleLabel.appendChild(toggle);
  toggleLabel.append(entry.enabled ? "Enabled" : "Disabled");

  const meta = document.createElement("div");
  meta.className = "saved-meta";
  const id = document.createElement("div");
  id.className = "saved-id";
  id.textContent = entry.rule.id;
  const sub = document.createElement("div");
  sub.className = "saved-sub";
  const predicateCount = entry.rule.predicates.length;
  sub.textContent = `${entry.rule.action} · ${entry.rule.severity} · ${predicateCount} predicate${
    predicateCount === 1 ? "" : "s"
  }`;
  meta.append(id, sub);

  const actions = document.createElement("div");
  actions.className = "saved-actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.textContent = "Edit";
  editBtn.className = "secondary";
  editBtn.addEventListener("click", () => loadIntoForm(entry));
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.className = "remove";
  deleteBtn.addEventListener("click", () => {
    storage.remove(entry.rule.id);
    void renderSaved();
  });
  actions.append(editBtn, deleteBtn);

  row.append(toggleLabel, meta, actions);
  return row;
}

function loadIntoForm(entry: SavedPolicy) {
  if (!currentSchema) return;
  if (entry.rule.action !== currentSchema.action) {
    // Switch action first; the schema reload empties predicates so we then
    // rebuild rows after the schema lands.
    actionSelect.value = entry.rule.action;
    void getActionSchema(entry.rule.action).then((schema) => {
      currentSchema = schema;
      applyRuleToForm(entry.rule);
    });
    return;
  }
  applyRuleToForm(entry.rule);
}

function applyRuleToForm(rule: PolicyRule) {
  ruleIdInput.value = rule.id;
  reasonInput.value = rule.reason;
  setSeverity(rule.severity);
  predicates = rule.predicates.map((p): PredicateRow => {
    const raw =
      p.value === null
        ? ""
        : Array.isArray(p.value)
          ? p.value.join(", ")
          : p.value;
    return { fieldPath: p.field, opId: p.op, rawValue: raw };
  });
  renderPredicates();
  clearError();
  clearStatus();
  outputEl.textContent = "";
}

async function renderEnabledOutput() {
  const enabled = storage.enabledOnly();
  if (enabled.length === 0) {
    enabledOutputEl.textContent =
      "// No enabled policies. Toggle a saved policy above to include it here.";
    return;
  }
  const policy_set: { id: string; text: string }[] = [];
  for (const entry of enabled) {
    try {
      const text = await compilePolicy(entry.rule);
      policy_set.push({ id: entry.rule.id, text });
    } catch (e) {
      policy_set.push({
        id: entry.rule.id,
        text: `// FAILED TO COMPILE: ${formatError(e)}`,
      });
    }
  }
  const payload = { schema_text: "", policy_set };
  enabledOutputEl.textContent = JSON.stringify(payload, null, 2);
}

async function onCopyEnabled() {
  try {
    await navigator.clipboard.writeText(enabledOutputEl.textContent ?? "");
    showCopyStatus("Copied.");
  } catch {
    showCopyStatus("Copy failed — select and copy manually.");
  }
}

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function showStatus(message: string) {
  statusEl.textContent = message;
  statusEl.hidden = false;
  window.setTimeout(() => clearStatus(), 2500);
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
}

function showCopyStatus(message: string) {
  copyStatusEl.textContent = message;
  copyStatusEl.hidden = false;
  window.setTimeout(() => {
    copyStatusEl.hidden = true;
    copyStatusEl.textContent = "";
  }, 2500);
}

function formatError(e: unknown): string {
  if (e instanceof WasmCallError) {
    const prefix = e.predicateIndex !== undefined ? `predicate ${e.predicateIndex}: ` : "";
    return `${prefix}[${e.kind}] ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

void boot();
