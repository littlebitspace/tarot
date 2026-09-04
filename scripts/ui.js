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

// Delay between rows when expanding/collapsing a settings section.
const SETTINGS_ROW_DELAY = 60;

// UI-only state. These are deliberately not persisted as deck settings.
const collapsedSections = new Set();
let settingsAnimation = false;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

/* ------------------------------------------------------------------------- */
/* Settings panel                                                            */
/* ------------------------------------------------------------------------- */

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
  settingsPanelEl.appendChild(
    buildCardEl(makeTextGrid([""], "white"))
  );
}

function checkboxText(state) {
  if (state === "on") return "x";
  if (state === "indeterminate") return "-";
  return " ";
}

/*
 * makeTextGrid() normally applies one colour to an entire line.
 * Checkbox rows need the x / - marker to have the accent colour,
 * so construct those rows cell-by-cell.
 */
function makeCheckboxGrid(state, label, indent = "") {
  const marker = checkboxText(state);
  const text = `${indent}[${marker}] ${label}`;
  const markerIndex = indent.length + 1;

  const cells = Array.from(text, (char, index) => ({
    char,
    color:
      (marker === "x" || marker === "-") && index === markerIndex
        ? ACCENT_COLOR
        : "white",
  }));

  return {
    width: text.length,
    height: 1,
    cells,
    bg: "black",
  };
}

function makeSectionHeaderGrid(label, collapsed) {
  return makeTextGrid([
    `${label} [${collapsed ? "v" : "^"}]`,
  ], "white");
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
  if (settingsAnimation) return;

  const sets = CARD_SETS.filter(set => set.group === group);
  const state = getGroupState(group);

  if (state === "on") {
    sets.forEach(set => settings.enabledSets.delete(set.id));
  } else {
    sets.forEach(set => settings.enabledSets.add(set.id));
  }

  renderSettingsPanel();
}

/*
 * A section consists of a header and an array of rows that can be inserted
 * or removed one at a time. This lets the whole settings panel move naturally
 * as rows are revealed/hidden.
 */
function createSection(id, label, buildContent) {
  const collapsed = collapsedSections.has(id);

  const header = addSettingsLine(
    makeSectionHeaderGrid(label, collapsed),
    () => toggleSection(id)
  );

  const contentRows = [];

  buildContent(row => {
    contentRows.push(row);
  });

  return {
    id,
    label,
    header,
    contentRows,
  };
}

function createSettingsRow(grid, onClick) {
  const el = buildCardEl(grid);

  if (onClick) {
    el.style.cursor = "pointer";
    el.addEventListener("click", onClick);
  }

  return el;
}

async function toggleSection(id) {
  if (settingsAnimation) return;

  const section = settingsSections.get(id);
  if (!section) return;

  settingsAnimation = true;

  if (collapsedSections.has(id)) {
    // Expand
    collapsedSections.delete(id);

    const oldHeader = section.header;
    const newHeader = createSectionHeaderElement(section, false);

    oldHeader.replaceWith(newHeader);

    // The section's rows must be inserted immediately after its header.
    let insertBefore = newHeader.nextSibling;

    for (const row of section.contentRows) {
      settingsPanelEl.insertBefore(row, insertBefore);
      await delay(SETTINGS_ROW_DELAY);
    }
  } else {
    // Collapse
    collapsedSections.add(id);

    for (let i = section.contentRows.length - 1; i >= 0; i--) {
      const row = section.contentRows[i];

      if (row.parentNode === settingsPanelEl) {
        settingsPanelEl.removeChild(row);
      }

      await delay(SETTINGS_ROW_DELAY);
    }

    const oldHeader = section.header;
    const newHeader = createSectionHeaderElement(section, true);

    oldHeader.replaceWith(newHeader);
  }

  settingsAnimation = false;
  saveState();
}

function createSectionHeaderElement(section, collapsed) {
  const el = buildCardEl(
    makeSectionHeaderGrid(section.label, collapsed)
  );

  el.style.cursor = "pointer";
  el.addEventListener("click", () => toggleSection(section.id));

  section.header = el;

  return el;
}

/*
 * Stores the currently rendered sections so that an expansion/collapse
 * animation can operate on their existing DOM rows.
 */
const settingsSections = new Map();

function buildCardsSection() {
  const rows = [];

  let lastGroup = null;

  for (const set of CARD_SETS) {
    if (set.group !== lastGroup) {
      lastGroup = set.group;

      const groupState = getGroupState(set.group);

      rows.push(
        createSettingsRow(
          makeCheckboxGrid(groupState, set.group),
          () => toggleGroup(set.group)
        )
      );

      rows.push(
        createSettingsRow(
          makeTextGrid([""], "white")
        )
      );
    }

    const checked = settings.enabledSets.has(set.id);

    rows.push(
      createSettingsRow(
        makeCheckboxGrid(
          checked ? "on" : "off",
          set.label,
          "  "
        ),
        () => {
          if (settingsAnimation) return;

          if (checked) {
            settings.enabledSets.delete(set.id);
          } else {
            settings.enabledSets.add(set.id);
          }

          renderSettingsPanel();
        }
      )
    );

    rows.push(
      createSettingsRow(
        makeTextGrid([""], "white")
      )
    );
  }

  return rows;
}

function buildCardOptionsSection() {
  const rows = [];

  rows.push(
    createSettingsRow(
      makeCheckboxGrid(
        settings.sameBack ? "on" : "off",
        "Same back for all cards"
      ),
      () => {
        if (settingsAnimation) return;

        settings.sameBack = !settings.sameBack;
        renderSettingsPanel();
      }
    )
  );

  rows.push(
    createSettingsRow(
      makeTextGrid([""], "white")
    )
  );

  rows.push(
    createSettingsRow(
      makeCheckboxGrid(
        settings.allUpright ? "on" : "off",
        "All cards upright"
      ),
      () => {
        if (settingsAnimation) return;

        settings.allUpright = !settings.allUpright;
        renderSettingsPanel();
      }
    )
  );

  rows.push(
    createSettingsRow(
      makeTextGrid([""], "white")
    )
  );

  return rows;
}

function buildInteractionSection() {
  const rows = [];

  rows.push(
    createSettingsRow(
      makeCheckboxGrid(
        settings.attachOnDrop ? "on" : "off",
        "Attach cards on drop"
      ),
      () => {
        if (settingsAnimation) return;

        settings.attachOnDrop = !settings.attachOnDrop;
        renderSettingsPanel();
      }
    )
  );

  rows.push(
    createSettingsRow(
      makeTextGrid([""], "white")
    )
  );

  const cardsPerDrawRow = document.createElement("div");
  cardsPerDrawRow.style.display = "flex";
  cardsPerDrawRow.style.alignItems = "center";
  cardsPerDrawRow.style.gap = CELL_PX + "px";

  const minusEl = buildMiniBtn("-", () => {
    if (settingsAnimation) return;

    settings.cardsPerDraw = clamp(
      settings.cardsPerDraw - 1,
      1,
      10
    );

    renderSettingsPanel();
  });

  const labelEl = buildCardEl(
    makeTextGrid(
      [`Cards per draw: ${settings.cardsPerDraw}`],
      "white"
    )
  );

  const plusEl = buildMiniBtn("+", () => {
    if (settingsAnimation) return;

    settings.cardsPerDraw = clamp(
      settings.cardsPerDraw + 1,
      1,
      10
    );

    renderSettingsPanel();
  });

  cardsPerDrawRow.appendChild(minusEl);
  cardsPerDrawRow.appendChild(labelEl);
  cardsPerDrawRow.appendChild(plusEl);

  rows.push(cardsPerDrawRow);

  rows.push(
    createSettingsRow(
      makeTextGrid([""], "white")
    )
  );

  return rows;
}

function buildDisplaySection() {
  const rows = [];

  rows.push(
    createSettingsRow(
      makeCheckboxGrid(
        settings.showInterpretations ? "on" : "off",
        "Show Interpretations"
      ),
      () => {
        if (settingsAnimation) return;

        settings.showInterpretations = !settings.showInterpretations;

        placedCards.forEach(state => {
          if (state.tipEl.children.length) {
            state.tipEl.style.display =
              settings.showInterpretations
                ? "block"
                : "none";
          }
        });

        renderSettingsPanel();
      }
    )
  );

  rows.push(
    createSettingsRow(
      makeTextGrid([""], "white")
    )
  );

  return rows;
}

function renderSettingsPanel() {
  settingsPanelEl.innerHTML = "";
  settingsSections.clear();

  const sections = [
    {
      id: "cards",
      label: "Cards",
      build: buildCardsSection,
    },
    {
      id: "cardOptions",
      label: "Card options",
      build: buildCardOptionsSection,
    },
    {
      id: "interaction",
      label: "Interaction",
      build: buildInteractionSection,
    },
    {
      id: "display",
      label: "Display",
      build: buildDisplaySection,
    },
  ];

  for (const definition of sections) {
    const collapsed = collapsedSections.has(definition.id);

    const header = createSectionHeaderElement(
      {
        id: definition.id,
        label: definition.label,
      },
      collapsed
    );

    settingsPanelEl.appendChild(header);

    const section = {
      id: definition.id,
      label: definition.label,
      header,
      contentRows: [
        createSettingsRow(makeTextGrid([""], "white")),
        ...definition.build(),
      ],
    };

    settingsSections.set(definition.id, section);

    if (!collapsed) {
      section.contentRows.forEach(row => {
        settingsPanelEl.appendChild(row);
      });
    }
    settingsPanelEl.appendChild(
      createSettingsRow(makeTextGrid([""], "white"))
    );
  }

  if (
    lastAppliedSettings &&
    !deckSettingsMatch(
      snapshotDeckSettings(),
      lastAppliedSettings
    )
  ) {
    addSettingsLine(
      makeTextGrid(
        ["Shuffle to apply deck changes"],
        "yellow"
      )
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

/* ------------------------------------------------------------------------- */
/* Scale control                                                             */
/* ------------------------------------------------------------------------- */

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
  table.style.backgroundSize =
    CELL_PX + "px " + CELL_PX + "px";

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

/* ------------------------------------------------------------------------- */
/* Initialisation                                                            */
/* ------------------------------------------------------------------------- */

table.style.backgroundSize =
  CELL_PX + "px " + CELL_PX + "px";

renderShuffleBtn();
renderScaleControl();
layoutChrome();

function renderLoadErrors(errors) {
  if (!errors.length) return;

  console.error(
    "Card loading errors:\n" + errors.join("\n")
  );

  const shown = errors.slice(0, 8);
  const lines = [
    `${errors.length} card(s) failed to load:`,
  ];

  shown.forEach(e => lines.push(...wrapText(e, 30)));

  if (errors.length > shown.length) {
    lines.push(
      `...and ${errors.length - shown.length} more (see console)`
    );
  }

  const box = buildCardEl(
    makeTextGrid(lines, "red")
  );

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
          s =>
            s.id === "tarotMajor" ||
            s.id === "tarotMinor"
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