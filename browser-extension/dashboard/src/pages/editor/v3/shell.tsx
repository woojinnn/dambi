// @ts-nocheck
/* Store hook + app shell bits (ToastStack + Topbar). The prototype's hash router
 * (useRoute/navigate) is replaced by react-router; navigation lives in nav.ts. */
import * as React from "react";

import * as PS from "./mockStore";

/* Store hook — subscribes to PS, returns the latest overview snapshot. */
export function useOverview() {
  const [snap, setSnap] = React.useState(() => PS.getOverview());
  React.useEffect(() => PS.subscribe(() => setSnap(PS.getOverview())), []);
  return snap;
}

/* Toasts (module-level event bus) */
const ToastBus = (() => {
  const subs = new Set();
  return { push: (text) => subs.forEach((cb) => cb(text)), subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)) };
})();
export const pushToast = (t) => ToastBus.push(t);
export function ToastStack() {
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(
    () =>
      ToastBus.subscribe((text) => {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        setToasts((t) => [...t, { id, text }]);
        window.setTimeout(() => setToasts((t) => t.filter((m) => m.id !== id)), 2400);
      }),
    [],
  );
  if (toasts.length === 0) return null;
  return (
    <div className="ev2-toaststack">
      {toasts.map((t) => (
        <div key={t.id} className="ev2-toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ── Topbar ── */
export function Topbar({ here, subtitle, right }) {
  return (
    <div className="topbar">
      <div className="crumb">
        <span className="here">{here}</span>
        {subtitle != null && <span className="sep">/</span>}
        {subtitle != null && <span className="addr">{subtitle}</span>}
      </div>
      <div className="dots">{right}</div>
    </div>
  );
}
