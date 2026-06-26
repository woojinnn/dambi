#!/usr/bin/env node
/**
 * Browser proof that the Dambi extension blocks a Hyperliquid `/exchange`
 * short order by a wallet-bound no-short policy.
 *
 * This is intentionally self-seeded:
 *   - writes one demo policy + wallet binding into chrome.storage.local
 *   - injects a synthetic connected wallet into the HL page
 *   - opens a real Hyperliquid host so manifest.json injects fetch-hook.js
 *   - posts one SHORT order and proves it is stopped before network forward
 *
 * It does NOT submit a real order. The default case is deny-only. A long allow
 * control would forward a request to the live API, so it is disabled unless
 * DAMBI_DEMO_ALLOW_LONG_NETWORK=1 is set.
 *
 * Prereqs:
 *   1. cd browser-extension
 *   2. node .yarn/releases/yarn-4.14.1.cjs build:chrome
 *   3. Launch headed Chrome with the built extension and a CDP port:
 *        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *          --user-data-dir=/tmp/hl-demo-profile --no-first-run \
 *          --disable-extensions-except="$PWD/dist/chrome" \
 *          --load-extension="$PWD/dist/chrome" \
 *          --remote-debugging-port=9222 \
 *          --window-position=-2400,-2400 about:blank &
 *   4. node scripts/demo/hl-deny-browser-demo.mjs
 *
 * NOTE: use HEADED Chrome. Chrome `--headless=new` does not reliably inject
 * Manifest V3 `world: "MAIN"` content scripts, so the MAIN-world fetch hook may
 * never install there.
 */
import WebSocket from "ws";

const DEBUG_PORT = process.env.CDP_PORT ?? "9222";
const PAGE_URL = process.env.DEMO_URL ?? "https://app.hyperliquid.xyz/";
const EXPECTED_EXTENSION_ID =
  process.env.DAMBI_DEMO_EXTENSION_ID ?? "licmpapbfngdlpbkbmbelldnkgefgbpi";
const RUN_LONG_NETWORK_CONTROL =
  process.env.DAMBI_DEMO_ALLOW_LONG_NETWORK === "1";
const UID = process.env.DAMBI_DEMO_UID ?? "u_hl_demo";
const MASTER = (
  process.env.DAMBI_DEMO_MASTER ??
  "0x676fa5b94067c2be14bc025df6c5c80dedf49a54"
).toLowerCase();
const POLICY_ID = "hl-no-short-perp";
const DEF_ID = "def::market.hl-no-short-perp";
const PKG_ID = "pkg::market.hyperliquid-safety";
const UNCATEGORIZED_PKG = "pkg::uncategorized";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  });
  const open = new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", () => reject(new Error(`websocket open failed: ${wsUrl}`)));
  });
  return {
    ws,
    open,
    send(method, params = {}) {
      const callId = ++id;
      ws.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(callId, { resolve, reject });
      });
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

function findExtensionTarget(targets, { required } = { required: true }) {
  const matches = targets.filter((target) => {
    if (!target.url?.startsWith("chrome-extension://")) return false;
    if (EXPECTED_EXTENSION_ID) {
      return target.url.startsWith(`chrome-extension://${EXPECTED_EXTENSION_ID}/`);
    }
    return target.url.endsWith("/js/background.js");
  });
  const serviceWorker = matches.find((target) => target.type === "service_worker");
  const page = matches.find((target) => target.type === "page");
  const picked = serviceWorker ?? page;
  if (!picked) {
    if (!required) return null;
    throw new Error(
      EXPECTED_EXTENSION_ID
        ? `Dambi extension target not found for ${EXPECTED_EXTENSION_ID}`
        : "Dambi extension target not found. Set DAMBI_DEMO_EXTENSION_ID if multiple extensions are loaded.",
    );
  }
  return picked;
}

const v = (name) => ({ kind: "var", name });
const attr = (base, ...path) =>
  path.reduce((of, key) => ({ kind: "attr", of, attr: key }), base);
const lit = (litType, value) => ({ kind: "lit", litType, value });
const eq = (left, right) => ({ kind: "binary", op: "==", left, right });
const and = (left, right) => ({ kind: "binary", op: "&&", left, right });

function noShortPolicyIr() {
  const context = v("context");
  return {
    kind: "policy",
    effect: "forbid",
    annotations: [
      { name: "id", value: POLICY_ID },
      { name: "severity", value: "deny" },
      {
        name: "reason",
        value: "Opening a new short perp on Hyperliquid is blocked by policy",
      },
    ],
    scope: {
      principal: { kind: "scopeAll" },
      action: {
        kind: "scopeEq",
        entity: { type: "Perp::Action", id: "PlaceOrder" },
      },
      resource: { kind: "scopeAll" },
    },
    conditions: [
      {
        kind: "when",
        body: and(
          and(
            eq(attr(context, "venue", "name"), lit("string", "hyperliquid")),
            eq(attr(context, "side"), lit("string", "short")),
          ),
          eq(attr(context, "reduceOnly"), lit("bool", false)),
        ),
      },
    ],
  };
}

function buildDemoStore() {
  const now = Date.now();
  const def = {
    id: DEF_ID,
    displayName: "Hyperliquid no new shorts",
    cat: "protocol",
    memo: "Blocks non-reduce-only short perp orders on Hyperliquid.",
    doc: {
      definition: "Blocks new short perp orders on Hyperliquid.",
      scope: "Applies to Perp::PlaceOrder when venue is hyperliquid, side is short, and reduceOnly is false.",
      audience: "Wallets that must not open short positions on Hyperliquid.",
      usedData: "Decoded Hyperliquid /exchange order fields: venue, side, and reduceOnly.",
    },
    skeleton: {
      ir: noShortPolicyIr(),
      manifest: {
        id: POLICY_ID,
        schema_version: 2,
        trigger: {
          where: {
            "action.tag": { eq: "place_order" },
            "action.venue": { eq: "hyperliquid" },
          },
        },
        policy_rpc: [],
        custom_context: { fields: {} },
      },
    },
    holes: [],
    defaults: { enabled: false, params: {}, packageId: PKG_ID },
    source: "market",
    sourceListingId: "demo-hl-no-short-perp",
    sourceVersion: "1.0.0",
    updatedAtMs: now,
  };
  const pkg = {
    id: PKG_ID,
    displayName: "Hyperliquid safety",
    desc: "Demo package for Hyperliquid order blocking.",
    source: "market",
    sourceListingId: "demo-hl-safety",
    sourceVersion: "1.0.0",
    updatedAtMs: now,
  };
  const uncategorized = {
    id: UNCATEGORIZED_PKG,
    displayName: "Uncategorized",
    source: "builtin",
    updatedAtMs: 0,
  };
  const bindId = "bind::demo::hl-no-short-perp";
  return {
    uid: UID,
    master: MASTER,
    storage: {
      "dashboard:current-user-id": UID,
      dambi_e2e_tap: true,
      [`ps2:${UID}:library`]: {
        schemaVersion: 1,
        defs: { [DEF_ID]: def },
        packages: { [UNCATEGORIZED_PKG]: uncategorized, [PKG_ID]: pkg },
      },
      [`ps2:${UID}:wallets`]: {
        schemaVersion: 1,
        byAddress: {
          [MASTER]: {
            bindings: {
              [bindId]: {
                id: bindId,
                defId: DEF_ID,
                packageId: PKG_ID,
                enabled: true,
                updatedAtMs: now,
              },
            },
            packages: {},
            packageEnabled: {},
          },
        },
      },
      [`ps2:${UID}:rev`]: 1,
    },
  };
}

function providerScript(master) {
  return `
    (() => {
      const master = ${JSON.stringify(master)};
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
  `;
}

function orderExpression(isBuy) {
  return `(async () => {
    const body = {
      action: {
        type: "order",
        orders: [
          { a: 0, b: ${isBuy}, p: "60000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } }
        ],
        grouping: "na"
      },
      nonce: Date.now()
    };
    let outcome;
    try {
      const r = await Promise.race([
        fetch("https://api.hyperliquid.xyz/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Dambi demo timeout waiting for fetch verdict")), 20000);
        })
      ]);
      outcome = { ok: true, status: r.status };
    } catch (e) {
      outcome = { ok: false, error: e && e.message ? e.message : String(e) };
    }
    return {
      outcome,
      verdict: window.__dambi_last_verdict__ || null,
      parse: window.__dambi_last_parse__ || null
    };
  })()`;
}

async function seedStorage(sw) {
  const { uid, storage } = buildDemoStore();
  return evalJson(
    sw,
    `(async () => {
      const next = ${JSON.stringify(storage)};
      const all = await chrome.storage.local.get(null);
      const remove = Object.keys(all).filter((k) =>
        k.startsWith("dambi:e2e-tap:") ||
        k === "dambi_jwt_refresh" ||
        k === "verdicts:log" ||
        k === "diagnosis-contexts:log" ||
        k === "execution-reports:log"
      );
      if (remove.length) await chrome.storage.local.remove(remove);
      await chrome.storage.local.set(next);
      const check = await chrome.storage.local.get([
        "dashboard:current-user-id",
        "dambi_e2e_tap",
        "ps2:${uid}:library",
        "ps2:${uid}:wallets",
        "ps2:${uid}:rev"
      ]);
      return {
        currentUser: check["dashboard:current-user-id"],
        tap: check.dambi_e2e_tap === true,
        defs: Object.keys(check["ps2:${uid}:library"].defs).length,
        wallets: Object.keys(check["ps2:${uid}:wallets"].byAddress).length,
        rev: check["ps2:${uid}:rev"]
      };
    })()`,
  );
}

async function main() {
  const version = await getJson("/json/version");
  const browser = connect(version.webSocketDebuggerUrl);
  await browser.open;

  let targets = await getJson("/json/list");
  let extensionTarget = findExtensionTarget(targets, { required: false });
  if (!extensionTarget && EXPECTED_EXTENSION_ID) {
    await browser.send("Target.createTarget", {
      url: `chrome-extension://${EXPECTED_EXTENSION_ID}/popup.html`,
    });
    await sleep(1000);
    targets = await getJson("/json/list");
    extensionTarget = findExtensionTarget(targets, { required: false });
  }
  if (!extensionTarget) {
    extensionTarget = findExtensionTarget(targets);
  }
  const sw = connect(extensionTarget.webSocketDebuggerUrl);
  await sw.open;
  await sw.send("Runtime.enable");
  const extensionContext = await evalJson(
    sw,
    `({
      href: typeof location !== "undefined" ? location.href : null,
      hasChromeStorage: typeof chrome === "object" && !!chrome?.storage?.local
    })`,
  );
  if (!extensionContext?.hasChromeStorage) {
    throw new Error(
      `Dambi extension context is not loaded with chrome.storage.local: ${JSON.stringify(
        extensionContext,
      )}`,
    );
  }

  const seedSummary = await seedStorage(sw);
  console.log("SEEDED:", JSON.stringify(seedSummary));

  const { targetId } = await browser.send("Target.createTarget", {
    url: "about:blank",
  });
  await sleep(300);
  const targetList = await getJson("/json/list");
  const pageTarget = targetList.find((target) => target.id === targetId);
  if (!pageTarget) throw new Error(`page target not found: ${targetId}`);
  const page = connect(pageTarget.webSocketDebuggerUrl);
  await page.open;
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: providerScript(MASTER),
  });
  await page.send("Page.navigate", { url: PAGE_URL });
  await sleep(5000);
  await page.send("Page.stopLoading").catch(() => undefined);

  let installed = await evalJson(
    page,
    `!!window[Symbol.for("__dambi_fetch_hook_install_state__")]`,
  );
  if (!installed) {
    await page.send("Page.navigate", { url: PAGE_URL });
    await sleep(5000);
    await page.send("Page.stopLoading").catch(() => undefined);
    installed = await evalJson(
      page,
      `!!window[Symbol.for("__dambi_fetch_hook_install_state__")]`,
    );
  }
  if (!installed) {
    throw new Error(
      `fetch hook not installed on ${PAGE_URL}; use a headed Chrome with the built extension loaded`,
    );
  }

  const runStartedAtSec = Math.floor(Date.now() / 1000);
  const short = await evalJson(page, orderExpression(false), 45000);
  const tapKey = `dambi:e2e-tap:${MASTER}`;
  const tap = await waitFor(
    () =>
      evalJson(
        sw,
        `(async () => {
          const got = await chrome.storage.local.get(${JSON.stringify(tapKey)});
          return got[${JSON.stringify(tapKey)}] || null;
        })()`,
      ),
    30000,
    250,
  );
  const verdictLogMatch = await waitFor(
    () =>
      evalJson(
        sw,
        `(async () => {
          const got = await chrome.storage.local.get("verdicts:log");
          const rows = Array.isArray(got["verdicts:log"]) ? got["verdicts:log"] : [];
          return rows.find((row) =>
            row &&
            row.ts >= ${runStartedAtSec} &&
            row.method === "venue:hyperliquid" &&
            row.wallet === ${JSON.stringify(MASTER)} &&
            row.verdict === "fail" &&
            row.policy &&
            row.policy.id === ${JSON.stringify(POLICY_ID)}
          ) || null;
        })()`,
      ),
    15000,
    250,
  );

  let long = null;
  if (RUN_LONG_NETWORK_CONTROL) {
    long = await evalJson(page, orderExpression(true), 45000);
  }

  console.log("SHORT:", JSON.stringify(short));
  console.log("TAP   :", JSON.stringify(tap));
  console.log("LOG   :", JSON.stringify(verdictLogMatch));
  if (long) console.log("LONG :", JSON.stringify(long));

  const shortBlocked =
    short?.outcome?.ok === false &&
    short?.verdict?.allowed === false &&
    String(short?.outcome?.error ?? "").includes("Dambi: venue order blocked");
  const tapMatched =
    tap?.kind === "fail" &&
    Array.isArray(tap.matched) &&
    tap.matched.includes(POLICY_ID);
  const verdictLogMatched = verdictLogMatch?.policy?.id === POLICY_ID;
  const longAllowed = !RUN_LONG_NETWORK_CONTROL || long?.verdict?.allowed === true;

  await browser.send("Target.closeTarget", { targetId }).catch(() => {});
  page.close();
  sw.close();
  browser.close();

  if (shortBlocked && (tapMatched || verdictLogMatched) && longAllowed) {
    console.log("\nPASS: short order blocked by wallet-bound HL no-short policy.");
    process.exit(0);
  }
  console.error("\nFAIL: expected short blocked and policy match recorded.");
  process.exit(1);
}

main().catch((err) => {
  console.error("demo error:", err);
  process.exit(3);
});
