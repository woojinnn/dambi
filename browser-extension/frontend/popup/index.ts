// Pasu popup entry — wires the Claude-designed popup UI (plain-JS) into the
// webpack page bundle. Order matters: `store.js` is an IIFE that publishes
// `window.PasuStore`, which `popup.js` reads at module top-level — so the
// store import MUST come first.
import './pasu.css';
import './popup.css';
import './store.js';
import './popup.js';
