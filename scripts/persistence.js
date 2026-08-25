import { SCALE, setScale, settings, lastAppliedSettings, setLastAppliedSettings } from "./config.js";
import { table, placedCards, createPlacedCard, positionCardAt, restackChain } from "./card.js";
import { CARD_SETS, getDeckOrder, setDeckOrder, findCardByFile, resolveBackGrid } from "./deck.js";

const STORAGE_KEY = "tarot-app-state-v1";

// Every placed card holds a real decoded framebuf (card.grid) and direct
// object references to other placed cards (above/below) — neither is
// JSON-serializable, and CARD_SETS itself is rebuilt fresh from the
// manifest on every load anyway. So a card is serialized by its stable
// identity (card.file, a unique path) and re-resolved through
// findCardByFile() on restore; pile links are serialized as instId
// references and re-linked in a second pass once every card exists.
export function saveState() {
  try {
    const data = {
      version: 1,
      scale: SCALE,
      settings: {
        enabledSets: [...settings.enabledSets],
        sameBack: settings.sameBack,
        allUpright: settings.allUpright,
        showInterpretations: settings.showInterpretations,
        attachOnDrop: settings.attachOnDrop,
        cardsPerDraw: settings.cardsPerDraw,
      },
      lastAppliedSettings: lastAppliedSettings ? {
        enabledSets: [...lastAppliedSettings.enabledSets],
        sameBack: lastAppliedSettings.sameBack,
        allUpright: lastAppliedSettings.allUpright,
      } : null,
      deckOrder: getDeckOrder().map(c => c.file),
      placedCards: [...placedCards.values()].map(s => ({
        instId: s.instId,
        cardFile: s.card.file,
        col: s.col,
        row: s.row,
        reversed: s.reversed,
        faceUp: s.faceUp,
        dir: s.dir,
        z: s.z,
        aboveInstId: s.above ? s.above.instId : null,
        belowInstId: s.below ? s.below.instId : null,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Could not save table state:", e.message);
  }
}

// Returns true if a saved session was actually restored (caller should
// skip its normal fresh-start setup), false otherwise (nothing saved,
// or it was corrupt/incompatible — caller falls back to a fresh start).
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return false;

    const validSetIds = new Set(CARD_SETS.map(s => s.id));
    const restoreSnapshot = (saved) => ({
      enabledSets: new Set((saved.enabledSets || []).filter(id => validSetIds.has(id))),
      sameBack: !!saved.sameBack,
      allUpright: !!saved.allUpright,
    });

    settings.enabledSets = restoreSnapshot(data.settings).enabledSets;
    settings.sameBack = !!data.settings.sameBack;
    settings.allUpright = !!data.settings.allUpright;
    settings.showInterpretations = data.settings.showInterpretations !== false;
    settings.attachOnDrop = data.settings.attachOnDrop !== false;
    settings.cardsPerDraw = Math.max(1, data.settings.cardsPerDraw || 1);

    if (data.scale) setScale(data.scale);
    setLastAppliedSettings(data.lastAppliedSettings ? restoreSnapshot(data.lastAppliedSettings) : null);

    setDeckOrder((data.deckOrder || []).map(findCardByFile).filter(Boolean));

    // Pass 1: create every card that still resolves against the current
    // manifest, in original z order (so restackChain below preserves
    // which pile visually sat on top of which). A card whose file no
    // longer exists (manifest changed since the save) is silently
    // dropped — anything that was chained to it just loses that one
    // link in pass 2, rather than blocking the whole restore.
    const byOldId = new Map();
    const records = (data.placedCards || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    records.forEach(rec => {
      const card = findCardByFile(rec.cardFile);
      if (!card) return;
      const state = createPlacedCard({
        card,
        backGrid: resolveBackGrid(card),
        reversed: !!rec.reversed,
        faceUp: !!rec.faceUp,
        dir: rec.dir,
      });
      table.appendChild(state.el);
      positionCardAt(state, rec.col, rec.row);
      byOldId.set(rec.instId, state);
    });

    // Pass 2: re-link piles now that every card exists.
    records.forEach(rec => {
      const state = byOldId.get(rec.instId);
      if (!state) return;
      if (rec.aboveInstId) state.above = byOldId.get(rec.aboveInstId) || null;
      if (rec.belowInstId) state.below = byOldId.get(rec.belowInstId) || null;
    });

    // Re-stack z-index per pile (fresh values, not the saved raw numbers
    // — see card.js), processing roots in their original relative order.
    [...byOldId.values()].filter(s => !s.below).forEach(restackChain);

    return true;
  } catch (e) {
    console.warn("Could not restore saved table state, starting fresh:", e.message);
    return false;
  }
}
