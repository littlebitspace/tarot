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

// Flips a single card's own face — the animation and state toggle only.
// Says nothing about piles; flipChainFrom() below is what a click actually
// triggers, and calls this once per card in the affected chain.
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
      notifyStateChanged();
    }
  }
  tick();
}

/* =========================================================================
   PILES (CHAINS) — a pile is a simple doubly-linked list, never a tree:
   state.below points to the card this one is stacked on; state.above
   points to the card stacked on top of it. Walking .above from any card
   gives "that card and everything stacked above it" — which is exactly
   the unit that moves together on drag, and the unit a click flips.

   Flipping a chain means physically turning that whole sub-packet over:
   each card's own face toggles independently (so a pile can hold a mix
   of face-up and face-down cards), AND the stacking order reverses —
   what was on top of the sub-packet ends up on the bottom of it. That's
   why clicking the bottom card of a pile flips the entire pile (nothing
   below it to leave behind), while clicking a card in the middle only
   flips it and whatever sits above it, leaving what's underneath alone.
   ========================================================================= */

// [state, state.above, state.above.above, ...] — bottom to top.
export function chainFromRoot(state) {
  const chain = [];
  let cur = state;
  while (cur) { chain.push(cur); cur = cur.above; }
  return chain;
}

export function chainBottom(state) {
  let cur = state;
  while (cur.below) cur = cur.below;
  return cur;
}

// Renumbers z-index bottom-to-top for the WHOLE pile containing this card
// (not just the sub-chain above it), bringing it to the front as a group
// while preserving its internal stacking order.
export function restackChain(anyState) {
  const chain = chainFromRoot(chainBottom(anyState));
  chain.forEach(s => {
    s.z = ++zCounter;
    s.el.style.zIndex = s.z;
  });
}

function detachFromBelow(state) {
  if (state.below) {
    state.below.above = null;
    state.below = null;
  }
}

// Detaches `state` from whatever it's resting on and brings its whole
// (now free-standing) sub-chain to the front. Called as trackPointer's
// onDragStart — i.e. only once an actual drag is confirmed, never on a
// plain click — so exported for deck.js's own trackPointer call too.
export function prepareForDrag(state) {
  detachFromBelow(state);
  chainFromRoot(state).forEach(s => bringToFront(s));
}

// Attaches upperBottom (and everything above it) on top of lowerTop's
// pile. lowerTop must currently be the top of its own pile.
export function attachChain(lowerTop, upperBottom) {
  lowerTop.above = upperBottom;
  upperBottom.below = lowerTop;
  restackChain(lowerTop);
}

// Moves every card from `root` upward by the same (col, row) delta —
// relative offsets within the pile are preserved exactly, wonky fans stay
// wonky. Used both for live drag movement and (indirectly, via
// positionCardAt) for jumping a pile to a new spot. Each member is
// clamped to the table bounds independently (positionCardAt, defined
// below — hoisted, so this forward reference is fine), so a pile dragged
// near the table edge compresses its wonky fan rather than pushing
// non-grabbed cards off the visible table entirely.
function moveChainBy(root, deltaCol, deltaRow) {
  chainFromRoot(root).forEach(s => positionCardAt(s, s.col + deltaCol, s.row + deltaRow));
}

// Flips the sub-chain from `root` upward: toggles each card's own face,
// then reverses that sub-chain's internal stacking order and re-splices
// the new bottom onto whatever `root` was originally sitting on (if
// anything) — see the file-level comment above for why.
export function flipChainFrom(root) {
  const chain = chainFromRoot(root); // bottom..top of the sub-chain being flipped
  const belowAnchor = root.below; // stays fixed underneath; null if root was already a pile's own root

  chain.forEach(s => runFlip(s));

  const reversed = chain.slice().reverse(); // reversed[0] = new bottom, was old top
  reversed.forEach((s, i) => {
    s.below = reversed[i - 1] || null;
    s.above = reversed[i + 1] || null;
  });
  reversed[0].below = belowAnchor;
  if (belowAnchor) belowAnchor.above = reversed[0];

  restackChain(belowAnchor || reversed[0]);
}

function onCardClick(instId) {
  const state = placedCards.get(instId);
  if (!state) return;
  if (chainFromRoot(state).some(s => s.animating)) return; // a flip is already mid-animation somewhere in this sub-chain
  flipChainFrom(state);
}

// Looks for another pile's top card overlapping `state`'s current
// position and, if attachOnDrop is on, attaches state's chain onto it.
// Never attaches to a card already in the same pile.
function tryAttach(state) {
  if (!settings.attachOnDrop) return;
  const ownChain = chainFromRoot(chainBottom(state));
  const r = state.el.getBoundingClientRect();
  for (const other of placedCards.values()) {
    if (ownChain.includes(other)) continue;
    if (other.above) continue; // only attach onto a pile's current top card
    const or = other.el.getBoundingClientRect();
    // Strict inequality: two rects that merely touch at an edge (share a
    // boundary with zero-area intersection) do NOT count as overlapping —
    // only genuine, positive-area overlap does. Adjacent, non-overlapping
    // cards should never attach just because they happen to be neighbors.
    const overlap = !(r.right <= or.left || r.left >= or.right || r.bottom <= or.top || r.top >= or.bottom);
    if (overlap) { attachChain(other, state); return; }
  }
}

// deck.js registers itself here so card.js never has to import deck-level
// concepts (deckOrder, the deck's own DOM) to support recycling. Returns
// true if it consumed the drop (did a recycle) — card.js only tries a
// normal pile attach if this returns falsy or nothing is registered.
let onChainDroppedHandler = null;
export function setOnChainDropped(fn) { onChainDroppedHandler = fn; }

// A higher-level module (persistence.js) can register here to be notified
// after any completed interaction — click-to-flip, drag-to-move, attach,
// or recycle — so it knows when to save. Deliberately generic (no args)
// so card.js never has to know or care what "save" even means.
let onStateChangedHandler = null;
export function setOnStateChanged(fn) { onStateChangedHandler = fn; }
function notifyStateChanged() { if (onStateChangedHandler) onStateChangedHandler(); }

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
// Only moves this one card — see moveChainBy for moving a whole pile.
export function positionCardAt(state, col, row) {
  const r = table.getBoundingClientRect();
  const maxCol = Math.max(0, Math.floor((r.width - CARD_PX_W) / CELL_PX));
  const maxRow = Math.max(0, Math.floor((r.height - CARD_PX_H) / CELL_PX));
  state.col = clamp(col, 0, maxCol);
  state.row = clamp(row, 0, maxRow);
  applyCardPosition(state);
}

function setCardPositionFromPointer(root, clientX, clientY, offsetX, offsetY) {
  const r = table.getBoundingClientRect();
  const newCol = Math.round((clientX - r.left - offsetX) / CELL_PX);
  const newRow = Math.round((clientY - r.top - offsetY) / CELL_PX);
  moveChainBy(root, newCol - root.col, newRow - root.row);
}

export function bringToFront(state) {
  state.z = ++zCounter;
  state.el.style.zIndex = state.z;
}

// Tracks the pointer after a mousedown/touchdown on a card (existing or
// freshly dealt off the deck). If the pointer never moves past the
// threshold before release, onReleaseWithoutMove() runs instead — that's
// the click-vs-drag split: a plain click flips the card's chain, a drag
// just carries it (and everything attached above it). onDragStart fires
// exactly once, the moment movement is first confirmed — NOT on every
// pointerdown — since anything it does (like detaching from the pile
// below) must only happen for an actual drag. Detaching eagerly on every
// pointerdown was the earlier bug: a plain click-to-flip would sever the
// card from its pile before flipChainFrom ever got a chance to see what
// was underneath it to re-splice onto.
export function trackPointer(state, startEvent, { onDragStart, onReleaseWithoutMove }) {
  let moved = false;
  const startX = startEvent.clientX, startY = startEvent.clientY;
  const r = table.getBoundingClientRect();
  const offsetX = startX - r.left - state.col * CELL_PX;
  const offsetY = startY - r.top - state.row * CELL_PX;

  function onMove(e) {
    if (!moved) {
      if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) {
        moved = true;
        if (onDragStart) onDragStart();
      } else {
        return;
      }
    }
    setCardPositionFromPointer(state, e.clientX, e.clientY, offsetX, offsetY);
  }
  function onUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (!moved) { onReleaseWithoutMove(); notifyStateChanged(); return; }
    const droppedChain = chainFromRoot(state);
    const consumed = onChainDroppedHandler ? onChainDroppedHandler(droppedChain) : false;
    if (!consumed) tryAttach(state);
    notifyStateChanged();
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

  const cardPre = buildCardEl(state.faceUp ? state.card.grid : state.backGrid);
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
    trackPointer(state, e, {
      onDragStart: () => prepareForDrag(state),
      onReleaseWithoutMove: () => onCardClick(state.instId),
    });
  });

  state.cardPreEl = cardPre;
  state.tipEl = tip;
  state.el = wrap;
  if (state.faceUp) showTip(state); // matches the front already rendered above
}

// Creates a new placed-card instance, builds its DOM (not yet attached to
// the table — caller does that), and registers it in placedCards. Caller
// is responsible for positioning it (positionCardAt) and appending
// state.el to the table.
//
// faceUp/dir/frameIdx default to a fresh face-down card (the normal deal
// path). persistence.js's restore path passes them explicitly to recreate
// a card in its exact saved state, rendered directly with no flip
// animation — see buildPlacedCardEl above.
export function createPlacedCard({ card, backGrid, reversed, faceUp = false, dir = faceUp ? 1 : 0 }) {
  const instId = "c" + (++instanceCounter);
  const state = {
    instId, card, backGrid, col: 0, row: 0,
    reversed, faceUp, frameIdx: faceUp ? 11 : 0, dir, animating: false, z: 0,
    above: null, below: null,
  };
  buildPlacedCardEl(state);
  placedCards.set(instId, state);
  return state;
}
