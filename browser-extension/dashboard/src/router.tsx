import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ExtensionProvider } from "./sdk-context";
import { AppShell } from "./shell/AppShell";
import { HomePage } from "./pages/HomePage";
import { EditorPage } from "./pages/EditorPage";
import { LibraryPage } from "./pages/LibraryPage";
import { AuditPage } from "./pages/AuditPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ManifestEditor } from "./pages/manifest-editor";

// Standalone Vite app at localhost:5174 — BrowserRouter only.
// Extension-bundling is a future concern (M-5, deferred).
const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <ExtensionProvider>
        <AppShell />
      </ExtensionProvider>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: "editor", element: <EditorPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "audit", element: <AuditPage /> },
      { path: "settings", element: <SettingsPage /> },
      // Phase 7.2: per-action manifest authoring. The matching /schema
      // viewer route (Phase 7.3) is not wired yet — Preview will
      // navigate to /schema?action=… and land on a 404 until 7.3 ships.
      { path: "manifests/:action", element: <ManifestEditor /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
