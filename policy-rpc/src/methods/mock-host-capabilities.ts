import {
  RpcMethodError,
  type JsonObject,
  type NowMs,
} from "../types.js";
import { isRecord } from "../validation.js";

const MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export function createClockNowMethod(nowMs: NowMs = Date.now) {
  return async (rawParams: unknown): Promise<JsonObject> => {
    expectParamsObject(rawParams, "clock.now");

    return { nowTs: Math.floor(nowMs() / 1000) };
  };
}

export function createApprovalAllowanceMethod() {
  return async (rawParams: unknown): Promise<JsonObject> => {
    const params = expectParamsObject(rawParams, "approval.allowance");
    const allowance = optionalUnsignedIntegerString(params.allowance, "allowance") ?? "0";
    const requested = optionalUnsignedIntegerString(
      params.requested_amount,
      "requested_amount",
    );

    return {
      allowance,
      coversRequestedAmount: requested === undefined ? false : bigintGte(allowance, requested),
      hasUnlimitedAllowance: allowance === MAX_UINT256,
    };
  };
}

export function createApprovalCoverInputsMethod() {
  return async (rawParams: unknown): Promise<JsonObject> => {
    const params = expectParamsObject(rawParams, "approval.cover_inputs");
    const override = optionalBoolean(params.allowances_cover_inputs, "allowances_cover_inputs");
    const allowance = optionalUnsignedIntegerString(params.allowance, "allowance");
    const requested = optionalUnsignedIntegerString(
      params.requested_amount,
      "requested_amount",
    );
    const hasUnlimitedAllowance = allowance === MAX_UINT256;
    const allowancesCoverInputs =
      override ?? (allowance !== undefined && requested !== undefined
        ? bigintGte(allowance, requested)
        : true);

    return {
      allowancesCoverInputs,
      hasUnlimitedAllowance,
    };
  };
}

export function createPortfolioBalanceMethod() {
  return async (rawParams: unknown): Promise<JsonObject> => {
    const params = expectParamsObject(rawParams, "portfolio.balance");
    const balance = optionalUnsignedIntegerString(params.balance, "balance") ?? "0";

    return { balance };
  };
}

export function createPortfolioInputFractionBpsMethod() {
  return async (rawParams: unknown): Promise<JsonObject> => {
    const params = expectParamsObject(rawParams, "portfolio.input_fraction_bps");
    const bps = optionalSafeInteger(params.bps, "bps") ?? 0;

    return { bps };
  };
}

export function createOracleEffectiveRateBpsMethod() {
  return async (rawParams: unknown): Promise<JsonObject> => {
    const params = expectParamsObject(rawParams, "oracle.effective_rate_bps");
    const bps = optionalSafeInteger(params.bps, "bps") ?? 10_000;

    return { bps };
  };
}

export function createStatWindowSnapshotMethod() {
  return async (rawParams: unknown): Promise<JsonObject> => {
    const params = expectParamsObject(rawParams, "stat_window.snapshot");
    const values = isRecord(params.values) ? (params.values as JsonObject) : {};

    return { values };
  };
}

export function createStatWindowSwapStatsMethod() {
  return async (rawParams: unknown): Promise<JsonObject> => {
    const params = expectParamsObject(rawParams, "stat_window.swap_stats");
    const swapVolumeUsd24h =
      optionalDecimalString(params.swap_volume_usd_24h, "swap_volume_usd_24h") ?? "0.0000";
    const swapCount24h = optionalSafeInteger(params.swap_count_24h, "swap_count_24h") ?? 0;

    return {
      swapVolumeUsd24h,
      swapCount24h,
    };
  };
}

function expectParamsObject(value: unknown, method: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RpcMethodError("invalid_params", `${method} params must be an object`);
  }

  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new RpcMethodError("invalid_params", `${label} must be a boolean`);
  }

  return value;
}

function optionalSafeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RpcMethodError("invalid_params", `${label} must be a safe integer`);
  }

  return value;
}

function optionalUnsignedIntegerString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new RpcMethodError(
      "invalid_params",
      `${label} must be an unsigned integer string`,
    );
  }

  return value;
}

function optionalDecimalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new RpcMethodError("invalid_params", `${label} must be a decimal string`);
  }

  return value;
}

function bigintGte(left: string, right: string): boolean {
  return BigInt(left) >= BigInt(right);
}
