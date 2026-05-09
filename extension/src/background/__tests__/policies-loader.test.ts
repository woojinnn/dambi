import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const localStore = new Map<string, unknown>();
  return {
    localStore,
    installPolicies: vi.fn(
      async (_input: { schema_text: string; policy_set: { id: string; text: string }[] }) => {},
    ),
    aggregatedPolicySet: vi.fn(async () => [] as { id: string; text: string }[]),
    fetchedDefaults: '[]',
    fetchedSchema: '',
    browser: {
      runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localStore.get(key) })),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(entries)) localStore.set(k, v);
          }),
        },
      },
    },
  };
});

vi.mock('webextension-polyfill', () => ({ default: mocks.browser }));
vi.mock('../wasm-bridge', () => ({ installPolicies: mocks.installPolicies }));
vi.mock('../marketplace/storage', () => ({
  aggregatedPolicySet: mocks.aggregatedPolicySet,
  listInstalled: vi.fn(async () => []),
}));

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith('policy-set.json')) return new Response(mocks.fetchedDefaults);
  return new Response(mocks.fetchedSchema);
});
vi.stubGlobal('fetch', fetchMock);

const A = '@id("default::dex/a") @severity("deny") @reason("a") forbid (principal, action, resource);';
const B = '@id("default::dex/b") @severity("warn") @reason("b") forbid (principal, action, resource);';
const C = '@id("default::dex/c") @severity("warn") @reason("c") forbid (principal, action, resource);';

describe('policies-loader (filtered install)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.localStore.clear();
    mocks.fetchedDefaults = JSON.stringify([
      { id: 'default::dex/a', text: A },
      { id: 'default::dex/b', text: B },
      { id: 'default::dex/c', text: C },
    ]);
    mocks.fetchedSchema = '';
    mocks.aggregatedPolicySet.mockResolvedValue([]);
    vi.resetModules();
  });

  it('on SW boot, ensureDefaultPoliciesInstalled installs only the storage-enabled subset', async () => {
    mocks.localStore.set('policy-selection:enabled-ids', ['default::dex/a', 'default::dex/c']);
    const { ensureDefaultPoliciesInstalled } = await import('../policies-loader');
    await ensureDefaultPoliciesInstalled();
    expect(mocks.installPolicies).toHaveBeenCalledTimes(1);
    const call = mocks.installPolicies.mock.calls[0][0];
    expect(call.policy_set.map((p: { id: string }) => p.id).sort()).toEqual([
      'default::dex/a',
      'default::dex/c',
    ]);
  });

  it('on SW boot with no enabled-ids, installs an empty policy_set', async () => {
    const { ensureDefaultPoliciesInstalled } = await import('../policies-loader');
    await ensureDefaultPoliciesInstalled();
    expect(mocks.installPolicies).toHaveBeenCalledTimes(1);
    expect(mocks.installPolicies.mock.calls[0][0].policy_set).toEqual([]);
  });

  it('reinstallAllPolicies(ids) installs exactly the passed ids — does NOT re-read storage', async () => {
    // Set storage to simulate a stale or different value than the ids we pass.
    mocks.localStore.set('policy-selection:enabled-ids', ['default::dex/a']);
    const { reinstallAllPolicies } = await import('../policies-loader');
    await reinstallAllPolicies(['default::dex/b', 'default::dex/c']);
    expect(mocks.installPolicies).toHaveBeenCalledTimes(1);
    expect(
      mocks.installPolicies.mock.calls[0][0].policy_set.map((p: { id: string }) => p.id).sort(),
    ).toEqual(['default::dex/b', 'default::dex/c']);
  });

  it('reinstallAllPolicies([]) installs an empty policy_set', async () => {
    const { reinstallAllPolicies } = await import('../policies-loader');
    await reinstallAllPolicies([]);
    expect(mocks.installPolicies).toHaveBeenCalledTimes(1);
    expect(mocks.installPolicies.mock.calls[0][0].policy_set).toEqual([]);
  });

  it('clears installed/inflight on rejection so the next call retries', async () => {
    mocks.installPolicies
      .mockRejectedValueOnce(new Error('install_failed: boom'))
      .mockResolvedValueOnce(undefined);
    const { reinstallAllPolicies } = await import('../policies-loader');
    await expect(reinstallAllPolicies(['default::dex/a'])).rejects.toThrow(/boom/);
    await reinstallAllPolicies(['default::dex/a']);
    expect(mocks.installPolicies).toHaveBeenCalledTimes(2);
  });

  it('aggregatedPolicySet contributions are filtered by ids alongside defaults', async () => {
    mocks.aggregatedPolicySet.mockResolvedValue([
      {
        id: 'acme::v1/guard',
        text: '@id("acme::v1/guard") @severity("warn") @reason("g") forbid (principal, action, resource);',
      },
    ]);
    const { reinstallAllPolicies } = await import('../policies-loader');
    await reinstallAllPolicies(['default::dex/a', 'acme::v1/guard']);
    expect(mocks.installPolicies).toHaveBeenCalledTimes(1);
    const ids = mocks.installPolicies.mock.calls[0][0].policy_set.map(
      (p: { id: string }) => p.id,
    ).sort();
    expect(ids).toEqual(['acme::v1/guard', 'default::dex/a']);
  });
});
