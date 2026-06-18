/* ────────────────────────────────────────────────────────────────────────
 * Mock policy store (ps2) — faithful in-browser re-implementation of the
 * extension's ps2:* message API, backed by localStorage. Same shapes as
 * sdk/policy-store-types.ts. Mutations notify subscribers (replaces the
 * react-query invalidate + SW broadcast pair).
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const LS_KEY = "ps2-regression-test-store";
  const UNCATEGORIZED_PKG = "pkg::uncategorized";

  const uuid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : "x" + Math.random().toString(36).slice(2) + Date.now().toString(36));
  const now = () => Date.now();

  /* ── helpers shared with the UI ── */
  function isEffectiveOn(w, b) {
    return (w.packageEnabled[b.packageId] ?? true) && b.enabled;
  }

  /* ── seed data — realistic Cloudy-Pond DeFi guard policies ── */
  function leaf(fieldPath, op, value, joiner, param) {
    const c = { fieldPath, op, value, joiner: joiner || "and" };
    if (param) c.param = param;
    return c;
  }
  const V = {
    long: (n) => ({ kind: "long", value: n }),
    dec: (s) => ({ kind: "decimal", value: s }),
    str: (s) => ({ kind: "string", value: s }),
    bool: (b) => ({ kind: "bool", value: b }),
    set: (a) => ({ kind: "set", values: a }),
    field: (p) => ({ kind: "field", path: p }),
  };

  function model(trigger, when, severity, reason, unless) {
    return { trigger, when: when || [], unless: unless || [], id: "untitled", severity, reason };
  }
  const ANY = { kind: "any" };
  const act = (entityType, id) => ({ kind: "actionEq", entityType, id });

  function def(opts) {
    return {
      id: opts.id,
      hidden: opts.hidden,
      homeWallet: opts.homeWallet,
      walletFolderId: opts.walletFolderId,
      displayName: opts.displayName,
      cat: opts.cat,
      memo: opts.memo,
      method: opts.method || "form",
      skeleton: { model: opts.model, manifest: opts.manifest, rawCedar: opts.rawCedar },
      holes: opts.holes || [],
      defaults: { enabled: opts.enabled ?? true, params: opts.params || {}, packageId: opts.packageId },
      source: opts.source || "builtin",
      sourceListingId: opts.sourceListingId,
      sourceVersion: opts.sourceVersion,
      updatedAtMs: opts.updatedAtMs ?? now(),
    };
  }

  const WALLET_A = "0xa3731f5e0a4c2b9d8e6f1a0b3c5d7e9f2a4bebec";
  const WALLET_B = "0x3d7e1f0a2b4c6d8e9f0a1b2c3d4e5f6a7b8c9d0e";
  const PKG_DAY1 = "pkg::day1-safety";
  const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
  const BURN_ZERO = "0x0000000000000000000000000000000000000000";
  const BURN_DEAD = "0x000000000000000000000000000000000000dead";

  /* The real "기본 안전팩" (day1-safety) default policy set — verbatim cedar +
   * a representative form model so both tabs render. */
  const DAY1 = [
    {
      id: "permit2-sign-allowance-confirm",
      cat: "token",
      severity: "warn",
      reason: "Signing a Permit2 token allowance — confirm the spender and amount before approving",
      model: model(act("Token::Action", "Permit2Approve"), [], "warn", "Signing a Permit2 token allowance — confirm the spender and amount before approving"),
      rawCedar:
        '@id("permit2-sign-allowance-confirm")\n@severity("warn")\n@reason("Signing a Permit2 token allowance — confirm the spender and amount before approving")\nforbid(\n  principal,\n  action == Token::Action::"Permit2SignAllowance",\n  resource\n);',
    },
    {
      id: "send-first-time-or-burn-recipient-warn",
      cat: "security",
      severity: "deny",
      reason: "This send goes to a burn address (0x000…000 / 0x…dead) — funds sent there are permanently lost",
      model: model(act("Token::Action", "Erc20Transfer"), [leaf("context.recipient", "in", V.set([BURN_ZERO, BURN_DEAD]), "and")], "deny", "This send goes to a burn address (0x000…000 / 0x…dead) — funds sent there are permanently lost"),
      rawCedar:
        '@id("send-first-time-or-burn-recipient-warn")\n@severity("deny")\n@reason("This send goes to a burn address (0x000…000 / 0x…dead) — funds sent there are permanently lost")\nforbid(principal, action == Token::Action::"Erc20Transfer", resource)\nwhen {\n  ["0x0000000000000000000000000000000000000000",\n   "0x000000000000000000000000000000000000dead"].contains(context.recipient)\n};',
    },
    {
      id: "swap-recipient-not-self-deny",
      cat: "swap",
      severity: "deny",
      reason: "This swap sends the bought tokens to an address that is not your wallet",
      model: model(act("Amm::Action", "Swap"), [leaf("context.recipient", "!=", V.field("principal.address"), "and")], "deny", "This swap sends the bought tokens to an address that is not your wallet"),
      rawCedar:
        '@id("swap-recipient-not-self-deny")\n@severity("deny")\n@reason("This swap sends the bought tokens to an address that is not your wallet")\nforbid(principal, action == Amm::Action::"Swap", resource)\nwhen { context.recipient != principal.address };',
    },
    {
      id: "sweep-recipient-not-self-warn",
      cat: "swap",
      severity: "warn",
      reason: "A router sweep/unwrap sends its output to an address that is not your wallet — the swap proceeds may be redirected to someone else",
      model: model(act("Token::Action", "Erc20Transfer"), [leaf("context.recipient", "!=", V.field("principal.address"), "and")], "warn", "A router sweep/unwrap sends its output to an address that is not your wallet — the swap proceeds may be redirected to someone else"),
      rawCedar:
        '@id("sweep-recipient-not-self-warn")\n@severity("warn")\n@reason("A router sweep/unwrap sends its output to an address that is not your wallet — the swap proceeds may be redirected to someone else")\nforbid(principal, action == Token::Action::"Erc20Transfer", resource)\nwhen {\n  context has is_router_egress &&\n  context.is_router_egress &&\n  context.recipient != principal.address\n};',
    },
    {
      id: "unknown-blind-sign-warning",
      cat: "security",
      severity: "warn",
      reason: "",
      model: model(act("Core::Action", "Unknown"), [], "warn", ""),
      rawCedar: '@id("unknown-blind-sign-warning")\n@severity("warn")\nforbid(principal, action == Core::Action::"Unknown", resource);',
    },
    {
      id: "unlimited-approval-deny",
      cat: "security",
      severity: "deny",
      reason: "",
      model: model(act("Token::Action", "Erc20Approve"), [leaf("context.spender", "notIn", V.set([PERMIT2]), "and")], "deny", ""),
      rawCedar:
        '@id("unlimited-approval-deny")\n@severity("deny")\nforbid(principal, action == Token::Action::"Erc20Approve", resource)\nwhen {\n  (context.amount == "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"\n   || context.amount == "0xffffffffffffffffffffffffffffffffffffffff")\n  && !(["0x000000000022d473030f116ddee9f6b43ac78ba3"].contains(context.spender))\n};',
    },
  ];

  function freshSeed() {
    const t = now();
    const day = 24 * 3600_000;

    const defs = {};
    DAY1.forEach((p, i) => {
      defs["def::" + p.id] = def({
        id: "def::" + p.id,
        displayName: p.id, // 실제 확장과 동일하게 슬러그를 표시명으로
        cat: p.cat,
        method: "cedar",
        source: "builtin",
        packageId: PKG_DAY1,
        enabled: true,
        model: p.model,
        rawCedar: p.rawCedar,
        updatedAtMs: t - (i + 1) * day,
      });
    });

    const packages = {
      [PKG_DAY1]: { id: PKG_DAY1, displayName: "기본 안전팩", source: "builtin", updatedAtMs: t - 20 * day },
    };

    // 각 지갑: "기본 안전팩" 패키지에 6개 정책을 바인딩(별칭 없음, 전부 on).
    const mkWallet = () => {
      const walletPkg = "pkg::" + uuid();
      const w = {
        bindings: {},
        packages: { [walletPkg]: { id: walletPkg, displayName: "기본 안전팩", updatedAtMs: t } },
        packageEnabled: {},
        folders: {},
      };
      for (const p of DAY1) {
        const id = "bind::" + uuid();
        w.bindings[id] = { id, defId: "def::" + p.id, packageId: walletPkg, enabled: true, alias: undefined, params: undefined, updatedAtMs: t };
      }
      return w;
    };

    return {
      library: { schemaVersion: 1, defs, packages },
      wallets: { schemaVersion: 1, byAddress: { [WALLET_A]: mkWallet(), [WALLET_B]: mkWallet() } },
      rev: 1,
    };
  }

  /* ── persistence ── */
  let snapshot = load();
  const subs = new Set();

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* ignore */
    }
    const seed = freshSeed();
    persist(seed);
    return seed;
  }
  function persist(s) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch (e) {
      /* ignore quota */
    }
  }
  function commit() {
    snapshot = { ...snapshot, rev: snapshot.rev + 1 };
    persist(snapshot);
    subs.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (e) {
        console.error(e);
      }
    });
  }
  // deep-clone helper so callers can't accidentally mutate the live snapshot
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function subscribe(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }
  function getOverview() {
    return clone(snapshot);
  }

  /* ── library: defs ── */
  function putDef(d) {
    snapshot.library.defs[d.id] = clone(d);
    commit();
  }
  function deleteDef(defId) {
    delete snapshot.library.defs[defId];
    // cascade: drop bindings referencing it
    for (const w of Object.values(snapshot.wallets.byAddress)) {
      for (const [bid, b] of Object.entries(w.bindings)) {
        if (b.defId === defId) delete w.bindings[bid];
      }
    }
    commit();
  }
  function duplicateDef(defId) {
    const src = snapshot.library.defs[defId];
    if (!src) throw new Error("not found");
    const slug = defId.replace(/^def::/, "") + "-copy-" + Math.random().toString(36).slice(2, 6);
    const id = "def::" + slug;
    const copy = clone(src);
    copy.id = id;
    copy.displayName = src.displayName + " (복사)";
    copy.source = "mine";
    copy.hidden = false;
    copy.homeWallet = undefined;
    copy.updatedAtMs = now();
    snapshot.library.defs[id] = copy;
    commit();
    return id;
  }

  /* ── library: packages (folders) ── */
  function putPackage(pkg) {
    snapshot.library.packages[pkg.id] = clone(pkg);
    commit();
  }
  function deletePackage(packageId) {
    delete snapshot.library.packages[packageId];
    for (const d of Object.values(snapshot.library.defs)) {
      if (d.defaults.packageId === packageId) d.defaults.packageId = undefined;
    }
    commit();
  }

  /* ── bindings ── */
  function ensureWallet(address) {
    const a = address.toLowerCase();
    if (!snapshot.wallets.byAddress[a]) {
      snapshot.wallets.byAddress[a] = { bindings: {}, packages: {}, packageEnabled: {}, folders: {} };
    }
    return snapshot.wallets.byAddress[a];
  }
  function bindDef(opts) {
    for (const address of opts.addresses) {
      const w = ensureWallet(address);
      const id = "bind::" + uuid();
      w.bindings[id] = {
        id,
        defId: opts.defId,
        packageId: opts.packageId,
        enabled: opts.enabled ?? true,
        alias: opts.alias,
        params: opts.params,
        updatedAtMs: now(),
      };
    }
    commit();
  }
  function updateBinding(opts) {
    const w = snapshot.wallets.byAddress[opts.address.toLowerCase()];
    const b = w && w.bindings[opts.bindingId];
    if (!b) throw new Error("binding not found");
    Object.assign(b, opts.patch);
    b.updatedAtMs = now();
    commit();
  }
  function removeBinding(opts) {
    const w = snapshot.wallets.byAddress[opts.address.toLowerCase()];
    if (w) delete w.bindings[opts.bindingId];
    commit();
  }
  function removeWalletPackage(opts) {
    const w = snapshot.wallets.byAddress[opts.address.toLowerCase()];
    if (!w) return commit();
    delete w.packages[opts.packageId];
    delete w.packageEnabled[opts.packageId];
    for (const [bid, b] of Object.entries(w.bindings)) {
      if (b.packageId === opts.packageId) delete w.bindings[bid];
    }
    commit();
  }
  function putWalletPackage(opts) {
    const w = ensureWallet(opts.address);
    const existing = w.packages[opts.pkg.id];
    w.packages[opts.pkg.id] = { ...opts.pkg, updatedAtMs: now() };
    commit();
  }
  function putWalletFolder(opts) {
    const w = ensureWallet(opts.address);
    if (!w.folders) w.folders = {};
    w.folders[opts.folder.id] = { ...opts.folder, updatedAtMs: now() };
    commit();
  }
  function removeWalletFolder(opts) {
    const w = snapshot.wallets.byAddress[opts.address.toLowerCase()];
    if (!w || !w.folders) return commit();
    delete w.folders[opts.folderId];
    for (const d of Object.values(snapshot.library.defs)) {
      if (d.hidden && d.homeWallet === opts.address.toLowerCase() && d.walletFolderId === opts.folderId) {
        d.walletFolderId = undefined;
      }
    }
    commit();
  }
  function setPackageEnabled(opts) {
    const w = ensureWallet(opts.address);
    w.packageEnabled[opts.packageId] = opts.enabled;
    commit();
  }

  /* async wrappers (mirror the original await-based call sites) */
  const A = (fn) => (...args) => Promise.resolve().then(() => fn(...args));

  window.PSTEST = {
    UNCATEGORIZED_PKG,
    WALLET_A,
    WALLET_B,
    isEffectiveOn,
    subscribe,
    getOverview,
    resetSeed() {
      snapshot = freshSeed();
      commit();
    },
    putDef: A(putDef),
    deleteDef: A(deleteDef),
    duplicateDef: A(duplicateDef),
    putPackage: A(putPackage),
    deletePackage: A(deletePackage),
    bindDef: A(bindDef),
    updateBinding: A(updateBinding),
    removeBinding: A(removeBinding),
    removeWalletPackage: A(removeWalletPackage),
    putWalletPackage: A(putWalletPackage),
    putWalletFolder: A(putWalletFolder),
    removeWalletFolder: A(removeWalletFolder),
    setPackageEnabled: A(setPackageEnabled),
  };
})();
