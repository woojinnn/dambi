function parseHash() {
  let h = window.location.hash || "#/editor";
  if (h[0] === "#") h = h.slice(1);
  const [path, qs] = h.split("?");
  const params = new URLSearchParams(qs || "");
  const segs = path.split("/").filter(Boolean);
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
  try {
    const seg = String(to).split("?")[0].split("/").filter(Boolean);
    const isDetail = seg[0] === "editor" && seg.length >= 2;
    if (isDetail && window.parent && window.parent !== window) {
      const state = opts && opts.state ? opts.state : void 0;
      window.parent.postMessage({ source: "dambi-editor-v3", type: "open-policy", to, ...state ? { state } : {} }, window.location.origin);
      return;
    }
  } catch (e) {
  }
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
function useOverview() {
  const [snap, setSnap] = React.useState(() => PS.getOverview());
  React.useEffect(() => PS.subscribe((s) => setSnap(PS.getOverview())), []);
  return snap;
}
const ToastBus = /* @__PURE__ */ (() => {
  const subs = /* @__PURE__ */ new Set();
  return { push: (text) => subs.forEach((cb) => cb(text)), subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)) };
})();
const pushToast = (t) => ToastBus.push(t);
function ToastStack() {
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(
    () => ToastBus.subscribe((text) => {
      const id = Date.now() + Math.floor(Math.random() * 1e3);
      setToasts((t) => [...t, { id, text }]);
      window.setTimeout(() => setToasts((t) => t.filter((m) => m.id !== id)), 2400);
    }),
    []
  );
  if (toasts.length === 0) return null;
  return /* @__PURE__ */ React.createElement("div", { className: "ev2-toaststack" }, toasts.map((t) => /* @__PURE__ */ React.createElement("div", { key: t.id, className: "ev2-toast" }, t.text)));
}
const ConfirmBus = /* @__PURE__ */ (() => {
  const subs = /* @__PURE__ */ new Set();
  return { request: (opts) => subs.forEach((cb) => cb(opts)), subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)) };
})();
function e2Confirm(opts) {
  return new Promise((resolve) => ConfirmBus.request({ ...opts, _resolve: resolve }));
}
function e2Prompt(opts) {
  return new Promise((resolve) => ConfirmBus.request({ ...opts, prompt: true, _resolve: resolve }));
}
function ConfirmHost() {
  const [ask, setAsk] = React.useState(null);
  const [val, setVal] = React.useState("");
  React.useEffect(() => ConfirmBus.subscribe((opts) => {
    setAsk(opts);
    setVal(opts.defaultValue || "");
  }), []);
  const close = (ok) => {
    if (!ask) return;
    if (ask.prompt) ask._resolve(ok ? val.trim() || null : null);
    else ask._resolve(ok);
    setAsk(null);
  };
  React.useEffect(() => {
    if (!ask) return;
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter" && !ask.prompt) close(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask, val]);
  if (!ask) return null;
  const okDisabled = ask.prompt && !val.trim();
  return (
    // `e2` 클래스 필수 — ConfirmHost 는 `.e2` 루트 밖(listpage)에 마운트되므로,
    // `.e2 .e2cf-*` 스타일이 먹으려면 오버레이 자체가 `.e2` 여야 한다. (없으면
    // 버튼이 스타일 없이 "취소제거"로 붙어 보인다.)
    /* @__PURE__ */ React.createElement("div", { className: "e2 e2-ov", onMouseDown: () => close(false) }, /* @__PURE__ */ React.createElement("div", { className: "modal e2cf", onMouseDown: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "e2cf-body" }, /* @__PURE__ */ React.createElement("div", { className: "e2cf-title" }, ask.title), ask.body && /* @__PURE__ */ React.createElement("div", { className: "e2cf-text" }, ask.body), ask.prompt && /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "e2cf-input",
        autoFocus: true,
        value: val,
        placeholder: ask.placeholder || "",
        onChange: (e) => setVal(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter" && val.trim()) close(true);
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "e2cf-foot" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "e2cf-btn cancel", onClick: () => close(false) }, "\uCDE8\uC18C"), /* @__PURE__ */ React.createElement("button", { type: "button", className: `e2cf-btn ok${ask.danger ? " danger" : ""}`, autoFocus: !ask.prompt, disabled: okDisabled, onClick: () => close(true) }, ask.confirmLabel || "\uD655\uC778"))))
  );
}
const navStroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
function NavRail() {
  const route = useRoute();
  const isEditor = route.segs[0] === "editor";
  const items = [
    ["", "Home", /* @__PURE__ */ React.createElement("path", { d: "M3 11.5 12 4l9 7.5M5 10v10h14V10" })],
    ["editor", "Editor", /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "3", width: "7", height: "7", rx: "1.5" }), /* @__PURE__ */ React.createElement("rect", { x: "14", y: "3", width: "7", height: "7", rx: "1.5" }), /* @__PURE__ */ React.createElement("rect", { x: "3", y: "14", width: "7", height: "7", rx: "1.5" }), /* @__PURE__ */ React.createElement("rect", { x: "14", y: "14", width: "7", height: "7", rx: "1.5" }))],
    ["simulation", "Simulation", /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "9" }), /* @__PURE__ */ React.createElement("path", { d: "m10 8.5 5 3.5-5 3.5z" }))],
    ["assets", "Assets", /* @__PURE__ */ React.createElement("path", { d: "M3 12h4l3 8 4-16 3 8h4" })],
    ["market", "Policy Hub", /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("path", { d: "M3 8h18l-2 12H5z" }), /* @__PURE__ */ React.createElement("path", { d: "M8 8V5a4 4 0 0 1 8 0v3" }))]
  ];
  const bottom = [
    ["history", "History", /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("path", { d: "M3 3v18h18" }), /* @__PURE__ */ React.createElement("path", { d: "m7 14 4-4 4 3 5-7" }))],
    ["settings", "Settings", /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" }), /* @__PURE__ */ React.createElement("path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" }))]
  ];
  const Item = ([slug, label, icon]) => {
    const active = slug === "editor" ? isEditor : slug === "" ? route.segs.length === 0 : route.segs[0] === slug;
    return /* @__PURE__ */ React.createElement(
      "a",
      {
        key: slug || "home",
        className: `nav-item${active ? " active" : ""}`,
        href: slug === "editor" ? "#/editor" : "#/" + slug,
        onClick: (e) => {
          if (slug !== "editor" && slug !== "") {
            e.preventDefault();
            pushToast(`${label}\uB294 \uC774 \uB370\uBAA8\uC5D0 \uD3EC\uD568\uB418\uC9C0 \uC54A\uC558\uC5B4\uC694`);
          }
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: "icon" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ...navStroke }, icon)),
      /* @__PURE__ */ React.createElement("span", { className: "label" }, label)
    );
  };
  return /* @__PURE__ */ React.createElement("nav", { className: "nav-rail", tabIndex: 0, "aria-label": "global nav" }, /* @__PURE__ */ React.createElement("div", { className: "nav-logo" }, /* @__PURE__ */ React.createElement("div", { className: "mark" }, "sb"), /* @__PURE__ */ React.createElement("div", { className: "word" }, "dambi")), /* @__PURE__ */ React.createElement("div", { className: "nav-divider" }), /* @__PURE__ */ React.createElement("div", { className: "nav-group" }, items.map(Item)), /* @__PURE__ */ React.createElement("div", { className: "nav-divider" }), /* @__PURE__ */ React.createElement("div", { className: "nav-group" }, bottom.map(Item)), /* @__PURE__ */ React.createElement("div", { className: "nav-bottom" }, /* @__PURE__ */ React.createElement("button", { className: "nav-user", title: "\uACC4\uC815" }, /* @__PURE__ */ React.createElement("span", { className: "av" }, "JK"), /* @__PURE__ */ React.createElement("div", { className: "meta" }, /* @__PURE__ */ React.createElement("div", { className: "nm" }, "jin@dambi.xyz"), /* @__PURE__ */ React.createElement("div", { className: "em" }, "usr_8f2a")), /* @__PURE__ */ React.createElement("span", { className: "nav-user-caret" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", width: "14", height: "14", ...navStroke }, /* @__PURE__ */ React.createElement("path", { d: "m6 14 6-6 6 6" }))))));
}
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
  const hits = needle ? Object.values(snap.library.defs).filter((d) => !d.hidden && (d.displayName.toLowerCase().includes(needle) || d.id.toLowerCase().includes(needle))) : [];
  return /* @__PURE__ */ React.createElement("div", { className: "topbar" }, /* @__PURE__ */ React.createElement("div", { className: "crumb" }, /* @__PURE__ */ React.createElement("span", { className: "here" }, here), subtitle != null && /* @__PURE__ */ React.createElement("span", { className: "sep" }, "/"), subtitle != null && /* @__PURE__ */ React.createElement("span", { className: "addr" }, subtitle)), /* @__PURE__ */ React.createElement("div", { className: "search-wrap", ref: wrapRef, style: { display: "none" } }), /* @__PURE__ */ React.createElement("div", { className: "dots" }, right));
}
Object.assign(window, { useRoute, navigate, consumeNavState, useOverview, ToastStack, pushToast, e2Confirm, e2Prompt, ConfirmHost, NavRail, Topbar });
