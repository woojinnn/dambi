/* ── tiny hash router + store hook + app shell (NavRail + Topbar) ── */

/* Route: parse location.hash like #/editor or #/editor/<id>?wallet=..&binding=.. */
function parseHash() {
  let h = window.location.hash || "#/editor";
  if (h[0] === "#") h = h.slice(1);
  const [path, qs] = h.split("?");
  const params = new URLSearchParams(qs || "");
  const segs = path.split("/").filter(Boolean); // ["editor", "<id>"]
  return { path, segs, params };
}
function useRoute() {
  const [route, setRoute] = React.useState(parseHash);
  React.useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
function navigate(to, opts) {
  // 대시보드 iframe 안에서 상세(/editor/<id>) 이동은 부모로 브리지한다 — 부모가
  // 실제 에디터(EditorDetailPageV2, ir 지원)를 연다. prototype 상세는 skeleton.model을
  // 기대하지만 실제 백엔드 def는 ir만 있어 v3 상세는 못 띄우기 때문.
  try {
    const seg = String(to).split("?")[0].split("/").filter(Boolean);
    const isDetail = seg[0] === "editor" && seg.length >= 2;
    if (isDetail && window.parent && window.parent !== window) {
      const state = opts && opts.state ? opts.state : undefined;
      window.parent.postMessage({ source: "dambi-editor-v3", type: "open-policy", to: to, ...(state ? { state } : {}) }, window.location.origin);
      return;
    }
  } catch (e) {}
  // store nav state (newPolicy seed) keyed in memory
  if (opts && opts.state) window.__navState = opts.state;
  else window.__navState = null;
  if (opts && opts.replace) {
    const url = window.location.href.split("#")[0] + "#" + to;
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new HashEvent());
  } else {
    window.location.hash = to;
  }
}
function HashEvent() {
  return new Event("hashchange");
}
function consumeNavState() {
  const s = window.__navState;
  window.__navState = null;
  return s;
}

/* Store hook — subscribes to PS, returns the latest overview snapshot. */
function useOverview() {
  const [snap, setSnap] = React.useState(() => PS.getOverview());
  React.useEffect(() => PS.subscribe((s) => setSnap(PS.getOverview())), []);
  return snap;
}

/* Toasts (module-level event bus) */
const ToastBus = (() => {
  const subs = new Set();
  return { push: (text) => subs.forEach((cb) => cb(text)), subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)) };
})();
const pushToast = (t) => ToastBus.push(t);
function ToastStack() {
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

/* Confirm dialog (module-level promise bus) — leaf 컴포넌트도 setState 없이
 * `await e2Confirm({title, body, danger, confirmLabel})` 한 줄로 확인 모달을 띄운다.
 * 호스트(ConfirmHost)는 리스트 페이지에 한 번 마운트된다. */
const ConfirmBus = (() => {
  const subs = new Set();
  return { request: (opts) => subs.forEach((cb) => cb(opts)), subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)) };
})();
function e2Confirm(opts) {
  return new Promise((resolve) => ConfirmBus.request({ ...opts, _resolve: resolve }));
}
function ConfirmHost() {
  const [ask, setAsk] = React.useState(null);
  React.useEffect(() => ConfirmBus.subscribe((opts) => setAsk(opts)), []);
  React.useEffect(() => {
    if (!ask) return;
    const onKey = (e) => {
      if (e.key === "Escape") { ask._resolve(false); setAsk(null); }
      if (e.key === "Enter") { ask._resolve(true); setAsk(null); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask]);
  if (!ask) return null;
  const close = (ok) => { ask._resolve(ok); setAsk(null); };
  return (
    <div className="e2-ov" onMouseDown={() => close(false)}>
      <div className="modal e2cf" onMouseDown={(e) => e.stopPropagation()}>
        <div className="e2cf-body">
          <div className="e2cf-title">{ask.title}</div>
          {ask.body && <div className="e2cf-text">{ask.body}</div>}
        </div>
        <div className="e2cf-foot">
          <button type="button" className="e2cf-btn cancel" onClick={() => close(false)}>취소</button>
          <button type="button" className={`e2cf-btn ok${ask.danger ? " danger" : ""}`} autoFocus onClick={() => close(true)}>{ask.confirmLabel || "확인"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── NavRail ── */
const navStroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
function NavRail() {
  const route = useRoute();
  const isEditor = route.segs[0] === "editor";
  const items = [
    ["", "Home", <path d="M3 11.5 12 4l9 7.5M5 10v10h14V10" />],
    ["editor", "Editor", <g><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></g>],
    ["simulation", "Simulation", <g><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5z" /></g>],
    ["assets", "Assets", <path d="M3 12h4l3 8 4-16 3 8h4" />],
    ["market", "Policy Hub", <g><path d="M3 8h18l-2 12H5z" /><path d="M8 8V5a4 4 0 0 1 8 0v3" /></g>],
  ];
  const bottom = [
    ["history", "History", <g><path d="M3 3v18h18" /><path d="m7 14 4-4 4 3 5-7" /></g>],
    ["settings", "Settings", <g><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></g>],
  ];
  const Item = ([slug, label, icon]) => {
    const active = slug === "editor" ? isEditor : slug === "" ? route.segs.length === 0 : route.segs[0] === slug;
    return (
      <a
        key={slug || "home"}
        className={`nav-item${active ? " active" : ""}`}
        href={slug === "editor" ? "#/editor" : "#/" + slug}
        onClick={(e) => {
          if (slug !== "editor" && slug !== "") {
            e.preventDefault();
            pushToast(`${label}는 이 데모에 포함되지 않았어요`);
          }
        }}
      >
        <span className="icon">
          <svg viewBox="0 0 24 24" {...navStroke}>{icon}</svg>
        </span>
        <span className="label">{label}</span>
      </a>
    );
  };
  return (
    <nav className="nav-rail" tabIndex={0} aria-label="global nav">
      <div className="nav-logo">
        <div className="mark">sb</div>
        <div className="word">dambi</div>
      </div>
      <div className="nav-divider" />
      <div className="nav-group">{items.map(Item)}</div>
      <div className="nav-divider" />
      <div className="nav-group">{bottom.map(Item)}</div>
      <div className="nav-bottom">
        <button className="nav-user" title="계정">
          <span className="av">JK</span>
          <div className="meta">
            <div className="nm">jin@dambi.xyz</div>
            <div className="em">usr_8f2a</div>
          </div>
          <span className="nav-user-caret">
            <svg viewBox="0 0 24 24" width="14" height="14" {...navStroke}>
              <path d="m6 14 6-6 6 6" />
            </svg>
          </span>
        </button>
      </div>
    </nav>
  );
}

/* ── Topbar ── */
function Topbar({ here, subtitle, right }) {
  const snap = useOverview();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? Object.values(snap.library.defs).filter((d) => !d.hidden && (d.displayName.toLowerCase().includes(needle) || d.id.toLowerCase().includes(needle)))
    : [];
  return (
    <div className="topbar">
      <div className="crumb">
        <span className="here">{here}</span>
        {subtitle != null && <span className="sep">/</span>}
        {subtitle != null && <span className="addr">{subtitle}</span>}
      </div>
      <div className="search-wrap" ref={wrapRef} style={{ display: "none" }} />
      <div className="dots">
        {right}
      </div>
    </div>
  );
}

Object.assign(window, { useRoute, navigate, consumeNavState, useOverview, ToastStack, pushToast, e2Confirm, ConfirmHost, NavRail, Topbar });
