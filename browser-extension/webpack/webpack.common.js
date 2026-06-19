const path = require("path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");
const Dotenv = require("dotenv-webpack");
const WextManifestWebpackPlugin = require("wext-manifest-webpack-plugin");
const {
  buildMode,
  envPathForMode,
  loadBuildEnv,
  resolveServerUrl,
  resolvePinnedBundleKey,
  resolveRequireBundleSig,
} = require("./env");

const targetBrowser = process.env.TARGET_BROWSER || "chrome";
const extRoot = path.resolve(__dirname, "..");
const mode = buildMode();

// Load the mode-specific env file into Node's `process.env` BEFORE config-time
// env reads
// (`serverUrl` below, the DefinePlugin, and — critically — the prod
// `REGISTRY_BASE_URL` https guard in webpack.prod.js, which `require()`s this
// file first). Production reads `.env`; development reads `.env.development`
// so a local production `.env` cannot accidentally point dev builds at prod.
// `dotenv-webpack` only injects env files into the *bundle*; it does not
// populate `process.env`, so without this the guard / DefinePlugin would read a
// different source than the bundle ships. `.config()` does not override an
// already-exported var, so exports still win — matching the `systemvars`
// precedence used for the bundle below.
loadBuildEnv(extRoot, mode);

const backendDir = path.join(extRoot, "backend");
const frontendDir = path.join(extRoot, "frontend");
const distDir = path.join(extRoot, "dist", targetBrowser);
const serverUrl = resolveServerUrl();
const pinnedBundleKey = resolvePinnedBundleKey();
const requireBundleSig = resolveRequireBundleSig();
const isProductionBuild = mode === "production";

// Shared bits of the webpack config — the actual exported configs differ
// only in `entry`, `target`, and which build-time plugins they own.
const sharedResolve = {
  extensions: [".ts", ".tsx", ".js", ".json"],
  alias: {
    "@lib": path.join(backendDir, "lib"),
    "@background": path.join(backendDir, "service-worker"),
  },
  fallback: {
    buffer: require.resolve("buffer/"),
    process: require.resolve("process/browser"),
  },
};

const sharedModule = {
  rules: [
    {
      type: "javascript/auto",
      test: /manifest\.json$/,
      use: {
        loader: "wext-manifest-loader",
        options: { usePackageJSONVersion: true },
      },
      exclude: /node_modules/,
    },
    {
      test: /\.tsx?$/,
      loader: "ts-loader",
      exclude: /node_modules/,
    },
    {
      test: /\.css$/,
      use: ["style-loader", "css-loader"],
    },
    {
      test: /\.wasm$/,
      type: "asset/resource",
    },
  ],
};

const sharedPlugins = () => [
  new Dotenv({
    path: envPathForMode(extRoot, mode),
    safe: false,
    silent: true,
    // Resolve `process.env.*` references in the bundle from the merged
    // environment (exported vars + the `.env` loaded above) — not just the
    // `.env` file. Without this, an exported REGISTRY_BASE_URL passes the prod
    // guard but the bundle still bakes the `http://localhost:8000` fallback.
    systemvars: true,
  }),
  new webpack.DefinePlugin({
    global: "globalThis",
    DAMBI_SERVER_URL: JSON.stringify(serverUrl),
    // Registry bundle-signing trust anchor — pinned verify key (SPKI base64)
    // and the enforce flag ("true"/"false"). Read by adapter-loader/bundle-verify.ts.
    PINNED_BUNDLE_PUBLIC_KEY: JSON.stringify(pinnedBundleKey),
    DAMBI_REQUIRE_BUNDLE_SIGNATURE: JSON.stringify(requireBundleSig),
  }),
  // ProvidePlugin for `process` so readable-stream's `process.nextTick` etc.
  // resolve at runtime even in code paths that don't import it explicitly.
  new webpack.ProvidePlugin({ process: "process/browser" }),
];

class ProductionManifestHardeningPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap(
      "ProductionManifestHardeningPlugin",
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: "ProductionManifestHardeningPlugin",
            stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
          },
          () => {
            const asset = compilation.getAsset("manifest.json");
            if (!asset) return;
            const manifest = JSON.parse(asset.source.source().toString());
            manifest.content_scripts = (manifest.content_scripts || []).filter(
              (script) =>
                !(script.js || []).includes(
                  "js/content-scripts/dashboard-bridge.js",
                ),
            );
            const devOrigins = new Set([
              "http://localhost:8000/*",
              "http://127.0.0.1:8000/*",
              "http://127.0.0.1:8788/*",
            ]);
            if (Array.isArray(manifest.host_permissions)) {
              manifest.host_permissions = manifest.host_permissions.filter(
                (permission) => !devOrigins.has(permission),
              );
            }
            if (Array.isArray(manifest.permissions)) {
              manifest.permissions = manifest.permissions.filter(
                (permission) => !devOrigins.has(permission),
              );
            }
            compilation.updateAsset(
              "manifest.json",
              new webpack.sources.RawSource(
                `${JSON.stringify(manifest, null, 2)}\n`,
              ),
            );
          },
        );
      },
    );
  }
}

const pageEntries = {
  "content-scripts/inject-scripts": path.join(
    backendDir,
    "content-scripts",
    "inject-scripts.ts",
  ),
  "content-scripts/window-ethereum-messages": path.join(
    backendDir,
    "content-scripts",
    "window-ethereum-messages.ts",
  ),
  "content-scripts/bypass-check": path.join(
    backendDir,
    "content-scripts",
    "bypass-check.ts",
  ),
  "injected/proxy-injected-providers": path.join(
    backendDir,
    "injected",
    "proxy-injected-providers.ts",
  ),
  "injected/fetch-hook": path.join(backendDir, "injected", "fetch-hook.ts"),
  "content-scripts/fetch-bridge": path.join(
    backendDir,
    "content-scripts",
    "fetch-bridge.ts",
  ),
  "content-scripts/dambi-advisory": path.join(
    backendDir,
    "content-scripts",
    "dambi-advisory.ts",
  ),
  "confirm/index": path.join(frontendDir, "confirm", "index.ts"),
  "popup/index": path.join(frontendDir, "popup", "index.ts"),
  "onboarding/index": path.join(frontendDir, "onboarding", "index.ts"),
  manifest: path.join(backendDir, "manifest.json"),
};

if (!isProductionBuild) {
  pageEntries["content-scripts/dashboard-bridge"] = path.join(
    backendDir,
    "content-scripts",
    "dashboard-bridge.ts",
  );
}

// Page/contentscript build — content scripts run in page context, popup +
// confirm run in extension-page context. Default `target` ("web") is the
// right choice; webpack's chunk loader can use `document.*` here.
//
// This config owns `clean: true` so it must run FIRST. The SW build
// declares `dependencies: ["pages"]` to enforce the order so it doesn't
// race against the dist wipe.
const pageConfig = {
  name: "pages",
  target: "web",
  entry: pageEntries,
  output: {
    filename: "js/[name].js",
    path: distDir,
    clean: true,
    publicPath: "/",
    globalObject: "globalThis",
  },
  resolve: sharedResolve,
  node: {
    global: false,
  },
  experiments: {
    asyncWebAssembly: true,
  },
  module: sharedModule,
  plugins: [
    ...sharedPlugins(),
    new WextManifestWebpackPlugin(),
    ...(isProductionBuild ? [new ProductionManifestHardeningPlugin()] : []),
    new CopyPlugin({
      patterns: [{ from: path.join(extRoot, "public"), to: distDir }],
    }),
  ],
};

// SW build — `target: "webworker"` is required so webpack does NOT emit
// `document.baseURI` / `document.createElement` in the runtime chunk
// loader. Those references would crash the SW at registration time
// (Service worker registration failed, status code 15).
//
// Runs after `pages` so the dist wipe doesn't clobber `js/background.js`.
const swConfig = {
  name: "sw",
  target: "webworker",
  dependencies: ["pages"],
  entry: {
    background: path.join(backendDir, "service-worker", "index.ts"),
  },
  output: {
    filename: "js/[name].js",
    path: distDir,
    publicPath: "/",
    globalObject: "globalThis",
  },
  resolve: sharedResolve,
  node: {
    global: false,
  },
  experiments: {
    asyncWebAssembly: true,
  },
  module: sharedModule,
  plugins: sharedPlugins(),
};

module.exports = [pageConfig, swConfig];
