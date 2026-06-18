const _ic = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", width: 16, height: 16 };
const _st = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
const ShieldIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" }), /* @__PURE__ */ React.createElement("path", { d: "M9 12l2 2 4-4" }));
const SearchIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, ...p }, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "7" }), /* @__PURE__ */ React.createElement("path", { d: "M16 16l5 5" }));
const XIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, strokeWidth: 2.2, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M6 6l12 12M18 6L6 18" }));
const TrashIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0v12a1 1 0 01-1 1H8a1 1 0 01-1-1V7" }), /* @__PURE__ */ React.createElement("path", { d: "M10 11v6M14 11v6" }));
const PlusIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, strokeWidth: 2.3, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M12 5v14M5 12h14" }));
const CaretRightIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M9 6l6 6-6 6" }));
const FolderIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, strokeWidth: 1.9, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" }));
const PackageIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, strokeWidth: 1.8, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M21 8 12 3 3 8v8l9 5 9-5z" }), /* @__PURE__ */ React.createElement("path", { d: "M3 8l9 5 9-5M12 13v8" }));
const PencilIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M4 20l4-1 10-10-3-3L5 16z" }), /* @__PURE__ */ React.createElement("path", { d: "M14 6l3 3" }));
const CopyIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, ...p }, /* @__PURE__ */ React.createElement("rect", { x: "9", y: "9", width: "11", height: "11", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M5 15V6a2 2 0 0 1 2-2h9" }));
const WarnIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M12 3l9 16H3z" }), /* @__PURE__ */ React.createElement("path", { d: "M12 10v4M12 17h.01" }));
const CheckIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, strokeWidth: 2.4, ...p }, /* @__PURE__ */ React.createElement("path", { d: "M5 13l4 4L19 7" }));
const LockIcon = (p) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, ...p }, /* @__PURE__ */ React.createElement("rect", { x: "5", y: "11", width: "14", height: "9", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M8 11V8a4 4 0 018 0v3" }));
const CAT_PATHS = {
  swap: "M7 7h11l-3-3M17 17H6l3 3",
  amm: "M12 3c3 4 6 7 6 10a6 6 0 01-12 0c0-3 3-6 6-10z",
  perp: "M3 17l5-6 4 3 5-7 4 4",
  bridge: "M3 16c0-4 3-7 9-7s9 3 9 7M8 13v6M16 13v6",
  security: "M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6z",
  airdrop: "M12 3a6 6 0 016 6c0 3-6 9-6 9S6 12 6 9a6 6 0 016-6M12 21v-3",
  lending: "M3 10h18M5 10v8h14v-8M9 14h6",
  nft: "M4 4h16v16H4zM8 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3M4 16l5-4 4 3 3-2 4 3",
  core: "M12 3l8 4v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  token: "M12 4a8 8 0 100 16 8 8 0 000-16M9.5 12l1.8 1.8 3.5-3.6"
};
function CatIcon({ cat, ...p }) {
  const d = cat && CAT_PATHS[cat] || CAT_PATHS.core;
  return /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", ..._ic, strokeWidth: 1.9, ...p }, /* @__PURE__ */ React.createElement("path", { d }));
}
const CAT = {
  swap: { ko: "\uC2A4\uC651", hex: "#688186", soft: "#DCEAED", ink: "#2B3639" },
  amm: { ko: "AMM\xB7LP", hex: "#85A4AB", soft: "#EDF4F6", ink: "#2B3639" },
  perp: { ko: "\uD37C\uD504", hex: "#485A5E", soft: "#CAE0E4", ink: "#2B3639" },
  bridge: { ko: "\uBE0C\uB9BF\uC9C0", hex: "#A4C9D1", soft: "#EDF4F6", ink: "#485A5E" },
  security: { ko: "\uBCF4\uC548", hex: "#637E59", soft: "#EBF3E8", ink: "#283523" },
  airdrop: { ko: "\uC5D0\uC5B4\uB4DC\uB78D", hex: "#44583D", soft: "#D9E9D3", ink: "#283523" },
  lending: { ko: "\uB80C\uB529", hex: "#384455", soft: "#D7DBDF", ink: "#0D1118" },
  nft: { ko: "NFT", hex: "#697485", soft: "#EFF0F2", ink: "#1B222C" },
  core: { ko: "\uCF54\uC5B4", hex: "#2A3441", soft: "#D7DBDF", ink: "#0D1118" },
  token: { ko: "\uD1A0\uD070", hex: "#9099A5", soft: "#EFF0F2", ink: "#2A3441" }
};
const CAT_ORDER = ["security", "swap", "lending", "airdrop", "perp", "bridge", "nft", "amm", "core", "token"];
const catKey = (cat) => cat && cat in CAT ? cat : "core";
const catLabel = (cat) => CAT[catKey(cat)].ko;
function catStyle(cat) {
  const c = CAT[catKey(cat)];
  return { iconWrap: { background: c.soft, color: c.hex }, tag: { background: c.soft, color: c.ink }, hex: c.hex, soft: c.soft, ink: c.ink };
}
const FAM = {
  gold: { ko: "\uC790\uC0B0", icon: "#A9781F", soft: "#F3E7CE", ink: "#4A330F" },
  cyan: { ko: "\uAC70\uB798", icon: "#4E6468", soft: "#D3E3E6", ink: "#2B3639" },
  slate: { ko: "\uC2A4\uD14C\uC774\uD0B9\xB7\uC778\uD504\uB77C\xB7\uAE30\uD0C0", icon: "#44516A", soft: "#E2E6EA", ink: "#1B222C" }
};
const EDITOR_CAT_TO_MARKET = {
  token: "Token",
  swap: "DEX",
  amm: "DEX",
  perp: "Perp",
  bridge: "Bridge",
  lending: "Lending",
  nft: "NFT",
  airdrop: "Airdrop"
};
const MARKET_CAT_FAMILY = {
  Token: "gold",
  NFT: "gold",
  Airdrop: "gold",
  Launchpad: "gold",
  DEX: "cyan",
  Perp: "cyan",
  Bridge: "cyan",
  Lending: "slate",
  LiquidStaking: "slate",
  Staking: "slate",
  Restaking: "slate",
  Others: "slate"
};
function toMarketCategory(cat) {
  if (cat && cat in MARKET_CAT_FAMILY) return cat;
  return cat && EDITOR_CAT_TO_MARKET[String(cat).toLowerCase()] || "Others";
}
const catFam = (cat) => MARKET_CAT_FAMILY[toMarketCategory(cat)] || "slate";
function famStyle(cat) {
  const f = FAM[catFam(cat)];
  return { tile: { background: f.soft, color: f.icon }, icon: f.icon, soft: f.soft, ko: f.ko };
}
const SEV_LABEL = { deny: "\uCC28\uB2E8", warn: "\uACBD\uACE0", info: "\uC815\uBCF4" };
const sevLabel = (s) => SEV_LABEL[s] || null;
function mtimeLabel(ms) {
  const d = Date.now() - ms;
  const H = 36e5, D = 24 * H;
  if (d < 60 * 6e4) return `${Math.max(1, Math.floor(d / 6e4))}\uBD84 \uC804`;
  if (d < D) return `${Math.floor(d / H)}\uC2DC\uAC04 \uC804`;
  if (d < 7 * D) return `${Math.floor(d / D)}\uC77C \uC804`;
  return `${Math.floor(d / (7 * D))}\uC8FC \uC804`;
}
const shortAddr = (a) => a && a.length > 12 ? `${a.slice(0, 6)}\u2026${a.slice(-4)}` : a;
Object.assign(window, {
  ShieldIcon,
  SearchIcon,
  XIcon,
  TrashIcon,
  PlusIcon,
  CaretRightIcon,
  FolderIcon,
  PackageIcon,
  PencilIcon,
  CopyIcon,
  WarnIcon,
  CheckIcon,
  LockIcon,
  CatIcon,
  CAT,
  CAT_ORDER,
  catKey,
  catLabel,
  catStyle,
  mtimeLabel,
  shortAddr,
  FAM,
  catFam,
  famStyle,
  toMarketCategory,
  SEV_LABEL,
  sevLabel
});
