import {
  SCALE,
  CELL_PX,
  COLORS,
  setScale,
  settings,
  lastAppliedSettings,
  snapshotDeckSettings,
  deckSettingsMatch,
  setDeckWasExplicitlyShuffled,
  collapsedSections,
} from "./config.js";
import {
  makeTextGrid,
  wrapText,
  buildCardEl,
  COLOR_HEX,
} from "./renderer.js";
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

function applyHoverColor(el) {
  const hoverColor = COLOR_HEX[COLORS.HOVER_COLOR];
  const accentColor = COLOR_HEX[COLORS.ACCENT_COLOR];

  if (!hoverColor) {
    throw new Error(`Invalid PETSCII hover colour: ${COLORS.HOVER_COLOR}`);
  }

  if (!accentColor) {
    throw new Error(`Invalid PETSCII accent colour: ${COLORS.ACCENT_COLOR}`);
  }

  el.classList.add("hoverable");
  el.style.setProperty("--hover-color", hoverColor);
  el.style.setProperty("--accent-color", accentColor);
  el.style.cursor = "pointer";
}

// Delay between rows when expanding/collapsing a settings section.
const SETTINGS_ROW_DELAY = 60;

// UI-only state. These are deliberately not persisted as deck settings.
let settingsAnimation = false;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setButtonDisabled(el, disabled) {
  if (disabled) {
    el.classList.add("disabled");
    el.style.setProperty("--disabled-color", COLOR_HEX[COLORS.DISABLED_COLOR]);
    el.style.cursor = "default";
    el.setAttribute("aria-disabled", "true");
    el.style.pointerEvents = "none";
  } else {
    el.classList.remove("disabled");
    el.style.removeProperty("--disabled-color");
    el.style.cursor = "pointer";
    el.removeAttribute("aria-disabled");
    el.style.pointerEvents = "";
  }
}

function buildActionBtn(label, color = COLORS.DEFAULT_COLOR, width = label.length) {
  const inner = ` ${label.padStart(Math.ceil((width + label.length) / 2)).padEnd(width)} `;
  const border = "─".repeat(inner.length);

  const grid = makeTextGrid([
    "╭" + border + "╮",
    "│" + inner + "│",
    "╰" + border + "╯",
  ], color);

  const el = buildCardEl(grid);
  el.classList.add("btn");
  applyHoverColor(el);

  return el;
}

function renderShuffleBtn() {
  shuffleBtnEl.innerHTML = "";
  shuffleBtnEl.style.display = "flex";
  shuffleBtnEl.style.gap = CELL_PX + "px";

  const shuffleBtn = buildActionBtn("SHUFFLE");

  shuffleBtn.addEventListener("click", handleShuffle);

  shuffleBtnEl.appendChild(shuffleBtn);

  const shuffleAllBtn = buildActionBtn(
    shuffleAllConfirm ? "CONFIRM?" : "SHUFFLE ALL",
    shuffleAllConfirm ? COLORS.WARNING_COLOR : COLORS.DEFAULT_COLOR,
    "SHUFFLE ALL".length
  );

  if (shuffleAllConfirm) {
    shuffleAllBtn.classList.add("shuffle-all-confirm");
    shuffleAllBtn.style.setProperty(
      "--warning-color",
      COLOR_HEX[COLORS.WARNING_COLOR]
    );
  }

  shuffleAllBtn.addEventListener("click", handleShuffleAll);

  shuffleBtnEl.appendChild(shuffleAllBtn);
}

let shuffleBusy = false;
let shuffleAllConfirm = false;
let shuffleConfirmTimer = null;

const SHUFFLE_CONFIRM_MS = 5000;

function armShuffleAllConfirmation() {
  shuffleAllConfirm = true;
  renderShuffleBtn();

  clearTimeout(shuffleConfirmTimer);

  shuffleConfirmTimer = setTimeout(() => {
    shuffleAllConfirm = false;
    shuffleConfirmTimer = null;
    renderShuffleBtn();
  }, SHUFFLE_CONFIRM_MS);
}

async function handleShuffleAll() {
  if (shuffleBusy) return;

  if (!shuffleAllConfirm) {
    armShuffleAllConfirmation();
    return;
  }

  // Confirmation accepted
  clearTimeout(shuffleConfirmTimer);
  shuffleConfirmTimer = null;
  shuffleAllConfirm = false;

  // Immediately restore the normal button
  renderShuffleBtn();

  shuffleBusy = true;

  // Disable both shuffle buttons while the animation is playing
  const buttons = shuffleBtnEl.querySelectorAll(".btn");
  buttons.forEach(btn => setButtonDisabled(btn, true));

  try {
    shuffleDeck(true);
    renderDeck();
    renderSettingsPanel();

    await playShuffleAnimation();

    setDeckWasExplicitlyShuffled(true);
    renderDeck();
    saveState();
  } finally {
    buttons.forEach(btn => setButtonDisabled(btn, false));
    shuffleBusy = false;
  }
}

async function handleShuffle() {
  if (shuffleBusy) return;

  shuffleBusy = true;

  // Disable both shuffle buttons while the animation is playing
  const buttons = shuffleBtnEl.querySelectorAll(".btn");
  buttons.forEach(btn => setButtonDisabled(btn, true));

  try {
    shuffleDeck(false);
    renderDeck();
    renderSettingsPanel();

    await playShuffleAnimation();

    setDeckWasExplicitlyShuffled(true);
    renderDeck();
    saveState();
  } finally {
    buttons.forEach(btn => setButtonDisabled(btn, false));
    shuffleBusy = false;
  }
}

/* ------------------------------------------------------------------------- */
/* Settings panel                                                            */
/* ------------------------------------------------------------------------- */

function addSettingsLine(grid, onClick) {
  const el = buildCardEl(grid);

  if (onClick) {
    el.style.cursor = "pointer";
    applyHoverColor(el);
    el.addEventListener("click", onClick);
  }

  settingsPanelEl.appendChild(el);
  return el;
}

function addBlankLine() {
  settingsPanelEl.appendChild(
    buildCardEl(makeTextGrid([""], COLORS.DEFAULT_COLOR))
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
    color: index === markerIndex
      ? COLORS.ACCENT_COLOR
      : COLORS.DEFAULT_COLOR,
    preserveHover: index === markerIndex,
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
  ], COLORS.DEFAULT_COLOR);
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
    applyHoverColor(el);
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

  applyHoverColor(el);
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
          makeTextGrid([""], COLORS.DEFAULT_COLOR)
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
        makeTextGrid([""], COLORS.DEFAULT_COLOR)
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
      makeTextGrid([""], COLORS.DEFAULT_COLOR)
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
      makeTextGrid([""], COLORS.DEFAULT_COLOR)
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
      id: "preferences",
      label: "Preferences",
      build: buildPreferencesSection,
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
        createSettingsRow(makeTextGrid([""], COLORS.DEFAULT_COLOR)),
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
      createSettingsRow(makeTextGrid([""], COLORS.DEFAULT_COLOR))
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
        COLORS.WARNING_COLOR
      )
    );
  }

  saveState();
}

function buildPreferencesSection() {
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
      makeTextGrid([""], COLORS.DEFAULT_COLOR)
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
      makeTextGrid([""], COLORS.DEFAULT_COLOR)
    )
  );

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
      makeTextGrid([""], COLORS.DEFAULT_COLOR)
    )
  );

  const cardsPerDrawRow = document.createElement("div");
  cardsPerDrawRow.style.display = "flex";
  cardsPerDrawRow.style.alignItems = "center";
  cardsPerDrawRow.style.gap = CELL_PX + "px";

  const minusBtn = buildMiniBtn("-", () => {
    if (settings.cardsPerDraw > 1) {
      settings.cardsPerDraw--;
      saveState();
      renderSettingsPanel();
    }
  });

  const labelEl = buildCardEl(
    makeTextGrid(
      [`Cards per draw: ${settings.cardsPerDraw}`],
      COLORS.DEFAULT_COLOR
    )
  );

  const plusBtn = buildMiniBtn("+", () => {
    if (settings.cardsPerDraw < 10) {
      settings.cardsPerDraw++;
      saveState();
      renderSettingsPanel();
    }
  });

  setButtonDisabled(minusBtn, settings.cardsPerDraw <= 1);
  setButtonDisabled(plusBtn, settings.cardsPerDraw >= 10);

  cardsPerDrawRow.appendChild(minusBtn);
  cardsPerDrawRow.appendChild(labelEl);
  cardsPerDrawRow.appendChild(plusBtn);

  rows.push(cardsPerDrawRow);

  rows.push(
    createSettingsRow(
      makeTextGrid([""], COLORS.DEFAULT_COLOR)
    )
  );

  const placeCardsRow = document.createElement("div");
  placeCardsRow.style.display = "flex";
  placeCardsRow.style.alignItems = "center";
  placeCardsRow.style.gap = CELL_PX + "px";

  const placeCardsLabel = buildCardEl(
    makeTextGrid(["Place cards to:"], COLORS.DEFAULT_COLOR)
  );

  const topEl = buildCardEl(
    makeTextGrid(
      ["top"],
      settings.placeCardsTo === "top"
        ? COLORS.ACCENT_COLOR
        : COLORS.SECONDARY_COLOR
    )
  );
  applyHoverColor(topEl);

  const bottomEl = buildCardEl(
    makeTextGrid(
      ["bottom"],
      settings.placeCardsTo === "bottom"
        ? COLORS.ACCENT_COLOR
        : COLORS.SECONDARY_COLOR
    )
  );
  applyHoverColor(bottomEl);

  topEl.addEventListener("click", () => {
    if (settingsAnimation) return;

    settings.placeCardsTo = "top";
    setDeckWasExplicitlyShuffled(false);
    saveState();
    renderSettingsPanel();
  });

  bottomEl.addEventListener("click", () => {
    if (settingsAnimation) return;

    settings.placeCardsTo = "bottom";
    setDeckWasExplicitlyShuffled(false);
    saveState();
    renderSettingsPanel();
  });

  placeCardsRow.appendChild(placeCardsLabel);
  placeCardsRow.appendChild(topEl);
  placeCardsRow.appendChild(bottomEl);

  rows.push(placeCardsRow);

  rows.push(
    createSettingsRow(
      makeTextGrid([""], COLORS.DEFAULT_COLOR)
    )
  );

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
      makeTextGrid([""], COLORS.DEFAULT_COLOR)
    )
  );

  return rows;
}

function buildMiniBtn(label, onClick) {
  const inner = ` ${label} `;
  const border = "─".repeat(inner.length);

  const grid = makeTextGrid([
    "╭" + border + "╮",
    "│" + inner + "│",
    "╰" + border + "╯",
  ], COLORS.DEFAULT_COLOR);

  const el = buildCardEl(grid);
  el.classList.add("btn");
  applyHoverColor(el);
  el.addEventListener("click", onClick);

  return el;
}

/* ------------------------------------------------------------------------- */
/* Scale control                                                             */
/* ------------------------------------------------------------------------- */

function renderScaleControl() {
  scaleControlEl.innerHTML = "";

  const minusBtn = buildMiniBtn("-", () => {
    if (SCALE > 1) {
      setScale(SCALE - 1);
      refreshForScale();
    }
  });

  const label = buildCardEl(
    makeTextGrid([`Scale ${SCALE}x`], COLORS.DEFAULT_COLOR)
  );

  const plusBtn = buildMiniBtn("+", () => {
    if (SCALE < 4) {
      setScale(SCALE + 1);
      refreshForScale();
    }
  });

  setButtonDisabled(minusBtn, SCALE <= 1);
  setButtonDisabled(plusBtn, SCALE >= 4);

  scaleControlEl.appendChild(minusBtn);
  scaleControlEl.appendChild(label);
  scaleControlEl.appendChild(plusBtn);
}

function layoutChrome() {
  deckAreaEl.style.top = CELL_PX + "px";
  deckAreaEl.style.left = CELL_PX + "px";

  scaleControlEl.style.gap = CELL_PX + "px";

  const deckStack = document.getElementById("deckStack");
  deckStack.style.marginTop = CELL_PX + "px";

  deckCountEl.style.marginTop = CELL_PX + "px";
  deckCountEl.style.gap = CELL_PX + "px";
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
    makeTextGrid(lines, COLORS.WARNING_COLOR)
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