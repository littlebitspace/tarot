// Scale/dimension state, and deck-settings state (which cards are enabled,
// same-back, all-upright, show-interpretations, and what was actually
// baked into the deck as of the last shuffle).
//
// Both card.js and deck.js need to read settings, and neither can depend
// on the settings *panel* (which renders checkboxes and lives above them
// in the dependency chain) — so the panel's UI stays separate, but the
// data it reads and writes lives here.
//
// Everything mutable here is exported as a live binding (`let`/`const`
// object) — importers see updates automatically, but per ES module
// semantics can't reassign an imported `let` binding themselves. Where
// that's needed (SCALE, lastAppliedSettings) a setter function is the
// only way to change it; `settings`' own properties can still be mutated
// directly by importers since only the object's contents change, not
// which object the `settings` binding points to.

export const BASE_CELL_PX = 8; // glyphs are native 8x8px; 1x = true native size
export const CARD_W = 17;
export const CARD_H = 25;

export let SCALE = 2; // default: 2x (16px cells) for legibility
export let CELL_PX = BASE_CELL_PX * SCALE;
export let CARD_PX_W = CARD_W * CELL_PX;
export let CARD_PX_H = CARD_H * CELL_PX;

export function setScale(newScale) {
  SCALE = newScale;
  CELL_PX = BASE_CELL_PX * SCALE;
  CARD_PX_W = CARD_W * CELL_PX;
  CARD_PX_H = CARD_H * CELL_PX;
}

/* =========================================================================
   DECK SETTINGS — set checkboxes, "Same back for all cards", and
   "All cards upright" only take effect on the next Shuffle: what a drawn
   card actually looks like (back, orientation) is locked to
   lastAppliedSettings, not the live checkbox state, so toggling something
   mid-table can't retroactively change draw behavior before Shuffle is
   pressed. "Show Interpretations" is the one exception — a pure display
   toggle that applies immediately, which is why it's tracked in `settings`
   but deliberately left out of the snapshot/match pair below.
   ========================================================================= */
export const settings = {
  enabledSets: new Set(), // filled once CARD_SETS is known, see deck.js
  sameBack: false,
  allUpright: false,
  showInterpretations: true,
  attachOnDrop: true, // dropping a card onto another card's pile attaches them into a chain
  cardsPerDraw: 1, // how many cards a single draw deals, chained together face-down
};

// The {enabledSets, sameBack, allUpright} actually baked into the current
// deck — lets deck.js and card.js key draw-time behavior off what was true
// as of the last shuffle, and lets the (still-inline) settings panel show
// or hide the "shuffle to apply" reminder.
export let lastAppliedSettings = null;

export function setLastAppliedSettings(snapshot) {
  lastAppliedSettings = snapshot;
}

export function snapshotDeckSettings() {
  return {
    enabledSets: new Set(settings.enabledSets),
    sameBack: settings.sameBack,
    allUpright: settings.allUpright,
  };
}

export function deckSettingsMatch(a, b) {
  if (a.sameBack !== b.sameBack) return false;
  if (a.allUpright !== b.allUpright) return false;
  if (a.enabledSets.size !== b.enabledSets.size) return false;
  for (const id of a.enabledSets) if (!b.enabledSets.has(id)) return false;
  return true;
}
