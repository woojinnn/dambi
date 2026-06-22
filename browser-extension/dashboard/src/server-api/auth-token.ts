const TOKEN_MAX_BYTES = 16_384;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

export function normalizeAuthToken(
  value: unknown,
  label = "auth token",
): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > TOKEN_MAX_BYTES ||
    value.trim() !== value ||
    CONTROL_CHARS_RE.test(value)
  ) {
    throw new Error(`${label} must be a non-empty token string`);
  }
  return value;
}
