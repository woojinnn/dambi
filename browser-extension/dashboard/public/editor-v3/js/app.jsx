/* ── App router + mount ── */
function App() {
  const route = useRoute();
  const isDetail = route.segs[0] === "editor" && route.segs.length >= 2;
  // 대시보드 안 iframe으로 임베드되므로 프로토타입 자체 NavRail은 그리지 않는다
  // (바깥 대시보드 NavRail과 중복 방지). 콘텐츠만 렌더.
  return (
    <div className="app-frame embedded">
      <main className="app-content">{isDetail ? <EditorDetailPageV2 /> : <EditorListPageV2 />}</main>
    </div>
  );
}

// default route
if (!window.location.hash || window.location.hash === "#" || window.location.hash === "#/") {
  window.history.replaceState(null, "", window.location.href.split("#")[0] + "#/editor");
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
