import { describe, expect, it } from "vitest";
import { parseHoleInput, formatHoleValue } from "./hole-params";

describe("hole input (HoleSpec.type별)", () => {
  it("long/decimal parse + reject non-numeric", () => {
    expect(parseHoleInput("long", "42")).toEqual({ ok: true, value: 42 });
    expect(parseHoleInput("long", "42.9").ok).toBe(false);
    expect(parseHoleInput("long", "9007199254740993").ok).toBe(false);
    expect(parseHoleInput("decimal", "1.5")).toEqual({ ok: true, value: "1.5" });
    expect(parseHoleInput("decimal", "3")).toEqual({ ok: true, value: "3.0" });
    expect(parseHoleInput("long", "abc").ok).toBe(false);
    expect(parseHoleInput("decimal", "").ok).toBe(false);
  });

  it("addressSet splits/trims/lowercases lines", () => {
    expect(
      parseHoleInput(
        "addressSet",
        "0xA1c4000000000000000000000000000000007E29\n 0x91D2000000000000000000000000000000000001 \n",
      ),
    ).toEqual({
      ok: true,
      value: [
        "0xa1c4000000000000000000000000000000007e29",
        "0x91d2000000000000000000000000000000000001",
      ],
    });
    expect(parseHoleInput("addressSet", "").ok).toBe(false);
    expect(parseHoleInput("addressSet", "0xAB").ok).toBe(false);
  });

  it("bool/string/address pass through", () => {
    expect(parseHoleInput("bool", "true")).toEqual({ ok: true, value: true });
    expect(parseHoleInput("bool", "false")).toEqual({ ok: true, value: false });
    expect(parseHoleInput("address", "0xA1c4000000000000000000000000000000007E29")).toEqual({
      ok: true,
      value: "0xa1c4000000000000000000000000000000007e29",
    });
    expect(parseHoleInput("address", "0xAB").ok).toBe(false);
    expect(parseHoleInput("string", "hi")).toEqual({ ok: true, value: "hi" });
    expect(parseHoleInput("string", " ").ok).toBe(false);
  });

  it("formatHoleValue is the display inverse", () => {
    expect(formatHoleValue(["0xab", "0xcd"])).toBe("0xab\n0xcd");
    expect(formatHoleValue(42)).toBe("42");
    expect(formatHoleValue(true)).toBe("true");
    expect(formatHoleValue(undefined)).toBe("");
  });
});
