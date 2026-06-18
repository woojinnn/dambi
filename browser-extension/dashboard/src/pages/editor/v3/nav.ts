// @ts-nocheck
/* Navigation shim bridging the prototype's hash-router helpers to react-router.
 * EditorV3Pages installs the live react-router navigate() via setRouterNavigate.
 * Routes the prototype built as "/editor" or "/editor/<id>" are rewritten to
 * "/editor2" here, since /editor2 is the new tab's base. */
import * as React from "react";

let _routerNavigate = null;
export function setRouterNavigate(fn) {
  _routerNavigate = fn;
}

// in-memory nav state (newPolicy seed), matching the prototype's window.__navState.
let _navState = null;

function rewrite(to) {
  // "/editor" → "/editor2", "/editor/<id>?..." → "/editor2/<id>?..."
  if (to === "/editor") return "/editor2";
  if (to.startsWith("/editor/")) return "/editor2/" + to.slice("/editor/".length);
  if (to.startsWith("/editor?")) return "/editor2?" + to.slice("/editor?".length);
  return to;
}

export function navigate(to, opts) {
  _navState = opts && opts.state ? opts.state : null;
  const dest = rewrite(to);
  if (_routerNavigate) {
    _routerNavigate(dest, { replace: !!(opts && opts.replace) });
  } else {
    window.location.hash = dest;
  }
}

export function consumeNavState() {
  const s = _navState;
  _navState = null;
  return s;
}
