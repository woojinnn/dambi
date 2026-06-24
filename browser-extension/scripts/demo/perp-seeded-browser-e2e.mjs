#!/usr/bin/env node
import fs from "node:fs";

const DEBUG_PORT = process.env.CDP_PORT ?? "9333";
const SERVER_URL = process.env.DAMBI_E2E_SERVER_URL ?? "http://127.0.0.1:8799";
const SEED_FILE = process.env.DAMBI_E2E_SEED_FILE ?? "/tmp/perp-browser-e2e.txt";
const POLICY_FILE =
  process.env.DAMBI_E2E_POLICY_FILE ??
  "/private/tmp/dambi-perp-e2e/perp-e2e-defs.json";
const OUT_FILE =
  process.env.DAMBI_E2E_OUT ??
  "/tmp/dambi-perp-browser-local-seeded-results.json";
const PAGE_URL =
  process.env.DAMBI_E2E_PAGE_URL ?? "https://app.hyperliquid.xyz/";
const EXPECTED_EXTENSION_ID =
  process.env.DAMBI_E2E_EXTENSION_ID ?? "licmpapbfngdlpbkbmbelldnkgefgbpi";

function parseSeed(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`websocket open failed: ${wsUrl}`));
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    const list = handlers.get(msg.method);
    if (list) for (const cb of list) cb(msg.params ?? {});
  };
  return {
    send(method, params = {}) {
      const callId = ++id;
      ws.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(callId, { resolve, reject });
      });
    },
    on(method, cb) {
      const list = handlers.get(method) ?? [];
      list.push(cb);
      handlers.set(method, list);
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

async function evalJson(target, expression, timeoutMs = 30000) {
  const res = await target.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  });
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ??
        res.exceptionDetails.text ??
        "Runtime.evaluate failed",
    );
  }
  return res.result.value;
}

async function waitFor(predicate, timeoutMs, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

function buildStore(seed, policyWrap) {
  const uid = seed.user_id;
  const now = Date.now();
  const defs = {};
  for (const row of policyWrap.policies) {
    defs[row.def.id] = {
      ...row.def,
      updatedAtMs: now,
      source: "market",
    };
  }
  const pkg = {
    id: "pkg::uncategorized",
    displayName: "Uncategorized",
    source: "builtin",
    updatedAtMs: now,
  };
  const library = {
    schemaVersion: 1,
    defs,
    packages: { [pkg.id]: pkg },
  };
  const mkWallet = (address, slugs) => {
    const bindings = {};
    for (const slug of slugs) {
      const row = policyWrap.policies.find((p) => p.slug === slug);
      if (!row) throw new Error(`missing policy slug: ${slug}`);
      const id = `bind::e2e::${slug}::${address.slice(-4).toLowerCase()}`;
      bindings[id] = {
        id,
        defId: row.def.id,
        packageId: "pkg::uncategorized",
        enabled: true,
        updatedAtMs: now,
      };
    }
    return { bindings, packages: {}, packageEnabled: {} };
  };
  const allSlugs = policyWrap.policies.map((p) => p.slug);
  const wallets = {
    schemaVersion: 1,
    byAddress: {
      [seed.CONTROL.toLowerCase()]: mkWallet(seed.CONTROL, [
        "order-reduce-only-lockdown-deny",
      ]),
      [seed.MDD_FIRE.toLowerCase()]: mkWallet(seed.MDD_FIRE, [
        "order-max-drawdown-warn",
      ]),
      [policyWrap.wallet.toLowerCase()]: mkWallet(policyWrap.wallet, allSlugs),
    },
  };
  return {
    uid,
    storage: {
      dambi_server_url: SERVER_URL,
      dambi_jwt: seed.JWT,
      "dashboard:current-user-id": uid,
      dambi_e2e_tap: true,
      [`ps2:${uid}:library`]: library,
      [`ps2:${uid}:wallets`]: wallets,
      [`ps2:${uid}:rev`]: 1,
    },
    policyCount: policyWrap.policies.length,
    walletCount: Object.keys(wallets.byAddress).length,
  };
}

function consoleArgValue(arg) {
  if ("value" in arg) return arg.value;
  return arg.description ?? arg.type;
}

async function main() {
  const seed = parseSeed(fs.readFileSync(SEED_FILE, "utf8"));
  const policyWrap = JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"));
  const { uid, storage, policyCount, walletCount } = buildStore(seed, policyWrap);

  const version = await json(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const browser = await connect(version.webSocketDebuggerUrl);
  const targets = await json(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const swTarget = targets.find(
    (t) =>
      t.type === "service_worker" &&
      t.url.startsWith(`chrome-extension://${EXPECTED_EXTENSION_ID}/`),
  );
  const extensionPageTarget = targets.find(
    (t) =>
      t.type === "page" &&
      t.url.startsWith(`chrome-extension://${EXPECTED_EXTENSION_ID}/`),
  );
  const storageTarget = swTarget ?? extensionPageTarget;
  if (!storageTarget) {
    throw new Error("Dambi extension target not found");
  }
  const extensionId = new URL(storageTarget.url).hostname;
  const sw = await connect(storageTarget.webSocketDebuggerUrl);
  const swConsole = [];
  const swNetwork = new Map();
  sw.on("Runtime.consoleAPICalled", (params) => {
    swConsole.push({
      type: params.type,
      args: (params.args ?? []).map(consoleArgValue),
      ts: Date.now(),
    });
  });
  await sw.send("Runtime.enable");
  await sw.send("Network.enable").catch(() => undefined);
  sw.on("Network.requestWillBeSent", (params) => {
    const url = params.request?.url;
    if (typeof url !== "string") return;
    if (
      !url.includes("/evaluate") &&
      !url.includes("/auth/me") &&
      !url.includes("/auth/refresh")
    ) {
      return;
    }
    swNetwork.set(params.requestId, {
      requestId: params.requestId,
      url,
      method: params.request?.method,
      resourceType: params.type,
      requestTs: Date.now(),
    });
  });
  sw.on("Network.responseReceived", (params) => {
    const row = swNetwork.get(params.requestId);
    if (!row) return;
    row.status = params.response?.status;
    row.mimeType = params.response?.mimeType;
    row.responseTs = Date.now();
  });

  const seedSummary = await evalJson(
    sw,
    `(async () => {
      const next = ${JSON.stringify(storage)};
      const all = await chrome.storage.local.get(null);
      const remove = Object.keys(all).filter((k) =>
        k.startsWith("dambi:e2e-tap:") ||
        k === "dambi_jwt_refresh"
      );
      if (remove.length) await chrome.storage.local.remove(remove);
      await chrome.storage.local.set(next);
      const check = await chrome.storage.local.get([
        "dambi_server_url",
        "dambi_jwt",
        "dashboard:current-user-id",
        "dambi_e2e_tap",
        "ps2:${uid}:library",
        "ps2:${uid}:wallets",
        "ps2:${uid}:rev"
      ]);
      return {
        serverUrl: check.dambi_server_url,
        hasJwt: typeof check.dambi_jwt === "string" && check.dambi_jwt.length > 20,
        currentUser: check["dashboard:current-user-id"],
        tap: check.dambi_e2e_tap === true,
        defs: Object.keys(check["ps2:${uid}:library"].defs).length,
        wallets: Object.keys(check["ps2:${uid}:wallets"].byAddress).length,
        rev: check["ps2:${uid}:rev"]
      };
    })()`,
  );

  async function runCase(testCase) {
    const { targetId } = await browser.send("Target.createTarget", {
      url: "about:blank",
    });
    await sleep(300);
    const list = await json(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const target = list.find((t) => t.id === targetId);
    if (!target) throw new Error(`page target not found: ${targetId}`);
    const page = await connect(target.webSocketDebuggerUrl);
    const pageConsole = [];
    page.on("Runtime.consoleAPICalled", (params) => {
      pageConsole.push({
        type: params.type,
        args: (params.args ?? []).map(consoleArgValue),
        ts: Date.now(),
      });
    });
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    await page.send("Input.setIgnoreInputEvents", { ignore: false });
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        (() => {
          const master = ${JSON.stringify(testCase.master.toLowerCase())};
          const listeners = new Map();
          const provider = {
            isMetaMask: true,
            selectedAddress: master,
            request: async ({ method }) => {
              if (method === "eth_accounts" || method === "eth_requestAccounts") return [master];
              if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
              if (method === "net_version") return "1";
              if (method === "eth_chainId") return "0x1";
              return null;
            },
            on: (event, cb) => {
              const arr = listeners.get(event) || [];
              arr.push(cb);
              listeners.set(event, arr);
            },
            removeListener: (event, cb) => {
              const arr = listeners.get(event) || [];
              listeners.set(event, arr.filter((x) => x !== cb));
            }
          };
          Object.defineProperty(window, "ethereum", {
            configurable: true,
            enumerable: true,
            value: provider
          });
        })();
      `,
    });
    await page.send("Page.navigate", { url: PAGE_URL });
    await sleep(5000);
    await page.send("Page.reload", { ignoreCache: true });
    await sleep(5000);

    const installed = await evalJson(
      page,
      `!!window[Symbol.for("__dambi_fetch_hook_install_state__")]`,
    );
    if (!installed) {
      throw new Error(`fetch hook not installed for ${testCase.name}`);
    }

    const setup = await evalJson(
      page,
      `(() => {
        const master = ${JSON.stringify(testCase.master.toLowerCase())};
        const listeners = new Map();
        const provider = {
          isMetaMask: true,
          selectedAddress: master,
          request: async ({ method }) => {
            if (method === "eth_accounts" || method === "eth_requestAccounts") return [master];
            if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
            if (method === "net_version") return "1";
            if (method === "eth_chainId") return "0x1";
            return null;
          },
          on: (event, cb) => {
            const arr = listeners.get(event) || [];
            arr.push(cb);
            listeners.set(event, arr);
          },
          removeListener: (event, cb) => {
            const arr = listeners.get(event) || [];
            listeners.set(event, arr.filter((x) => x !== cb));
          }
        };
        Object.defineProperty(window, "ethereum", {
          configurable: true,
          enumerable: true,
          value: provider
        });
        const body = ${JSON.stringify(testCase.body)};
        const state = {
          name: ${JSON.stringify(testCase.name)},
          master: ${JSON.stringify(testCase.master.toLowerCase())},
          postStartedAtMs: null,
          fetchSettledAtMs: null,
          outcome: null,
          lastVerdict: null
        };
        window.__dambi_e2e_case = state;
        const old = document.getElementById("dambi-e2e-click");
        if (old) old.remove();
        const btn = document.createElement("button");
        btn.id = "dambi-e2e-click";
        btn.textContent = "Dambi E2E POST";
        btn.style.cssText = "position:fixed;z-index:2147483647;left:16px;top:16px;width:180px;height:48px;background:#111;color:#fff;border:2px solid #fff";
        btn.onclick = () => {
          state.postStartedAtMs = Date.now();
          fetch("https://api.hyperliquid.xyz/exchange", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...body, nonce: Date.now() })
          }).then((r) => {
            state.outcome = { ok: true, status: r.status };
          }).catch((err) => {
            state.outcome = { ok: false, error: err && err.message ? err.message : String(err) };
          }).finally(() => {
            state.fetchSettledAtMs = Date.now();
            state.lastVerdict = window.__dambi_last_verdict__ || null;
          });
        };
        document.body.appendChild(btn);
        const r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`,
    );
    await page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: setup.x,
      y: setup.y,
      button: "left",
      clickCount: 1,
    });
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: setup.x,
      y: setup.y,
      button: "left",
      clickCount: 1,
    });

    const tapKey = `dambi:e2e-tap:${testCase.master.toLowerCase()}`;
    const tap = await waitFor(
      async () => {
        const value = await evalJson(
          sw,
          `(async () => {
            const got = await chrome.storage.local.get(${JSON.stringify(tapKey)});
            return got[${JSON.stringify(tapKey)}] || null;
          })()`,
        );
        return value;
      },
      testCase.tapTimeoutMs ?? 30000,
      250,
    );
    const pageState = await evalJson(
      page,
      `(() => window.__dambi_e2e_case || null)()`,
    );
    page.close();
    await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    return {
      name: testCase.name,
      master: testCase.master.toLowerCase(),
      expectedKind: testCase.expectedKind,
      expectedPolicy: testCase.expectedPolicy,
      fetchHookInstalled: installed,
      pageState,
      tap,
      orderPostToVerdictMs:
        tap && pageState?.postStartedAtMs ? tap.ts - pageState.postStartedAtMs : null,
      matchedExpectedPolicy:
        !!tap && Array.isArray(tap.matched) && tap.matched.includes(testCase.expectedPolicy),
      pageConsole,
    };
  }

  const runSalt = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0")}`;
  const orderBody = (reduceOnly = false, caseSalt = "00") => ({
    action: {
      type: "order",
      orders: [
        {
          a: 0,
          b: true,
          p: "1",
          s: caseSalt === "01" ? "0.101" : "0.102",
          r: reduceOnly,
          c: `0x${runSalt}${caseSalt}`.padEnd(34, "0").slice(0, 34),
          t: { limit: { tif: "Gtc" } },
        },
      ],
      grouping: "na",
    },
  });

  const cases = [
    {
      name: "reduce_only_lockdown_deny_click",
      master: seed.CONTROL,
      body: orderBody(false, "01"),
      expectedKind: "fail",
      expectedPolicy: "order-reduce-only-lockdown-deny",
      tapTimeoutMs: 20000,
    },
    {
      name: "max_drawdown_stateful_warn_click",
      master: seed.MDD_FIRE,
      body: orderBody(false, "02"),
      expectedKind: "warn",
      expectedPolicy: "order-max-drawdown-warn",
      tapTimeoutMs: 30000,
    },
  ];

  const caseResults = [];
  for (const c of cases) {
    caseResults.push(await runCase(c));
  }

  const result = {
    ok: caseResults.every(
      (r) =>
        r.fetchHookInstalled &&
        r.tap?.kind === r.expectedKind &&
        r.matchedExpectedPolicy &&
        typeof r.orderPostToVerdictMs === "number" &&
        r.orderPostToVerdictMs >= 0,
    ),
    generatedAt: new Date().toISOString(),
    chromeDebugPort: DEBUG_PORT,
    extensionId,
    extensionVersion: "0.1.3",
    serverUrl: SERVER_URL,
    uid,
    storageSeed: seedSummary,
    policyCount,
    walletCount,
    cases: caseResults,
    serviceWorkerConsole: swTarget ? swConsole.slice(-80) : [],
    serviceWorkerNetwork: [...swNetwork.values()],
    storageTargetType: storageTarget.type,
  };
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: result.ok,
    outFile: OUT_FILE,
    cases: result.cases.map((r) => ({
      name: r.name,
      tapKind: r.tap?.kind ?? null,
      matched: r.tap?.matched ?? null,
      orderPostToVerdictMs: r.orderPostToVerdictMs,
      fetchOutcome: r.pageState?.outcome ?? null,
    })),
  }, null, 2));
  sw.close();
  browser.close();
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  fs.writeFileSync(
    OUT_FILE,
    `${JSON.stringify({ ok: false, error: err.stack || String(err) }, null, 2)}\n`,
  );
  console.error(err);
  process.exit(2);
});
