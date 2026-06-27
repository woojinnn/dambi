import { describe, it, expect, vi } from "vitest";

// 제어 가능한 sync 스토리지 + onChanged 레지스트리로 webextension-polyfill 목.
// vi.hoisted: vi.mock 팩토리는 import 위로 호이스팅되므로, 공유 상태도 같이
// 호이스팅해야 모듈이 등록한 onChanged 리스너가 같은 배열에 들어간다.
const h = vi.hoisted(() => ({
  store: { settings: undefined as unknown },
  changedListeners: [] as Array<
    (changes: Record<string, { newValue?: unknown }>, area: string) => void
  >,
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      sync: {
        get: vi.fn(async (key: string) => ({ [key]: h.store.settings })),
      },
      onChanged: {
        addListener: (
          cb: (
            changes: Record<string, { newValue?: unknown }>,
            area: string,
          ) => void,
        ) => h.changedListeners.push(cb),
      },
    },
  },
}));

import {
  ensureLoaded,
  getNotifySettings,
  shouldDesktop,
  shouldRibbon,
  shouldWarnModal,
  NOTIFY_DEFAULTS,
} from "../notify-settings";

/** 등록된 onChanged 리스너에 sync 변경을 흘려보내 캐시를 동기 갱신. */
function emitSettings(newValue: unknown): void {
  for (const cb of h.changedListeners) cb({ settings: { newValue } }, "sync");
}

describe("notify-settings", () => {
  it("storage 미설정이면 std 기본값으로 시작한다", async () => {
    const loaded = await ensureLoaded();
    expect(loaded).toEqual(NOTIFY_DEFAULTS);
    expect(getNotifySettings()).toEqual(NOTIFY_DEFAULTS);
  });

  it("std(both/both/ribbon) 게이팅", () => {
    emitSettings({ preset: "std", desk: "both", modal: "both", ribbon: true });
    expect(shouldDesktop("fail")).toBe(true);
    expect(shouldDesktop("warn")).toBe(true);
    expect(shouldDesktop("summary")).toBe(false); // summary 는 all 에서만
    expect(shouldDesktop("system")).toBe(true); // system 은 항상
    expect(shouldRibbon()).toBe(true);
    expect(shouldWarnModal()).toBe(true);
  });

  it("quiet(block/block/no-ribbon) 게이팅", () => {
    emitSettings({
      preset: "quiet",
      desk: "block",
      modal: "block",
      ribbon: false,
    });
    expect(shouldDesktop("fail")).toBe(true); // block 도 FAIL 은 표시
    expect(shouldDesktop("warn")).toBe(false);
    expect(shouldDesktop("summary")).toBe(false);
    expect(shouldDesktop("system")).toBe(true); // 세션 만료는 quiet 에서도 표시
    expect(shouldRibbon()).toBe(false);
    expect(shouldWarnModal()).toBe(false); // WARN 모달 생략 → 자동 진행
  });

  it("loud(all/both/ribbon) 게이팅 — summary 까지 표시", () => {
    emitSettings({ preset: "loud", desk: "all", modal: "both", ribbon: true });
    expect(shouldDesktop("fail")).toBe(true);
    expect(shouldDesktop("warn")).toBe(true);
    expect(shouldDesktop("summary")).toBe(true);
    expect(shouldRibbon()).toBe(true);
    expect(shouldWarnModal()).toBe(true);
  });

  it("이상값/부분값은 기본값으로 보정한다", () => {
    emitSettings({ desk: "nonsense", ribbon: "yes" });
    const s = getNotifySettings();
    expect(s.desk).toBe(NOTIFY_DEFAULTS.desk);
    expect(s.modal).toBe(NOTIFY_DEFAULTS.modal);
    expect(s.ribbon).toBe(NOTIFY_DEFAULTS.ribbon);
  });
});
