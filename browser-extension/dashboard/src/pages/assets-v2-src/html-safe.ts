const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

export function safeClassToken(value: unknown, fallback = ""): string {
  const token = String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return token || fallback;
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function safeCssColor(value: unknown, fallback = "#9099A5"): string {
  const raw = String(value ?? "").trim();
  if (/^#[0-9A-Fa-f]{3,8}$/.test(raw)) return raw;
  if (/^[A-Za-z]+$/.test(raw)) return raw;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/.test(raw)) return raw;
  return fallback;
}
