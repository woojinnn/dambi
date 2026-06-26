import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolve relative to THIS file, not process.cwd(): passes whether vitest runs
// from the browser-extension root or from dashboard/ (cwd doubled the path).
const here = dirname(fileURLToPath(import.meta.url));

describe("ProfilePage marketplace links", () => {
  it("encodes server-provided listing slugs before building dashboard routes", () => {
    const source = readFileSync(join(here, "ProfilePage.tsx"), "utf8");

    expect(source).toContain("`/market/${encodeURIComponent(l.slug)}`");
    expect(source).not.toContain("`/market/${l.slug}`");
  });
});
