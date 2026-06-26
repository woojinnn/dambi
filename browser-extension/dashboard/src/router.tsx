/**
 * Dashboard router — single SPA mounted at `/`.
 *
 * Auth flow:
 *   `/login`            — public, kicks the Google OAuth redirect.
 *   `/auth/callback`    — public, parses the token from the URL hash.
 *   everything else     — `<RequireAuth>` bounces anonymous users to /login.
 *
 * Shell: `<AppShell>` renders the collapsible nav rail; pages render
 * inside its `<Outlet />`. Each page owns its own `<Topbar />` (crumb
 * varies per route).
 */

import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
} from "react-router-dom";

import { isExtensionContext } from "./env";
import { AuthProvider } from "./hooks/useAuth";
import { RequireAuth } from "./RequireAuth";
import { AppShell } from "./shell/AppShell";

import { LoginPage } from "./pages/LoginPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { HomePage } from "./pages/HomePage";
import { EditorV3ListPage } from "./pages/editor/v3/EditorV3Pages";
import { EditorDetailPageV2 } from "./pages/editor/v2/EditorDetailPageV2";
import { SimulateWizardPage } from "./pages/simulate/SimulateWizardPage";
import { Assets2Page } from "./pages/Assets2Page";
import { HistoryPage } from "./pages/HistoryPage";
import { MarketPage } from "./pages/MarketPage";
import { MarketDetailPage } from "./pages/MarketDetailPage";
import { ProfilePage } from "./pages/ProfilePage";

// On an extension page the URL is `…/options.html` (a real file, no dev
// server rewriting unknown paths to index.html), so path-based routing finds
// no match → blank screen. Hash routing (`…/options.html#/editor`) renders
// and survives reloads. Standalone dev keeps clean path-based URLs.
const createRouter = isExtensionContext() ? createHashRouter : createBrowserRouter;

const router = createRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/auth/callback", element: <AuthCallbackPage /> },
  {
    path: "/",
    element: <RequireAuth />,
    children: [
      {
        path: "",
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          // 목록/워크스페이스는 v3 정적 에디터(iframe), 단일 정책 편집은 실제
          // React 에디터(EditorDetailPageV2, ir 지원). iframe이 정책을 누르면
          // 브리지가 /editor/:id 로 보내 이 에디터를 연다.
          { path: "editor", element: <EditorV3ListPage /> },
          { path: "editor/:id", element: <EditorDetailPageV2 /> },
          // 옛 editor2 경로 → editor 로 영구 리다이렉트(기존 북마크/링크 호환).
          { path: "editor2", element: <Navigate to="/editor" replace /> },
          { path: "editor2/:id", element: <Navigate to="/editor" replace /> },
          { path: "simulation", element: <SimulateWizardPage /> },
          { path: "simulate", element: <Navigate to="/simulation" replace /> },
          { path: "assets", element: <Assets2Page /> },
          { path: "monitoring", element: <Navigate to="/assets" replace /> },
          { path: "assets2", element: <Navigate to="/assets" replace /> },
          { path: "history", element: <HistoryPage /> },
          { path: "market", element: <MarketPage /> },
          { path: "market/:slug", element: <MarketDetailPage /> },
          { path: "profile", element: <ProfilePage /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

export function AppRouter() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
