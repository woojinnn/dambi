// @vitest-environment node

import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLayoutModes } from "./layout-modes";

let dom: JSDOM | null = null;

function installDom(): void {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://dashboard.example.test/",
  });
  const win = dom.window;
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    MessageEvent: win.MessageEvent,
  });
}

function host(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div id="mode-chrome"></div>
    <section class="mod-sec" data-sec="holdings"><div class="sec-head"></div></section>
    <section class="mod-sec" data-sec="approvals"><div class="sec-head"></div></section>
    <section class="mod-sec" data-sec="hl"><div class="sec-head"></div></section>
    <section class="mod-sec" data-sec="pending"><div class="sec-head"></div></section>
  `;
  document.body.appendChild(root);
  return root;
}

function editModeMessage(type: string, origin: string): MessageEvent {
  return new window.MessageEvent("message", {
    data: { type },
    origin,
    source: window.parent as MessageEventSource,
  });
}

describe("layout edit-host postMessage boundary", () => {
  beforeEach(() => {
    installDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (globalThis.window) {
      document.body.innerHTML = "";
      window.PASU_EDIT_HOST = undefined;
      window.PASU_TWEAKS = undefined;
      window.PASU_getSummary = undefined;
    }
    dom?.window.close();
    dom = null;
  });

  it("posts edit-host availability to the same origin only", () => {
    window.PASU_EDIT_HOST = true;
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);

    const teardown = initLayoutModes(host());

    expect(postMessage).toHaveBeenCalledWith(
      { type: "__edit_mode_available" },
      "https://dashboard.example.test",
    );

    teardown();
  });

  it("accepts edit-host control messages only from the same-origin parent", () => {
    window.PASU_EDIT_HOST = true;
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);

    const teardown = initLayoutModes(host());
    const panel = document.getElementById("tw-panel") as HTMLElement;
    expect(panel.hidden).toBe(true);

    window.dispatchEvent(editModeMessage("__activate_edit_mode", "https://attacker.example"));
    expect(panel.hidden).toBe(true);

    window.dispatchEvent(editModeMessage("__activate_edit_mode", window.location.origin));
    expect(panel.hidden).toBe(false);

    window.dispatchEvent(editModeMessage("__deactivate_edit_mode", window.location.origin));
    expect(panel.hidden).toBe(true);

    teardown();
  });
});
