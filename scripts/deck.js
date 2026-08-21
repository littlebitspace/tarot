import {
  CELL_PX, CARD_PX_W, CARD_PX_H,
  settings, lastAppliedSettings, setLastAppliedSettings, snapshotDeckSettings,
} from "./config.js";
import { decodeFramebuf, buildCardEl, buildSliverEl, makeTextGrid } from "./renderer.js";
import { table, placedCards, createPlacedCard, positionCardAt, bringToFront, trackPointer, runFlip } from "./card.js";

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

// Draw: card is created directly on top of the deck. If you just click
// (no movement before release) it flips face-up in place. If you drag it
// away, it goes with you face-down and does NOT flip.
function placeNewCardFromDeck(e) {
  if (deckOrder.length === 0) return;
  const card = deckOrder.shift();

  const state = createPlacedCard({
    card,
    backGrid: resolveBackGrid(card),
    reversed: (lastAppliedSettings && lastAppliedSettings.allUpright) ? false : Math.random() < 0.5,
  });
  table.appendChild(state.el);

  const tRect = table.getBoundingClientRect();
  const dRect = deckStackEl.getBoundingClientRect();
  positionCardAt(
    state,
    Math.round((dRect.left - tRect.left) / CELL_PX),
    Math.round((dRect.top - tRect.top) / CELL_PX)
  );
  bringToFront(state);

  renderDeck();
  trackPointer(state, e, () => runFlip(state));
}

deckStackEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  placeNewCardFromDeck(e);
});