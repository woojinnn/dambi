import { defineConfig } from "vite";

// The wasm-bindgen glue uses `import.meta.url` to locate the .wasm binary
// next to its .js sibling. We keep both under src/wasm/ (imported by the
// app) and a duplicate of the .wasm under public/wasm/ so production
// builds resolve correctly when the JS glue is bundled.
//
// `base` is set so the production build (served by crates/web-server under
// /policy-builder/*) emits asset URLs prefixed with that path. The dev
// server overrides base via the CLI when needed; standalone `vite` from
// this directory still works at http://localhost:5174/policy-builder/.
export default defineConfig({
  base: "/policy-builder/",
  server: {
    port: 5174,
  },
  build: {
    target: "es2022",
  },
});
