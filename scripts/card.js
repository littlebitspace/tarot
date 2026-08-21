import { CELL_PX, CARD_PX_W, CARD_PX_H, CARD_W, settings } from "./config.js";
import { buildCardEl, updateCardEl, makeTextGrid, wrapText } from "./renderer.js";

/* =========================================================================
   FLIP ANIMATION — your original column-mask sequence, replayed by
   building each frame's grid (only the actually-visible columns — see
   buildFrameGrid) and centering it via CSS flex on .card-visual. Same
   array drives both directions: dir 0->1 flips face-down -> face-up,
   1->0 flips back.
   ========================================================================= */
const FLIP_FRAMES = [
  [17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33],
  [17,18,19,21,22,23,24,25,26,27,28,29,31,32,33],
  [17,18,19,21,23,24,25,26,27,29,31,32,33],
  [17,18,20,23,25,27,29,32,33],
  [17,25,33],
  [17],
  [0],
  [0,8,16],
  [0,1,4,6,8,10,12,15,16],
  [0,1,2,4,6,7,8,9,10,12,14,15,16],
  [0,1,2,4,5,6,7,8,9,10,11,12,14,15,16],
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
];

function buildFrameGrid(frame, artGrid, backGrid) {
  const isBack = frame[0] >= 17;
  const source = isBack ? backGrid : artGrid;
  const localCols = isBack ? frame.map(v => v - 17) : frame;
  const width = localCols.length;
  const height = source.height;
  const cells = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let k = 0; k < width; k++) {
      cells[y * width + k] = source.cells[y * CARD_W + localCols[k]];
    }
  }
  return { width, height, cells, bg: source.bg };
}

function frameSeq(forward) {
  const seq = [];
  if (forward) for (let i = 0; i <= 11; i++) seq.push(i);
  else for (let i = 11; i >= 0; i--) seq.push(i);
  return seq;
}

// Preferred manifest format: meaningUpright/meaningReversed as an array of
// short phrases, e.g. ["new beginnings", "spontaneity", "a leap of faith"].
// A plain string is still accepted (comma-split) for backward compatibility
// with manifests written before this existed.
function meaningToList(meaning) {
  if (Array.isArray(meaning)) return meaning;
  if (typeof meaning === "string") return meaning.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

function showTip(state) {
  const card = state.card;
  if (!card.meaningUpright) { state.tipEl.innerHTML = ""; return; } // playing cards: no interpretation, ever
  const items = meaningToList(state.reversed ? card.meaningReversed : card.meaningUpright);
  const lines = [];
  items.forEach(item => {
    const wrapped = wrapText(item, CARD_W + 2); // 2 cols reserved for the "- " marker
    wrapped.forEach((w, i) => lines.push(i === 0 ? `- ${w}` : `  ${w}`));
  });
  if (state.reversed) lines.push({ text: "(reversed)", color: "grayDark" });
  const grid = makeTextGrid(lines, "grayLight");
  state.tipEl.innerHTML = "";
  state.tipEl.appendChild(buildCardEl(grid));
  state.tipEl.style.display = settings.showInterpretations ? "block" : "none";
}

export function runFlip(state) {
  state.animating = true;
  state.tipEl.innerHTML = "";
  const forward = state.dir === 0;
  const seq = frameSeq(forward);
  let i = 0;
  function tick() {
    const frameIdx = seq[i];
    state.frameIdx = frameIdx;
    const grid = buildFrameGrid(FLIP_FRAMES[frameIdx], state.card.grid, state.backGrid);
    updateCardEl(state.cardPreEl, grid);
    i++;
    if (i < seq.length) {
      setTimeout(tick, 100);
    } else {
      state.animating = false;
      state.dir = forward ? 1 : 0;
      state.faceUp = forward;
      if (state.faceUp) showTip(state);
    }
  }
  tick();
}

function onCardClick(instId) {
  const state = placedCards.get(instId);
  if (!state || state.animating) return;
  runFlip(state);
}

/* =========================================================================
   PLACED CARD LIFECYCLE — creation, positioning, dragging. Positions are
   stored as grid cells (col/row), not raw pixels, so a scale change just
   needs CELL_PX to change and every card's pixel position falls out
   correctly with no drift.
   ========================================================================= */
export const table = document.getElementById("table");
export const placedCards = new Map();
let instanceCounter = 0;
let zCounter = 100; // always above #deckArea's z-index (50) — see index.html

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function applyCardPosition(state) {
  state.el.style.left = (state.col * CELL_PX) + "px";
  state.el.style.top = (state.row * CELL_PX) + "px";
}

// Sets a card's position from grid-cell coordinates, clamped to stay
// within the table. Used both for drag moves and for initial placement
// (e.g. deck.js positioning a freshly drawn card on top of the pile).
export function positionCardAt(state, col, row) {
  const r = table.getBoundingClientRect();
  const maxCol = Math.max(0, Math.floor((r.width - CARD_PX_W) / CELL_PX));
  const maxRow = Math.max(0, Math.floor((r.height - CARD_PX_H) / CELL_PX));
  state.col = clamp(col, 0, maxCol);
  state.row = clamp(row, 0, maxRow);
  applyCardPosition(state);
}

function setCardPositionFromPointer(state, clientX, clientY, offsetX, offsetY) {
  const r = table.getBoundingClientRect();
  positionCardAt(
    state,
    Math.round((clientX - r.left - offsetX) / CELL_PX),
    Math.round((clientY - r.top - offsetY) / CELL_PX)
  );
}

export function bringToFront(state) {
  state.z = ++zCounter;
  state.el.style.zIndex = state.z;
}

// Tracks the pointer after a mousedown/touchdown on a card (existing or
// freshly dealt off the deck). If the pointer never moves past the
// threshold before release, onReleaseWithoutMove() runs instead — that's
// the click-vs-drag split: a plain click flips the card, a drag just
// carries it.
export function trackPointer(state, startEvent, onReleaseWithoutMove) {
  let moved = false;
  const startX = startEvent.clientX, startY = startEvent.clientY;
  const r = table.getBoundingClientRect();
  const offsetX = startX - r.left - state.col * CELL_PX;
  const offsetY = startY - r.top - state.row * CELL_PX;

  function onMove(e) {
    if (!moved) {
      if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) moved = true;
      else return;
    }
    setCardPositionFromPointer(state, e.clientX, e.clientY, offsetX, offsetY);
  }
  function onUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (!moved) onReleaseWithoutMove();
  }
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

// Re-applies a placed card's size/position after a scale change — the RLE
// span content underneath doesn't change, only the box it sits in.
export function refreshCardSize(state) {
  state.el.style.width = CARD_PX_W + "px";
  state.el.style.height = CARD_PX_H + "px";
  state.tipEl.style.top = (CARD_PX_H + CELL_PX) + "px";
  applyCardPosition(state);
}

function buildPlacedCardEl(state) {
  const wrap = document.createElement("div");
  wrap.className = "card-wrap";
  wrap.style.width = CARD_PX_W + "px";
  wrap.style.height = CARD_PX_H + "px";

  const visual = document.createElement("div");
  visual.className = "card-visual";
  if (state.reversed) visual.style.transform = "rotate(180deg)";

  const cardPre = buildCardEl(state.backGrid);
  visual.appendChild(cardPre);
  wrap.appendChild(visual);

  // Positioned independently of card-wrap's own box, always anchored to
  // the card's own left edge, regardless of content width or orientation.
  const tip = document.createElement("div");
  tip.className = "card-tip";
  tip.style.position = "absolute";
  tip.style.left = "0px";
  tip.style.top = (CARD_PX_H + CELL_PX) + "px";
  wrap.appendChild(tip);

  wrap.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    bringToFront(state);
    trackPointer(state, e, () => onCardClick(state.instId));
  });

  state.cardPreEl = cardPre;
  state.tipEl = tip;
  state.el = wrap;
}

// Creates a new placed-card instance for a given deck card, builds its DOM
// (not yet attached to the table — caller does that), and registers it in
// placedCards. Caller is responsible for positioning it (positionCardAt)
// and appending state.el to the table.
export function createPlacedCard({ card, backGrid, reversed }) {
  const instId = "c" + (++instanceCounter);
  const state = {
    instId, card, backGrid, col: 0, row: 0,
    reversed, faceUp: false, frameIdx: 0, dir: 0, animating: false, z: 0,
  };
  buildPlacedCardEl(state);
  placedCards.set(instId, state);
  return state;
}