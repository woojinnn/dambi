import { useEffect, useState } from "react";

/**
 * Split a comma-separated set string into the normalized array the policy model
 * stores: trimmed, non-empty, in order. (Duplicates are kept — the form mirrors
 * what the user typed; Cedar `in` de-dupes at evaluation.)
 */
export function parseSet(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Free-text editor for a string `in [...]` set (e.g. market symbols
 * "DOGE, kPEPE, kSHIB").
 *
 * The committed model holds the normalized array (see {@link parseSet}), but the
 * visible text is a LOCAL DRAFT buffer. Decoupling the edit buffer from the
 * normalized model is the whole point: a separator typed at the end (", ") must
 * not be normalized away on the same keystroke. The old code rendered
 * `value={values.join(", ")}` and re-parsed on every change, so typing a trailing
 * comma produced `["DOGE", ""]` → `filter(Boolean)` dropped the empty tail →
 * the controlled input re-rendered as "DOGE" and the comma "ate itself". You
 * could only place a comma BETWEEN two existing tokens. This mirrors the decimal
 * field's raw-onChange / normalize-later pattern.
 */
export function SetInput({
  values,
  invalid,
  placeholder,
  onChange,
}: {
  values: string[];
  /** 형식 오류 표시(빨간 테두리). */
  invalid?: boolean;
  placeholder?: string;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState(() => values.join(", "));

  // Re-sync the draft when `values` changes from OUTSIDE (a revert, or the parent
  // swapping in a different condition leaf). Ignore the echo of our own edits: if
  // the current draft already parses to the incoming values, leave it untouched
  // so an in-progress separator survives.
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    setDraft((cur) => (JSON.stringify(parseSet(cur)) === valuesKey ? cur : values.join(", ")));
    // `values` is fully captured by `valuesKey`; adding the array identity would
    // re-run this on every keystroke for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey]);

  return (
    <input
      className={`pf-val wide${invalid ? " invalid" : ""}`}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseSet(e.target.value));
      }}
      placeholder={placeholder}
    />
  );
}
