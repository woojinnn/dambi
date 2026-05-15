// Mirror of the JSON shapes the WASM bridge produces / consumes.
// Source of truth: crates/policy-builder-wasm/src/lib.rs and
// crates/policy-builder/src/types.rs (serde-derived).

export type CedarType =
  | "long"
  | "string"
  | "bool"
  | "decimal"
  | "set_of_string"
  | "set_of_long";

export type OperatorArity = "one" | "many" | "none";

export interface OperatorMeta {
  id: string;
  label: string;
  arity: OperatorArity;
}

export interface FieldSchema {
  path: string;
  type: CedarType;
  optional: boolean;
  parentPath?: string;
  parentOptional: boolean;
  label?: string;
  operators: OperatorMeta[];
}

export interface ActionSchema {
  action: string;
  principalType: string;
  resourceType: string;
  fields: FieldSchema[];
}

export type Severity = "deny" | "warn";

export type PredicateValue =
  | { kind: "single"; value: string }
  | { kind: "multi"; values: string[] }
  | { kind: "none" };

export interface Predicate {
  field: string;
  op: string;
  /** Serialized to the untagged `PredicateValue` shape Rust expects. */
  value: string | string[] | null;
}

export interface PolicyRule {
  id: string;
  action: string;
  severity: Severity;
  reason: string;
  predicates: Predicate[];
}

export interface EnvelopeError {
  kind: string;
  message: string;
  predicate_index?: number;
}

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: EnvelopeError;
}

export interface CompileSuccess {
  cedar_text: string;
}
