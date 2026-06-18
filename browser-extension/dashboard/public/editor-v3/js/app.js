function App() {
  const route = useRoute();
  const isDetail = route.segs[0] === "editor" && route.segs.length >= 2;
  return /* @__PURE__ */ React.createElement("div", { className: "app-frame embedded" }, /* @__PURE__ */ React.createElement("main", { className: "app-content" }, isDetail ? /* @__PURE__ */ React.createElement(EditorDetailPageV2, null) : /* @__PURE__ */ React.createElement(EditorListPageV2, null)));
}
if (!window.location.hash || window.location.hash === "#" || window.location.hash === "#/") {
  window.history.replaceState(null, "", window.location.href.split("#")[0] + "#/editor");
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
