// @ts-nocheck
/* Navigation shim bridging the prototype's hash-router helpers to react-router.
 * EditorV3Pages installs the live react-router navigate() via setRouterNavigate.
 * The editor base is "/editor", which matches the prototype's own paths — so no
 * path rewriting is needed (prototype "/editor[/<id>]" maps 1:1). */
import * as React from "react";

let _routerNavigate = null;
export function setRouterNavigate(fn) {
  _routerNavigate = fn;
}

// in-memory nav state (newPolicy seed), matching the prototype's window.__navState.
let _navState = null;

export function navigate(to, opts) {
  _navState = opts && opts.state ? opts.state : null;
  if (_routerNavigate) {
    _routerNavigate(to, { replace: !!(opts && opts.replace) });
  } else {
    window.location.hash = to;
  }
}

export function consumeNavState() {
  const s = _navState;
  _navState = null;
  return s;
}
