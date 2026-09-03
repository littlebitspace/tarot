import { SCALE, CELL_PX, setScale, settings, lastAppliedSettings, snapshotDeckSettings, deckSettingsMatch } from "./config.js";
import { makeTextGrid, wrapText, buildCardEl } from "./renderer.js";
import { placedCards, clamp, refreshCardSize, setOnStateChanged } from "./card.js";
import { CARD_SETS, loadManifest, renderDeck, shuffleDeck, playShuffleAnimation } from "./deck.js";
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

// PETSCII palette colour used for checkbox markers.
const ACCENT_COLOR = "redDark";

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

let shuffleBusy = false;
shuffleBtnEl.addEventListener("click", async () => {
  if (shuffleBusy) return;
  shuffleBusy = true;
  shuffleBtnEl.style.opacity = "0.6";
  shuffleDeck();
  renderDeck();
  renderSettingsPanel();
  await playShuffleAnimation();
  renderDeck();
  shuffleBtnEl.style.opacity = "1";
  shuffleBusy = false;
});

/* settings panel */

function addSettingsLine(grid, onClick) {
  const el = buildCardEl(grid);
  if (onClick) {
    el.style.cursor = "pointer";
    el.addEventListener("click", onClick);
  }
  settingsPanelEl.appendChild(el);
  return el;
}

function addBlankLine() {
  settingsPanelEl.appendChild(buildCardEl(makeTextGrid([""], "white")));
}

function checkboxText(state) {
  if (state === "on") return "x";
  if (state === "indeterminate") return "-";
  return " ";
}

/*
 * makeTextGrid() supports one colour per line, but checkbox rows need
 * the marker itself to have a different colour from the surrounding text.
 * Build that one-row grid manually so only x / - uses the accent colour.
 */
function makeCheckboxGrid(state, label, indent = "") {
  const marker = checkboxText(state);
  const text = `${indent}[${marker}] ${label}`;

  const cells = Array.from(text, (char, index) => {
    const markerIndex = indent.length + 1;
    const color =
      (marker === "x" || marker === "-") && index === markerIndex
        ? ACCENT_COLOR
        : "white";

    return { char, color };
  });

  return {
    width: text.length,
    height: 1,
    cells,
    bg: "black",
  };
}

function getGroupState(group) {
  const sets = CARD_SETS.filter(set => set.group === group);

  if (!sets.length) return "off";

  const enabledCount = sets.filter(
    set => settings.enabledSets.has(set.id)
  ).length;

  if (enabledCount === 0) return "off";
  if (enabledCount === sets.length) return "on";
  return "indeterminate";
}

function toggleGroup(group) {
  const sets = CARD_SETS.filter(set => set.group === group);
  const state = getGroupState(group);

  if (state === "on") {
    sets.forEach(set => settings.enabledSets.delete(set.id));
  } else {
    sets.forEach(set => settings.enabledSets.add(set.id));
  }

  renderSettingsPanel();
}

function buildCardsPerDrawRow() {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = CELL_PX + "px";

  const minusEl = buildMiniBtn("-", () => {
    settings.cardsPerDraw = clamp(settings.cardsPerDraw - 1, 1, 10);
    renderSettingsPanel();
  });

  const labelEl = buildCardEl(
    makeTextGrid([`Cards per draw: ${settings.cardsPerDraw}`], "white")
  );

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

      const groupState = getGroupState(set.group);

      addSettingsLine(
        makeCheckboxGrid(groupState, set.group),
        () => toggleGroup(set.group)
      );

      addBlankLine();
    }

    const checked = settings.enabledSets.has(set.id);

    addSettingsLine(
      makeCheckboxGrid(checked ? "on" : "off", set.label, "  "),
      () => {
        if (checked) {
          settings.enabledSets.delete(set.id);
        } else {
          settings.enabledSets.add(set.id);
        }

        renderSettingsPanel();
      }
    );

    addBlankLine();
  }

  addSettingsLine(makeTextGrid(["-".repeat(20)], "grayDark"));
  addBlankLine();

  addSettingsLine(
    makeCheckboxGrid(
      settings.sameBack ? "on" : "off",
      "Same back for all cards"
    ),
    () => {
      settings.sameBack = !settings.sameBack;
      renderSettingsPanel();
    }
  );
  addBlankLine();

  addSettingsLine(
    makeCheckboxGrid(
      settings.allUpright ? "on" : "off",
      "All cards upright"
    ),
    () => {
      settings.allUpright = !settings.allUpright;
      renderSettingsPanel();
    }
  );
  addBlankLine();

  addSettingsLine(makeTextGrid(["-".repeat(20)], "grayDark"));
  addBlankLine();

  addSettingsLine(
    makeCheckboxGrid(
      settings.attachOnDrop ? "on" : "off",
      "Attach cards on drop"
    ),
    () => {
      settings.attachOnDrop = !settings.attachOnDrop;
      renderSettingsPanel();
    }
  );
  addBlankLine();

  buildCardsPerDrawRow();
  addBlankLine();

  addSettingsLine(
    makeCheckboxGrid(
      settings.showInterpretations ? "on" : "off",
      "Show Interpretations"
    ),
    () => {
      settings.showInterpretations = !settings.showInterpretations;

      placedCards.forEach(state => {
        if (state.tipEl.children.length) {
          state.tipEl.style.display =
            settings.showInterpretations ? "block" : "none";
        }
      });

      renderSettingsPanel();
    }
  );
  addBlankLine();

  if (
    lastAppliedSettings &&
    !deckSettingsMatch(snapshotDeckSettings(), lastAppliedSettings)
  ) {
    addSettingsLine(
      makeTextGrid(["Shuffle to apply deck changes"], "yellow")
    );
  }

  saveState();
}

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
  const labelEl = buildCardEl(
    makeTextGrid([`Scale ${SCALE}x`], "white")
  );
  const plusEl = buildMiniBtn("+", () => applyScale(SCALE + 1));

  scaleControlEl.appendChild(minusEl);
  scaleControlEl.appendChild(labelEl);
  scaleControlEl.appendChild(plusEl);
}

function layoutChrome() {
  scaleControlEl.style.top = CELL_PX + "px";
  scaleControlEl.style.gap = CELL_PX + "px";

  const scaleControlHeight = 3 * CELL_PX;

  deckAreaEl.style.top =
    (CELL_PX + scaleControlHeight + CELL_PX) + "px";
  deckAreaEl.style.left = CELL_PX + "px";

  deckCountEl.style.marginTop = CELL_PX + "px";
  shuffleBtnEl.style.marginTop = CELL_PX + "px";
  settingsPanelEl.style.marginTop = CELL_PX + "px";
}

function refreshForScale() {
  table.style.backgroundSize = CELL_PX + "px " + CELL_PX + "px";

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

  if (errors.length > shown.length) {
    lines.push(
      `...and ${errors.length - shown.length} more (see console)`
    );
  }

  const box = buildCardEl(makeTextGrid(lines, "red"));
  box.style.marginTop = "12px";
  deckAreaEl.appendChild(box);
}

async function init() {
  let errors = [];

  try {
    ({ errors } = await loadManifest());
  } catch (e) {
    errors = [e.message];
  }

  const restored = loadState();

  if (!restored) {
    settings.enabledSets = new Set(
      CARD_SETS
        .filter(
          s => s.id === "tarotMajor" || s.id === "tarotMinor"
        )
        .map(s => s.id)
    );

    shuffleDeck();
  }

  refreshForScale();
  renderSettingsPanel();
  renderLoadErrors(errors);
}

init();