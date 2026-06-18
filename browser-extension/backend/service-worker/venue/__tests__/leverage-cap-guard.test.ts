import { describe, it, expect } from "vitest";
import {
  LEVERAGE_UNEVALUATED_POLICY_ID,
  isHlOrderAction,
  leverageCapUnevaluated,
  leverageUnevaluatedVerdict,
  policiesReadLeverage,
} from "../leverage-cap-guard";

const ORDER = { action: "place_order", market: { symbol: "HYPE" } };
// A real order-leverage cap (the def::market.4563247f… max-leverage warn).
const LEVERAGE_CAP =
  '@id("hl-max-leverage")\nforbid(principal, action == Perp::Action::"PlaceOrder", resource)\n' +
  "when { (context has leverage) && (context.reduceOnly == false) && (!(context.leverage < context.maxLeverage)) };";
const ABSOLUTE_CAP = "forbid() when { context.leverage >= 10 };";
// Policies that read OTHER fields — must NOT count as leverage caps.
const MAXLEV_ONLY = "forbid() when { context.maxLeverage > 20 };";
const LEVTYPE_ONLY = 'forbid() when { context.leverageType == "isolated" };';
const NOTIONAL = 'forbid() when { context.notionalUsd > decimal("100000") };';

describe("leverage-cap-guard", () => {
  it("isHlOrderAction recognises only the place_order body", () => {
    expect(isHlOrderAction(ORDER)).toBe(true);
    expect(isHlOrderAction({ action: "cancel_order" })).toBe(false);
    expect(isHlOrderAction({ action: "change_leverage" })).toBe(false);
    expect(isHlOrderAction(null)).toBe(false);
    expect(isHlOrderAction("place_order")).toBe(false);
  });

  it("policiesReadLeverage matches context.leverage but not maxLeverage/leverageType", () => {
    expect(policiesReadLeverage([{ policy: LEVERAGE_CAP }])).toBe(true);
    expect(policiesReadLeverage([{ policy: ABSOLUTE_CAP }])).toBe(true);
    // precise-field match: these read different enrichment fields, not the cap field
    expect(policiesReadLeverage([{ policy: MAXLEV_ONLY }])).toBe(false);
    expect(policiesReadLeverage([{ policy: LEVTYPE_ONLY }])).toBe(false);
    expect(policiesReadLeverage([{ policy: NOTIONAL }])).toBe(false);
    expect(policiesReadLeverage([])).toBe(false);
    // mixed set: one leverage cap among others -> true
    expect(policiesReadLeverage([{ policy: NOTIONAL }, { policy: ABSOLUTE_CAP }])).toBe(true);
  });

  describe("leverageCapUnevaluated", () => {
    const base = {
      verdictKind: "pass" as const,
      action: ORDER,
      accountLeverage: {} as Record<string, number>,
      bundles: [{ policy: ABSOLUTE_CAP }],
    };

    it("WARNs when pass + order + unresolved leverage + leverage policy installed", () => {
      expect(leverageCapUnevaluated(base)).toBe(true);
    });

    it("does NOT warn when leverage WAS resolved (account_leverage non-empty)", () => {
      expect(leverageCapUnevaluated({ ...base, accountLeverage: { HYPE: 7 } })).toBe(false);
    });

    it("does NOT warn when no leverage-reading policy is installed", () => {
      expect(leverageCapUnevaluated({ ...base, bundles: [{ policy: NOTIONAL }] })).toBe(false);
    });

    it("does NOT override a non-pass verdict (warn/fail left intact)", () => {
      expect(leverageCapUnevaluated({ ...base, verdictKind: "warn" })).toBe(false);
      expect(leverageCapUnevaluated({ ...base, verdictKind: "fail" })).toBe(false);
    });

    it("does NOT warn for a non-order action", () => {
      expect(leverageCapUnevaluated({ ...base, action: { action: "change_leverage" } })).toBe(false);
    });
  });

  it("leverageUnevaluatedVerdict is a user-approvable warn with the synthetic id", () => {
    const v = leverageUnevaluatedVerdict();
    expect(v.kind).toBe("warn");
    expect(v.matched?.[0]?.policy_id).toBe(LEVERAGE_UNEVALUATED_POLICY_ID);
    expect(v.matched?.[0]?.severity).toBe("warn");
    expect(v.matched?.[0]?.reason).toMatch(/did NOT apply/);
  });
});
