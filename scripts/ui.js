import { SCALE, CELL_PX, setScale, settings, lastAppliedSettings, snapshotDeckSettings, deckSettingsMatch } from "./config.js";
import { makeTextGrid, wrapText, buildCardEl } from "./renderer.js";
import { placedCards, clamp, refreshCardSize, setOnStateChanged } from "./card.js";
import { CARD_SETS, loadManifest, renderDeck, shuffleDeck } from "./deck.js";
import { saveState, loadState } from "./persistence.js";

// Card-level interactions (click-to-flip, drag/attach, recycle) notify
// through this hook rather than ui.js having to be threaded into every
// mutation site in card.js/deck.js — see card.js's setOnStateChanged.
// Settings-panel and scale changes call saveState() directly below,
// since those never touch card.js's drag/flip machinery at all.
setOnStateChanged(saveState);

const table = document.getElementById("table");
const deckCountEl = document.getElementById("deckCount");
const shuffleBtnEl = document.getElementById("shuffleBtn");
const settingsPanelEl = document.getElementById("settingsPanel");
const deckAreaEl = document.getElementById("deckArea");
const scaleControlEl = document.getElementById("scaleControl");

function renderShuffleBtn() {
  shuffleBtnEl.innerHTML = "";
  const label = "SHUFFLE";
  const inner = `  ${label}  `;
  const border = "─".repeat(inner.length);
  const grid = makeTextGrid([
    "╭" + border + "╮",
    "│" + inner + "│",
    "╰" + border + "╯",
  ], "white");
  shuffleBtnEl.appendChild(buildCardEl(grid));
}

shuffleBtnEl.addEventListener("click", () => {
  shuffleDeck();
  renderDeck();
  renderSettingsPanel();
});

/* =========================================================================
   SETTINGS PANEL — reads/writes the settings object from config.js;
   card.js and deck.js key their own draw-time behavior off the same
   object (specifically off lastAppliedSettings, which only updates on
   Shuffle — see config.js for why).
   ========================================================================= */
function addSettingsLine(grid, onClick) {
  const el = buildCardEl(grid);
  if (onClick) { el.style.cursor = "pointer"; el.addEventListener("click", onClick); }
  settingsPanelEl.appendChild(el);
  return el;
}

function addBlankLine() {
  settingsPanelEl.appendChild(buildCardEl(makeTextGrid([""], "white")));
}

// "[-] Cards per draw: N [+]" — same boxed-button style as the scale
// control (buildMiniBtn, defined below; function declarations are
// hoisted, so the forward reference here is fine).
function buildCardsPerDrawRow() {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = CELL_PX + "px";
  const minusEl = buildMiniBtn("-", () => {
    settings.cardsPerDraw = clamp(settings.cardsPerDraw - 1, 1, 10);
    renderSettingsPanel();
  });
  const labelEl = buildCardEl(makeTextGrid([`Cards per draw: ${settings.cardsPerDraw}`], "white"));
  const plusEl = buildMiniBtn("+", () => {
    settings.cardsPerDraw = clamp(settings.cardsPerDraw + 1, 1, 10);
    renderSettingsPanel();
  });
  row.appendChild(minusEl);
  row.appendChild(labelEl);
  row.appendChild(plusEl);
  settingsPanelEl.appendChild(row);
}

function renderSettingsPanel() {
  settingsPanelEl.innerHTML = "";
  addSettingsLine(makeTextGrid(["Cards in the deck"], "white"));
  addBlankLine();

  let lastGroup = null;
  for (const set of CARD_SETS) {
    if (set.group !== lastGroup) {
      lastGroup = set.group;
      addSettingsLine(makeTextGrid([set.group], "white"));
      addBlankLine();
    }
    const checked = settings.enabledSets.has(set.id);
    addSettingsLine(makeTextGrid([`[${checked ? "x" : " "}] ${set.label}`], "white"), () => {
      if (checked) settings.enabledSets.delete(set.id);
      else settings.enabledSets.add(set.id);
      renderSettingsPanel();
    });
    addBlankLine();
  }

  addSettingsLine(makeTextGrid(["-".repeat(20)], "grayDark"));
  addBlankLine();

  addSettingsLine(makeTextGrid([`[${settings.sameBack ? "x" : " "}] Same back for all cards`], "white"), () => {
    settings.sameBack = !settings.sameBack;
    renderSettingsPanel();
  });
  addBlankLine();

  addSettingsLine(makeTextGrid([`[${settings.allUpright ? "x" : " "}] All cards upright`], "white"), () => {
    settings.allUpright = !settings.allUpright;
    renderSettingsPanel();
  });
  addBlankLine();

  addSettingsLine(makeTextGrid(["-".repeat(20)], "grayDark"));
  addBlankLine();

  addSettingsLine(makeTextGrid([`[${settings.attachOnDrop ? "x" : " "}] Attach cards on drop`], "white"), () => {
    settings.attachOnDrop = !settings.attachOnDrop;
    renderSettingsPanel();
  });
  addBlankLine();

  buildCardsPerDrawRow();
  addBlankLine();

  addSettingsLine(makeTextGrid([`[${settings.showInterpretations ? "x" : " "}] Show Interpretations`], "white"), () => {
    settings.showInterpretations = !settings.showInterpretations;
    placedCards.forEach(state => {
      if (state.tipEl.children.length) state.tipEl.style.display = settings.showInterpretations ? "block" : "none";
    });
    renderSettingsPanel();
  });
  addBlankLine();

  if (lastAppliedSettings && !deckSettingsMatch(snapshotDeckSettings(), lastAppliedSettings)) {
    addSettingsLine(makeTextGrid(["Shuffle to apply deck changes"], "yellow"));
  }

  saveState();
}

/* =========================================================================
   SCALE CONTROL — "[-] Scale 1x [+]", buttons boxed the same way the
   shuffle button is.
   ========================================================================= */
function buildMiniBtn(label, onClick) {
  const inner = ` ${label} `;
  const border = "─".repeat(inner.length);
  const grid = makeTextGrid([
    "╭" + border + "╮",
    "│" + inner + "│",
    "╰" + border + "╯",
  ], "white");
  const el = buildCardEl(grid);
  el.classList.add("btn");
  el.addEventListener("click", onClick);
  return el;
}

function renderScaleControl() {
  scaleControlEl.innerHTML = "";
  const minusEl = buildMiniBtn("-", () => applyScale(SCALE - 1));
  const labelEl = buildCardEl(makeTextGrid([`Scale ${SCALE}x`], "white"));
  const plusEl = buildMiniBtn("+", () => applyScale(SCALE + 1));
  scaleControlEl.appendChild(minusEl);
  scaleControlEl.appendChild(labelEl);
  scaleControlEl.appendChild(plusEl);
}

// All UI chrome (not just card art) sits on the same CELL_PX grid — one
// full cell of gap between stacked elements, positions as exact multiples
// of CELL_PX. Re-run whenever CELL_PX changes (see applyScale).
function layoutChrome() {
  scaleControlEl.style.top = CELL_PX + "px";
  scaleControlEl.style.gap = CELL_PX + "px";
  const scaleControlHeight = 3 * CELL_PX; // mini buttons are 3 grid-rows tall
  deckAreaEl.style.top = (CELL_PX + scaleControlHeight + CELL_PX) + "px";
  deckAreaEl.style.left = CELL_PX + "px";
  deckCountEl.style.marginTop = CELL_PX + "px";
  shuffleBtnEl.style.marginTop = CELL_PX + "px";
  settingsPanelEl.style.marginTop = CELL_PX + "px";
}

// Re-applies everything that depends on the current CELL_PX — called both
// when the user actually changes scale (applyScale below) and once after
// a restore, since loadState() may have changed SCALE before any of this
// UI existed to react to it (module load runs synchronously, before
// init()'s async restore ever executes).
function refreshForScale() {
  table.style.backgroundSize = CELL_PX + "px " + CELL_PX + "px";
  // Every already-built card-pre just needs its font resized — the RLE
  // span content underneath doesn't change with scale.
  document.querySelectorAll(".card-pre").forEach(pre => {
    pre.style.fontSize = CELL_PX + "px";
    pre.style.lineHeight = CELL_PX + "px";
  });
  placedCards.forEach(refreshCardSize);
  renderDeck();
  renderScaleControl();
  layoutChrome();
}

function applyScale(newScale) {
  newScale = clamp(newScale, 1, 4);
  if (newScale === SCALE) return;
  setScale(newScale);
  refreshForScale();
  saveState();
}

table.style.backgroundSize = CELL_PX + "px " + CELL_PX + "px";
renderShuffleBtn();
renderScaleControl();
layoutChrome();

function renderLoadErrors(errors) {
  if (!errors.length) return;
  console.error("Card loading errors:\n" + errors.join("\n"));
  const shown = errors.slice(0, 8);
  const lines = [`${errors.length} card(s) failed to load:`];
  shown.forEach(e => lines.push(...wrapText(e, 30)));
  if (errors.length > shown.length) lines.push(`...and ${errors.length - shown.length} more (see console)`);
  const box = buildCardEl(makeTextGrid(lines, "red"));
  box.style.marginTop = "12px";
  deckAreaEl.appendChild(box);
}

async function init() {
  let errors = [];
  try {
    ({ errors } = await loadManifest());
  } catch (e) {
    // manifest.json itself failed — nothing to build a deck from at all
    errors = [e.message];
  }

  const restored = loadState();
  if (!restored) {
    // Default selection: the two real tarot sets, matching the original
    // mock. If your manifest uses different set ids, this just ends up
    // empty — check the ids in your manifest against these two strings.
    settings.enabledSets = new Set(
      CARD_SETS.filter(s => s.id === "tarotMajor" || s.id === "tarotMinor").map(s => s.id)
    );
    shuffleDeck(); // builds deckOrder fresh + records lastAppliedSettings; nothing on the table yet to clear
  }
  refreshForScale(); // includes renderDeck(); also picks up a restored SCALE, since module-level rendering above ran before this async restore did
  renderSettingsPanel();
  renderLoadErrors(errors);
}
init();
