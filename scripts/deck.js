import {
  CELL_PX, CARD_PX_W, CARD_PX_H,
  settings, lastAppliedSettings, setLastAppliedSettings, snapshotDeckSettings,
} from "./config.js";
import { decodeFramebuf, buildCardEl, buildSliverEl, makeTextGrid } from "./renderer.js";
import {
  table, placedCards, createPlacedCard, positionCardAt, trackPointer, prepareForDrag,
  chainFromRoot, attachChain, restackChain, setOnChainDropped,
} from "./card.js";

/* =========================================================================
   CARD DATA — loaded from manifest.json + individual per-card files at
   startup, not hardcoded. Every card object ends up as:
   { code, file, name, meaningUpright?, meaningReversed?, grid, set }
   Playing cards simply have no meaningUpright/meaningReversed — that
   absence is the single flag card.js's showTip() checks, no special-
   casing elsewhere.
   ========================================================================= */
export let CARD_SETS = [];

async function fetchJSON(path) {
  let res;
  try {
    res = await fetch(path);
  } catch (e) {
    throw new Error(`${path}: network error (${e.message})`);
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${path}: invalid JSON (${e.message})`);
  }
}

// Returns { errors }. A broken individual card or back is dropped and
// reported rather than aborting the whole load — one typo'd path in a
// 130-card manifest shouldn't blank the entire app. Only manifest.json
// itself failing to load is treated as fully blocking (thrown by this
// function, since there's nothing to build a deck from at all in that
// case) — callers should wrap this in try/catch.
export async function loadManifest() {
  const manifest = await fetchJSON("cards/manifest.json");
  const backCache = new Map(); // path -> Promise<grid>, so a shared back is only fetched/decoded once
  const errors = [];

  function getBackGrid(path) {
    if (!backCache.has(path)) {
      backCache.set(path, fetchJSON(path).then(raw => decodeFramebuf(raw.framebufs[0])));
    }
    return backCache.get(path);
  }

  await Promise.all(manifest.sets.map(async set => {
    try {
      set.backGrid = await getBackGrid(set.back);
    } catch (e) {
      errors.push(`${set.label || set.id} (back): ${e.message}`);
      set.backGrid = null;
    }
    await Promise.all(set.cards.map(async card => {
      try {
        const raw = await fetchJSON(card.file);
        card.grid = decodeFramebuf(raw.framebufs[0]);
        card.set = set;
      } catch (e) {
        errors.push(`${set.label || set.id} / ${card.name || card.file}: ${e.message}`);
        card.grid = null;
      }
    }));
    set.cards = set.cards.filter(c => c.grid);
  }));

  CARD_SETS = manifest.sets.filter(s => s.backGrid && s.cards.length);
  return { errors };
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Which physical back a card shows: its own set's back, unless "same back
// for all cards" was on as of the last shuffle (not the live checkbox —
// see the note in config.js), in which case everything uses the first
// Tarot set's back.
export function resolveBackGrid(card) {
  if (lastAppliedSettings && lastAppliedSettings.sameBack) {
    const tarotSet = CARD_SETS.find(s => s.group === "Tarot");
    if (tarotSet) return tarotSet.backGrid;
  }
  return card.set.backGrid;
}

function buildDeckFromSettings() {
  const list = [];
  for (const set of CARD_SETS) {
    if (!settings.enabledSets.has(set.id)) continue;
    for (const card of set.cards) list.push(card);
  }
  return shuffleArray(list);
}

/* =========================================================================
   DECK — depletes from the top; the window of up to 3 visible layers
   slides toward the deepest card as the deck empties, rather than staying
   pinned to the top-left while outer layers vanish. Only the frontmost
   layer is a full grid; layers behind it render just their last row +
   column (buildSliverEl) since that's the only part ever actually
   visible.
   ========================================================================= */
let deckOrder = []; // populated once the manifest finishes loading and init() runs shuffleDeck()
const deckStackEl = document.getElementById("deckStack");
const deckCountEl = document.getElementById("deckCount");
const MAX_LAYERS = 3;

export function renderDeck() {
  deckStackEl.innerHTML = "";
  deckStackEl.style.width = (CARD_PX_W + (MAX_LAYERS - 1) * CELL_PX) + "px";
  deckStackEl.style.height = (CARD_PX_H + (MAX_LAYERS - 1) * CELL_PX) + "px";

  const layers = Math.min(MAX_LAYERS, deckOrder.length);
  const startOffset = (MAX_LAYERS - layers) * CELL_PX;
  for (let k = layers - 1; k >= 0; k--) {
    const offset = startOffset + k * CELL_PX;
    // Each layer shows the back of the actual card sitting there — if
    // different enabled sets have different backs (and "same back" is
    // off), the stack can genuinely show mixed backs, same as a real
    // shuffled pile of different decks would.
    const backGrid = resolveBackGrid(deckOrder[k]);
    const el = k === 0 ? buildCardEl(backGrid) : buildSliverEl(backGrid);
    el.style.position = "absolute";
    el.style.left = offset + "px";
    el.style.top = offset + "px";
    el.style.zIndex = String(10 - k);
    deckStackEl.appendChild(el);
  }

  deckCountEl.innerHTML = "";
  const countGrid = makeTextGrid([`Cards in deck: ${deckOrder.length}`], "white");
  deckCountEl.appendChild(buildCardEl(countGrid));
}

// Pure data change: rebuilds deckOrder from current settings, clears the
// table, and records what was actually applied. Does NOT re-render —
// callers (Shuffle button handler, init()) call renderDeck() themselves,
// same as they need to re-render the settings panel to clear the
// "shuffle to apply" reminder, which lives outside this module.
export function shuffleDeck() {
  for (const state of placedCards.values()) state.el.remove();
  placedCards.clear();
  deckOrder = buildDeckFromSettings();
  setLastAppliedSettings(snapshotDeckSettings());
}

// Draw: deals settings.cardsPerDraw cards (or fewer if the deck's running
// low) directly on top of the deck, chained together face-down in a
// horizontal fan — the card drawn first ends up on the bottom of the
// pile, the last one drawn on top, matching how dealing a real packet of
// cards works. Every draw goes through this same path regardless of N,
// so a 1-card draw behaves exactly like a bigger one: dealt face-down,
// left for you to flip yourself with a separate click. Dragging the deck
// (instead of a plain click) lets you carry the whole freshly dealt pile
// away in the same gesture.
const DRAW_FAN_STEP = 3; // exposed columns per non-topmost card in a multi-card deal

// Draw: deals settings.cardsPerDraw cards (or fewer if the deck's running
// low) directly on top of the deck, chained together face-down in a
// horizontal fan. This is "pick N cards off the top, keeping their order"
// — not "deal them out" — so the very first card drawn (the one that was
// on top of the deck) ends up on TOP of the resulting pile too, exactly
// where you'd expect to find it, with each card drawn after it stacked
// underneath in turn. Every draw goes through this same path regardless
// of N, so a 1-card draw behaves exactly like a bigger one: dealt
// face-down, left for you to flip yourself with a separate click.
// Dragging the deck (instead of a plain click) lets you carry the whole
// freshly dealt pile away in the same gesture.
function placeNewCardFromDeck(e) {
  const n = Math.min(settings.cardsPerDraw, deckOrder.length);
  if (n === 0) return;

  const tRect = table.getBoundingClientRect();
  const dRect = deckStackEl.getBoundingClientRect();
  const baseCol = Math.round((dRect.left - tRect.left) / CELL_PX);
  const baseRow = Math.round((dRect.top - tRect.top) / CELL_PX);

  // Draw all N first, in order (states[0] = first drawn = deck's former
  // top card), before deciding how to chain them.
  const states = [];
  for (let i = 0; i < n; i++) {
    const card = deckOrder.shift();
    const state = createPlacedCard({
      card,
      backGrid: resolveBackGrid(card),
      reversed: (lastAppliedSettings && lastAppliedSettings.allUpright) ? false : Math.random() < 0.5,
    });
    table.appendChild(state.el);
    // Most-exposed (rightmost, full width) slot goes to the first-drawn
    // card, matching it ending up on top of the z-stack below — the
    // topmost card in a real fan is the one covering the others.
    positionCardAt(state, baseCol + (n - 1 - i) * DRAW_FAN_STEP, baseRow);
    states.push(state);
  }

  // Chain bottom-to-top in REVERSE draw order (last-drawn/deepest first,
  // first-drawn/topmost last), so the final stack has states[0] on top.
  let bottomState = null;
  let currentTop = null;
  for (let i = n - 1; i >= 0; i--) {
    const state = states[i];
    if (currentTop) attachChain(currentTop, state);
    else bottomState = state;
    currentTop = state;
  }
  restackChain(bottomState);

  renderDeck();
  trackPointer(bottomState, e, { onDragStart: () => prepareForDrag(bottomState), onReleaseWithoutMove: () => {} });
}

deckStackEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  placeNewCardFromDeck(e);
});

/* =========================================================================
   RECYCLING — dropping a pile onto the empty deck turns it back into
   deckOrder. Registered as a hook so card.js's drop handling never has to
   know decks exist. We can't tell which cards are "the waste pile"
   specifically (any card could be dropped on the deck), so this only
   fires when the deck is actually empty, and treats whatever chain got
   dropped there as the thing to recycle.

   Order: since a waste pile is built by attaching each newly-played card
   on top of the last, an un-flipped pile has its oldest (first-drawn)
   card on the bottom and newest on top — so reading it bottom-to-top
   reproduces the original draw order. A pile the player has manually
   flipped face-down has already had that order reversed once by the flip
   itself, so reading it top-to-bottom reproduces it instead. Since a pile
   can mix face-up and face-down cards, majority face state decides which
   reading to use.
   ========================================================================= */
setOnChainDropped((chain) => {
  if (deckOrder.length !== 0) return false;

  const dRect = deckStackEl.getBoundingClientRect();
  const overlapsDeck = chain.some(s => {
    const cr = s.el.getBoundingClientRect();
    return !(cr.right < dRect.left || cr.left > dRect.right || cr.bottom < dRect.top || cr.top > dRect.bottom);
  });
  if (!overlapsDeck) return false;

  const faceUpCount = chain.filter(s => s.faceUp).length;
  const majorityFaceUp = faceUpCount * 2 > chain.length;
  const chronological = majorityFaceUp ? chain : chain.slice().reverse();

  deckOrder = chronological.map(s => s.card);
  chain.forEach(s => { placedCards.delete(s.instId); s.el.remove(); });
  renderDeck();
  return true;
});
