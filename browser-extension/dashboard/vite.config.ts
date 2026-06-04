import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The extension's manifest content_scripts entry pins the bridge to
// http://localhost:5174 / http://127.0.0.1:5174. Keep this port matching
// or the bridge will not inject and every SDK call will time out.
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to IPv4 127.0.0.1 (not the default `localhost`, which resolves to
    // IPv6 ::1 on macOS). The Google OAuth flow is pinned to 127.0.0.1
    // throughout (GOOGLE_REDIRECT_URI + DASHBOARD_URL = http://127.0.0.1:...),
    // so the post-login callback lands at http://127.0.0.1:5174/auth/callback.
    // If vite only listened on ::1, that callback hits a dead 127.0.0.1:5174 →
    // chrome-error → "unsafe attempt to load ... must match" cross-origin block.
    // Access the dashboard at http://127.0.0.1:5174 (not localhost).
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: {
      // Allow importing from the sibling sdk/ folder (one level up).
      allow: [".."],
    },
  },
  resolve: {
    alias: {
      "@scopeball/sdk": path.resolve(__dirname, "../sdk/extension-client.ts"),
    },
  },
});
