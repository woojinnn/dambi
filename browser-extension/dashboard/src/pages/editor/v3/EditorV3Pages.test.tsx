// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorV3ListPage } from "./EditorV3Pages";

const navigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("../../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { user_id: "user_1" } }),
}));

vi.mock("../../../server-api/dashboard", () => ({
  getDashboardSummary: vi.fn(async () => ({ wallets: [] })),
}));

function renderEditorV3() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EditorV3ListPage />
    </QueryClientProvider>,
  );
}

function dispatchEditorMessage(
  source: MessageEventSource | null,
  data: unknown,
  origin = window.location.origin,
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin,
      source,
    }),
  );
}

describe("EditorV3 iframe open-policy bridge", () => {
  afterEach(() => {
    cleanup();
    navigate.mockReset();
  });

  it("accepts same-origin open-policy messages only from the embedded iframe", () => {
    const { container } = renderEditorV3();
    const iframe = container.querySelector("iframe");
    expect(iframe?.contentWindow).toBeTruthy();

    dispatchEditorMessage(iframe!.contentWindow, {
      source: "dambi-editor-v3",
      type: "open-policy",
      to: "/editor/policy-1?wallet=0xabc&binding=binding-1",
    });

    expect(navigate).toHaveBeenCalledWith(
      "/editor/policy-1?wallet=0xabc&binding=binding-1",
    );
  });

  it("rejects forged source windows and non-editor destinations", () => {
    const { container } = renderEditorV3();
    const iframe = container.querySelector("iframe");
    expect(iframe?.contentWindow).toBeTruthy();

    const payload = {
      source: "dambi-editor-v3",
      type: "open-policy",
      to: "/editor/policy-1",
    };
    dispatchEditorMessage(window, payload);
    dispatchEditorMessage(iframe!.contentWindow, payload, "https://evil.test");
    dispatchEditorMessage(iframe!.contentWindow, {
      ...payload,
      to: "/market",
    });
    dispatchEditorMessage(iframe!.contentWindow, {
      ...payload,
      to: "https://evil.test/editor/policy-1",
    });

    expect(navigate).not.toHaveBeenCalled();
  });
});
