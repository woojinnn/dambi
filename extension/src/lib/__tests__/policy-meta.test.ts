import { describe, expect, it } from 'vitest';
import { parsePolicyMeta } from '@lib/policy-meta';

describe('parsePolicyMeta', () => {
  it('parses a single-rule entry with @id, @severity, @reason', () => {
    const text = `@id("user/no-zero-min-output")
@severity("deny")
@reason("Min output of 0 disables slippage protection")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has minOutputUsd && context.minOutputUsd == 0
};
`;
    const meta = parsePolicyMeta(text);
    expect(meta.shortId).toBe('user/no-zero-min-output');
    expect(meta.rules).toEqual([
      { severity: 'deny', reason: 'Min output of 0 disables slippage protection' },
    ]);
    expect(meta.dominantSeverity).toBe('deny');
  });

  it('parses an entry with multiple forbid clauses, each with its own annotations', () => {
    const text = `@id("a/x")
@severity("warn")
@reason("warn case")
forbid (principal, action, resource) when { 1 == 1 };
@id("a/x")
@severity("deny")
@reason("deny case")
forbid (principal, action, resource) when { 1 == 2 };
`;
    const meta = parsePolicyMeta(text);
    expect(meta.rules).toEqual([
      { severity: 'warn', reason: 'warn case' },
      { severity: 'deny', reason: 'deny case' },
    ]);
    expect(meta.dominantSeverity).toBe('deny');
  });

  it('falls back to unknown severity and a default reason when annotations are missing', () => {
    const text = `forbid (principal, action, resource);`;
    const meta = parsePolicyMeta(text);
    expect(meta.shortId).toBe('');
    expect(meta.rules).toEqual([
      { severity: 'unknown', reason: '(no reason annotation)' },
    ]);
    expect(meta.dominantSeverity).toBe('unknown');
  });

  it('promotes deny over warn over unknown for dominantSeverity', () => {
    const text = `@severity("warn") @reason("w") forbid (principal, action, resource);
@severity("unknown") @reason("u") forbid (principal, action, resource);`;
    expect(parsePolicyMeta(text).dominantSeverity).toBe('warn');
  });
});
