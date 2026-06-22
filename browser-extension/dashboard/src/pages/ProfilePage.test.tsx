import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ProfilePage marketplace links", () => {
  it("encodes server-provided listing slugs before building dashboard routes", () => {
    const source = readFileSync(
      join(process.cwd(), "dashboard/src/pages/ProfilePage.tsx"),
      "utf8",
    );

    expect(source).toContain("`/market/${encodeURIComponent(l.slug)}`");
    expect(source).not.toContain("`/market/${l.slug}`");
  });
});
