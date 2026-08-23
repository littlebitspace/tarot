import { CELL_PX } from "./config.js";

/* =========================================================================
   PETSCII CHARACTER MAP
   ========================================================================= */
export const PETSCII_MAP = Object.fromEntries([
  [32,"\ue1a0"],[1,"A"],[2,"B"],[3,"C"],[4,"D"],[5,"E"],[6,"F"],[7,"G"],[8,"H"],
  [9,"I"],[10,"J"],[11,"K"],[12,"L"],[13,"M"],[14,"N"],[15,"O"],[16,"P"],[17,"Q"],
  [18,"R"],[19,"S"],[20,"T"],[21,"U"],[22,"V"],[23,"W"],[24,"X"],[25,"Y"],[26,"Z"],
  [46,"."],[44,","],[59,";"],[33,"!"],[63,"?"],[48,"0"],[49,"1"],[50,"2"],[51,"3"],
  [52,"4"],[53,"5"],[54,"6"],[55,"7"],[56,"8"],[57,"9"],[34,'"'],[35,"#"],[36,"$"],
  [37,"%"],[38,"&"],[39,"'"],[112,"┌"],[110,"┐"],[108,"▗"],[123,"▖"],[85,"╭"],
  [73,"╮"],[79,"\ue0cf"],[80,"\ue0d0"],[113,"┴"],[114,"┬"],[40,"("],[41,")"],
  [60,"<"],[62,">"],[78,"╱"],[77,"╲"],[109,"└"],[125,"┘"],[124,"▝"],[126,"▘"],
  [74,"╰"],[75,"╯"],[76,"\ue06c"],[122,"\ue0ba"],[107,"├"],[115,"┤"],[27,"["],
  [29,"]"],[31,"←"],[30,"↑"],[95,"◥"],[105,"◤"],[100,"▁"],[111,"▂"],[121,"▃"],
  [98,"▄"],[120,"\ue1b8"],[119,"\ue1f7"],[99,"▔"],[116,"▎"],[101,"▎"],[117,"▍"],
  [97,"▌"],[118,"\ue0f6"],[103,"\ue1ea"],[106,"\ue1ea"],[91,"┼"],[43,"+"],
  [82,"\ue072"],[70,"\ue0c6"],[64,"─"],[45,"-"],[67,"─"],[68,"\ue0c4"],
  [69,"\ue0c5"],[84,"\ue074"],[71,"\ue067"],[66,"|"],[93,"|"],[72,"\ue068"],
  [89,"\ue0d9"],[47,"/"],[86,"╳"],[42,"*"],[61,"="],[58,":"],[28,"£"],[0,"@"],
  [127,"▚"],[104,"\ue0a8"],[92,"\ue17c"],[102,"▒"],[81,"•"],[87,"○"],[65,"♠"],
  [83,"♥"],[88,"♣"],[90,"♦"],[94,"π"],[96,"\0"],[160,"\ue220"],[129,"\ue241"],
  [130,"\ue242"],[131,"\ue243"],[132,"\ue244"],[133,"\ue245"],[134,"\ue246"],
  [135,"\ue247"],[136,"\ue248"],[137,"\ue249"],[138,"\ue24a"],[139,"\ue24b"],
  [140,"\ue24c"],[141,"\ue24d"],[142,"\ue24e"],[143,"\ue24f"],[144,"\ue250"],
  [145,"\ue251"],[146,"\ue252"],[147,"\ue253"],[148,"\ue254"],[149,"\ue255"],
  [150,"\ue256"],[151,"\ue257"],[152,"\ue258"],[153,"\ue259"],[154,"\ue25a"],
  [174,"\ue22e"],[172,"\ue22c"],[187,"\ue23b"],[161,"\ue221"],[191,"\ue23f"],
  [176,"\ue230"],[177,"\ue231"],[178,"\ue232"],[179,"\ue233"],[180,"\ue234"],
  [181,"\ue235"],[182,"\ue236"],[183,"\ue237"],[184,"\ue238"],[185,"\ue239"],
  [162,"\ue222"],[163,"\ue223"],[164,"\ue224"],[165,"\ue225"],[166,"\ue226"],
  [167,"\ue227"],[240,"\ue2b0"],[238,"\ue2ae"],[236,"\ue2ac"],[251,"\ue2bb"],
  [213,"\ue275"],[201,"\ue269"],[207,"\ue26f"],[208,"\ue270"],[241,"\ue2b1"],
  [242,"\ue2b2"],[168,"\ue228"],[169,"\ue229"],[188,"\ue23c"],[190,"\ue23e"],
  [206,"\ue2ce"],[205,"\ue2cd"],[237,"\ue2ad"],[253,"\ue2bd"],[252,"\ue2bc"],
  [254,"\ue2be"],[202,"\ue26a"],[203,"\ue26b"],[204,"\ue2cc"],[250,"\ue2fa"],
  [235,"\ue2ab"],[243,"\ue2b3"],[155,"\ue25b"],[157,"\ue25d"],[159,"\ue25f"],
  [158,"\ue25e"],[223,"\ue27f"],[233,"\ue2a9"],[228,"\ue2e4"],[239,"\ue2ef"],
  [249,"\ue2f9"],[226,"\ue2e2"],[248,"▅"],[247,"▆"],[227,"\ue2e3"],[244,"\ue2e5"],
  [229,"\ue2e5"],[245,"\ue2b5"],[225,"\ue2e1"],[246,"▋"],[231,"▊"],[234,"▊"],
  [219,"\ue2db"],[171,"\ue22b"],[210,"\ue272"],[198,"\ue2c6"],[192,"\ue263"],
  [173,"\ue32d"],[195,"\ue263"],[196,"\ue2c4"],[197,"\ue2c5"],[212,"\ue274"],
  [199,"\ue2c7"],[194,"\ue2dd"],[221,"\ue2dd"],[200,"\ue2c8"],[217,"\ue2d9"],
  [175,"\ue22f"],[214,"\ue276"],[170,"\ue22a"],[189,"\ue23d"],[186,"\ue23b"],
  [156,"\ue25c"],[128,"\ue240"],[255,"\ue2bf"],[232,"\ue2a8"],[220,"\ue27c"],
  [230,"\ue2e6"],[209,"\ue271"],[215,"\ue277"],[193,"\ue261"],[211,"\ue273"],
  [216,"\ue278"],[218,"\ue27a"],[222,"\ue27e"],[224,"\ue220"],
]);

export const COLOR_NAMES = {
  0:"black",1:"white",2:"redDark",3:"cyan",4:"magenta",5:"greenDark",
  6:"blueDark",7:"yellow",8:"brown",9:"brownDark",10:"red",11:"grayDark",
  12:"gray",13:"green",14:"blue",15:"grayLight",
};

export const COLOR_HEX = {
  black:"#000000", white:"#ffffff", redDark:"#883932", cyan:"#67b6bd",
  magenta:"#8b3f96", greenDark:"#55a049", blueDark:"#40318d", yellow:"#bfce72",
  brown:"#8b5429", brownDark:"#574200", red:"#b86962", grayDark:"#505050",
  gray:"#787878", green:"#94e089", blue:"#7869c4", grayLight:"#9f9f9f",
};

/* =========================================================================
   GRID PLUMBING
   ========================================================================= */
export function decodeFramebuf(fb) {
  const { width, height, screencodes, colors, backgroundColor } = fb;
  const cells = new Array(width * height);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = {
      char: PETSCII_MAP[screencodes[i]] ?? "?",
      color: COLOR_NAMES[colors[i]] ?? "white",
    };
  }
  return { width, height, cells, bg: COLOR_NAMES[backgroundColor] ?? "black" };
}

export function makeTextGrid(lines, defaultColor) {
  const norm = lines.map(l => (typeof l === "string" ? { text: l, color: defaultColor } : l));
  const width = Math.max(1, ...norm.map(l => l.text.length));
  const height = norm.length;
  const cells = new Array(width * height);
  norm.forEach((l, y) => {
    const padded = l.text.padEnd(width, " ");
    for (let x = 0; x < width; x++) {
      cells[y * width + x] = { char: padded[x], color: l.color || defaultColor };
    }
  });
  return { width, height, cells, bg: "black" };
}

export function wrapText(text, width) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (trial.length > width && cur) { lines.push(cur); cur = w; }
    else cur = trial;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function rleRow(cells, width, y) {
  const runs = [];
  let cur = null;
  for (let x = 0; x < width; x++) {
    const c = cells[y * width + x];
    if (cur && cur.color === c.color) cur.text += c.char;
    else { cur = { color: c.color, text: c.char }; runs.push(cur); }
  }
  return runs;
}

// Every piece of on-screen text — card art, deck count, button labels,
// reading tips — goes through this, so font-size/line-height for ALL of
// it lives in one place and responds to scale changes uniformly.
export function buildCardEl(grid) {
  const pre = document.createElement("pre");
  pre.className = "card-pre";
  pre.style.fontSize = CELL_PX + "px";
  pre.style.lineHeight = CELL_PX + "px";
  for (let y = 0; y < grid.height; y++) {
    const row = document.createElement("div");
    row.className = "card-row";
    pre.appendChild(row);
  }
  updateCardEl(pre, grid);
  return pre;
}

export function updateCardEl(pre, grid) {
  pre.style.background = COLOR_HEX[grid.bg];
  const rows = pre.children;
  for (let y = 0; y < grid.height; y++) {
    const runs = rleRow(grid.cells, grid.width, y);
    const row = rows[y];
    while (row.children.length > runs.length) row.removeChild(row.lastChild);
    runs.forEach((r, i) => {
      let span = row.children[i];
      if (!span) { span = document.createElement("span"); row.appendChild(span); }
      if (span.textContent !== r.text) span.textContent = r.text;
      const hex = COLOR_HEX[r.color];
      if (span.style.color !== hex) span.style.color = hex;
    });
  }
}

// A sliver is a positioning box the size of a full card, holding only the
// LAST ROW and LAST COLUMN of that grid — the only part of a stacked-behind
// card that's ever visible once layers are offset by exactly one cell.
// Nothing is ever rendered fully underneath something else.
export function buildSliverEl(grid) {
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.width = (grid.width * CELL_PX) + "px";
  wrap.style.height = (grid.height * CELL_PX) + "px";

  const rowGrid = {
    width: grid.width, height: 1, bg: grid.bg,
    cells: grid.cells.slice((grid.height - 1) * grid.width, grid.height * grid.width),
  };
  const rowEl = buildCardEl(rowGrid);
  rowEl.style.position = "absolute";
  rowEl.style.left = "0px";
  rowEl.style.top = ((grid.height - 1) * CELL_PX) + "px";
  wrap.appendChild(rowEl);

  const colCells = [];
  for (let y = 0; y < grid.height; y++) colCells.push(grid.cells[y * grid.width + (grid.width - 1)]);
  const colGrid = { width: 1, height: grid.height, bg: grid.bg, cells: colCells };
  const colEl = buildCardEl(colGrid);
  colEl.style.position = "absolute";
  colEl.style.left = ((grid.width - 1) * CELL_PX) + "px";
  colEl.style.top = "0px";
  wrap.appendChild(colEl);

  return wrap;
}
