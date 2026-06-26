import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolve relative to THIS file, not process.cwd(): the suite must pass whether
// vitest runs from the browser-extension root or from dashboard/ (cwd-based
// paths doubled to dashboard/dashboard/… and failed when run from dashboard/).
const publicJsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../public/editor-v3/js",
);

function readPublicJs(name: string): string {
  return readFileSync(join(publicJsDir, name), "utf8");
}

function loadPublicCedar(): {
  missingRequiredHoleLabels: (
    def: unknown,
    params?: Record<string, unknown>,
  ) => string[];
  canStaticBindDef: (def: unknown, params?: Record<string, unknown>) => boolean;
} {
  const source = readPublicJs("cedar.js");
  const win: Record<string, unknown> = {};
  const load = new Function("window", `${source}\nreturn window.Cedar;`);
  return load(win) as ReturnType<typeof loadPublicCedar>;
}

describe("editor-v3 static iframe runtime", () => {
  it("preflights publish payloads instead of assuming legacy skeleton.model", () => {
    const publishFiles = ["editor2.js", "listpage.js", "wallet.js"];
    for (const name of publishFiles) {
      const source = readPublicJs(name);

      expect(source).not.toMatch(/Cedar\.serializeCedar\(\s*d\.skeleton\.model/);
      expect(source).not.toMatch(/\b(defs|members)\.map\(renderMember\)/);
      expect(source).toContain("Cedar.publishMembersFromDefs");
      expect(source).toContain("Cedar.rejectUnsupportedPublish");
    }
  });

  it("renders severity chips without directly dereferencing legacy skeleton.model", () => {
    for (const name of ["list.js", "wallet.js"]) {
      const source = readPublicJs(name);

      expect(source).not.toContain("d.skeleton.model.severity");
      expect(source).toContain("Cedar.defSeverity(d)");
    }
  });

  it("keeps IR-only policies out of static publish payloads", () => {
    const cedar = readPublicJs("cedar.js");

    expect(cedar).toContain("function publishMemberFromDef(def)");
    expect(cedar).toContain("const cedarText = raw || (model ?");
    expect(cedar).toContain("if (!cedarText) return null");
    expect(cedar).toContain("unsupported.push(def)");
  });

  it("preflights static apply for required holes before binding", () => {
    const cedar = readPublicJs("cedar.js");
    const editor2 = readPublicJs("editor2.js");

    expect(cedar).toContain("function missingRequiredHoleLabels(def, params)");
    expect(cedar).toContain("function isValidRequiredHoleValue(type, value)");
    expect(cedar).toContain("function canStaticBindDef(def, params)");
    expect(cedar).toContain("function rejectUnsupportedApply(defOrDefs)");
    expect(editor2).not.toContain("const m = def.skeleton.model");
    expect(editor2).toContain("if (!m) return Cedar.missingRequiredHoleLabels(def).length > 0");
    expect(editor2).toContain("if (!Cedar.canStaticBindDef(def)) return Cedar.rejectUnsupportedApply(def)");
    expect(editor2).toContain("if (unsupported.length > 0) return Cedar.rejectUnsupportedApply(unsupported)");
  });

  it("matches policy-store required-hole type validation in static apply preflight", () => {
    const cedar = loadPublicCedar();
    const def = {
      displayName: "typed holes",
      defaults: {
        params: {
          okAddress: "0xa100000000000000000000000000000000000001",
          okSet: ["0xa100000000000000000000000000000000000001"],
          okLong: 7,
          okDecimal: "1.2500",
          okString: "value",
          okBool: false,
          okField: { field: "context.leverage" },
          badAddress: "0xabc",
          badSet: [],
          badLong: 1.5,
          badDecimal: "1",
          badString: " ",
          badField: { field: "" },
          missingBool: undefined,
        },
      },
      holes: [
        { name: "okAddress", type: "address", required: true },
        { name: "okSet", type: "addressSet", required: true },
        { name: "okLong", type: "long", required: true },
        { name: "okDecimal", type: "decimal", required: true },
        { name: "okString", type: "string", required: true },
        { name: "okBool", type: "bool", required: true },
        { name: "okField", type: "field", required: true },
        { name: "badAddress", type: "address", label: "bad address", required: true },
        { name: "badSet", type: "addressSet", label: "bad set", required: true },
        { name: "badLong", type: "long", label: "bad long", required: true },
        { name: "badDecimal", type: "decimal", label: "bad decimal", required: true },
        { name: "badString", type: "string", label: "bad string", required: true },
        { name: "badField", type: "field", label: "bad field", required: true },
        { name: "missingBool", type: "bool", label: "missing bool", required: true },
      ],
    };

    expect(cedar.missingRequiredHoleLabels(def)).toEqual([
      "bad address",
      "bad set",
      "bad long",
      "bad decimal",
      "bad string",
      "bad field",
      "missing bool",
    ]);
    expect(cedar.canStaticBindDef(def)).toBe(false);
  });

  it("opens binding edits through the parent route without iframe nav state", () => {
    const editor2 = readPublicJs("editor2.js");

    expect(editor2).not.toContain("b.modelOverride || def.skeleton.model");
    expect(editor2).not.toContain("newPolicy:");
    expect(editor2).toContain("`/editor/${encodeURIComponent(def.id)}?wallet=${address}&binding=${encodeURIComponent(b.id)}`");
  });

  it("passes explicit iframe navigation state to the parent bridge", () => {
    const shell = readPublicJs("shell.js");

    expect(shell).toContain("const state = opts && opts.state ? opts.state : void 0");
    expect(shell).toContain("...state ? { state } : {}");
  });
});
