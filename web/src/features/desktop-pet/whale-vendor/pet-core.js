/**
 * The pet's body: geometry, faces, accessories, skin, synthesized sound, and the motion
 * simulation with pointer handling. Pages build on it: the desktop window (pet.html), the
 * dressing page (dress.html) and anything else that wants the same figure.
 *
 * Coordinates: the figure is drawn in logo units, facing right, ground at y=256. A stage places
 * it with translate(AX AY) rotate(rot) scale(kx ky) translate(-ax -ay); `toStage` maps a logo
 * point back to stage pixels for hit tests, particles and bubble placement.
 */

import { contactShadow } from "./shadow.js";

export const f = (n) => Math.round(n * 10) / 10;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const smooth = (k) => k * k * (3 - 2 * k);

/* ---------- figure geometry ---------- */
const HIPS = [
  [104, 212],
  [150, 212],
];
const EYES = [
  [113, 117],
  [163, 117],
];
const BODY_W = 36,
  LEG_W = 30;
// a foot's round cap touches the ground
const FOOT_Y = 256 - LEG_W / 2;
export const STAND = HIPS.map((h) => [h[0], h[1], h[0], FOOT_Y]);
const DROP = "M0 -9C4 -3 6 0 6 3.5A6 6 0 0 1 -6 3.5C-6 0 -4 -3 0 -9Z";
const pol = (a, r) => [
  128 + r * Math.cos((a * Math.PI) / 180),
  128 - r * Math.sin((a * Math.PI) / 180),
];
const pt = (p) => `${f(p[0])} ${f(p[1])}`;

function cPath(gt, gb) {
  return `M${pt(pol(gt, 84))}A84 84 0 1 0 ${pt(pol(-gb, 84))}`;
}
function ellipse(cx, cy, rx, ry) {
  if (ry < 1.6) return `M${f(cx - rx)} ${f(cy)}L${f(cx + rx)} ${f(cy)}`;
  return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
}
export function heartD(cx, cy, s) {
  const p = (x, y) => `${f(cx + x * s)} ${f(cy + y * s)}`;
  return `M${p(0, 14)}C${p(-7, 8)} ${p(-19, 1)} ${p(-19, -6)}C${p(-19, -15)} ${p(-8, -18)} ${p(0, -9)}C${p(8, -18)} ${p(19, -15)} ${p(19, -6)}C${p(19, 1)} ${p(7, 8)} ${p(0, 14)}Z`;
}
function eyePath(e, cx, cy) {
  cx += e.dx || 0;
  cy += e.dy || 0;
  switch (e.shape) {
    case "ring":
      return ellipse(cx, cy, e.rx, e.ry);
    case "lid":
      return e.ry < 1.6
        ? `M${f(cx - 16)} ${f(cy)}L${f(cx + 16)} ${f(cy)}`
        : `M${f(cx - 16)} ${f(cy)}A16 ${f(e.ry)} 0 0 0 ${f(cx + 16)} ${f(cy)}Z`;
    case "up":
      return `M${f(cx - 15)} ${f(cy + 6)}Q${f(cx)} ${f(cy - 17)} ${f(cx + 15)} ${f(cy + 6)}`;
    case "down":
      return `M${f(cx - 15)} ${f(cy - 3)}Q${f(cx)} ${f(cy + 15)} ${f(cx + 15)} ${f(cy - 3)}`;
    case "gt":
      return `M${f(cx - 10)} ${f(cy - 13)}L${f(cx + 11)} ${f(cy)}L${f(cx - 10)} ${f(cy + 13)}`;
    case "lt":
      return `M${f(cx + 10)} ${f(cy - 13)}L${f(cx - 11)} ${f(cy)}L${f(cx + 10)} ${f(cy + 13)}`;
    case "heart":
      return heartD(cx, cy, e.s);
    case "spiral": {
      let d = "";
      const max = Math.PI * 4.4;
      for (let i = 0; i <= 44; i++) {
        const a = (max * i) / 44,
          r = 2 + (15 * i) / 44;
        d +=
          (i ? "L" : "M") +
          f(cx + r * Math.cos(a + e.rot)) +
          " " +
          f(cy + r * Math.sin(a + e.rot));
      }
      return d;
    }
  }
  return "";
}

/* ---------- accessories ----------
   Solid shapes first; lines only where a piece is a line (band, stalk, frame), never thinner than 10.
   Every part is painted through a color channel: c-<slot>-main / c-<slot>-acc. */
export const PALETTES = [
  {
    id: "mint",
    label: "薄荷绿",
    l: ["#1B1626", "#00A870"],
    d: ["#FFFFFF", "#2FD59B"],
  },
  {
    id: "mono",
    label: "单色",
    l: ["#1B1626", "#1B1626"],
    d: ["#FFFFFF", "#FFFFFF"],
  },
  {
    id: "navigator",
    label: "领航员",
    l: ["#14213A", "#1F6FE0"],
    d: ["#FFFFFF", "#5EA3FF"],
  },
  {
    id: "claude",
    label: "克劳德",
    l: ["#2A1C16", "#C9623F"],
    d: ["#FFFFFF", "#E58B69"],
  },
  {
    id: "fox",
    label: "红狐狸",
    l: ["#26140F", "#DD3526"],
    d: ["#FFFFFF", "#FF6655"],
  },
  {
    id: "purple",
    label: "虚式茈",
    l: ["#1D1430", "#8B3DF0"],
    d: ["#FFFFFF", "#B98AFF"],
  },
  {
    id: "lemon",
    label: "柠檬黄",
    l: ["#252010", "#D9B300"],
    d: ["#FFFFFF", "#FFE14F"],
  },
];
export const HEADS = [
  ["none", "无"],
  ["cat", "猫耳"],
  ["bear", "熊耳"],
  ["bunny", "兔耳"],
  ["antenna", "天线"],
  ["halo", "光环"],
  ["tophat", "礼帽"],
  ["party", "派对帽"],
  ["sailor", "水手帽"],
];
export const SIDES = [
  ["none", "无"],
  ["headphones", "耳机"],
  ["feather", "耳羽"],
  ["earring", "耳环"],
  ["clip", "发夹"],
  ["bow", "蝴蝶结"],
];
export const GLASSES = [
  ["none", "无"],
  ["round", "圆框"],
  ["square", "方框"],
  ["monocle", "单片镜"],
];
export const NECKS = [
  ["none", "无"],
  ["bowtie", "领结"],
  ["bell", "铃铛"],
  ["scarf", "围巾"],
];
export const HEAD_TOP = {
  none: 12,
  cat: -14,
  bear: -4,
  bunny: -34,
  antenna: -34,
  halo: -8,
  tophat: -28,
  party: -34,
  sailor: -20,
};

/* color mapping: channel -> source. 'body' / 'eye' follow the palette; the rest are fixed accessory colors with a dark twin */
export const ACC_COLORS = [
  { id: "mint", label: "薄荷绿", l: "#00A870", d: "#2FD59B" },
  { id: "leaf", label: "叶绿", l: "#3C9A2C", d: "#80D46B" },
  { id: "lemon", label: "柠檬黄", l: "#D9B300", d: "#FFE14F" },
  { id: "fox", label: "红狐狸", l: "#DD3526", d: "#FF6655" },
  { id: "claude", label: "克劳德", l: "#C9623F", d: "#E58B69" },
  { id: "rose", label: "樱粉", l: "#DB3F76", d: "#FF85AE" },
  { id: "purple", label: "虚式茈", l: "#8B3DF0", d: "#B98AFF" },
  { id: "navigator", label: "领航员", l: "#1F6FE0", d: "#5EA3FF" },
  { id: "holo", label: "全息蓝", l: "#1AA3D9", d: "#6FD3FF" },
];
export const LINKED = [
  { id: "body", label: "跟随身体" },
  { id: "eye", label: "跟随眼睛" },
];
export const SLOTS = ["head", "side", "glasses", "neck"];
export const SLOT_LISTS = {
  head: HEADS,
  side: SIDES,
  glasses: GLASSES,
  neck: NECKS,
};
export const CHANNEL_DEFAULT = {
  head: { main: "body", acc: "eye" },
  side: { main: "eye", acc: "eye" },
  glasses: { main: "body", acc: "eye" },
  neck: { main: "eye", acc: "eye" },
};
// side and neck pieces lie on top of the body outline: mapping them to the body color would make them vanish
export const NO_BODY = { head: false, side: true, glasses: false, neck: true };
// character pieces carry their original colors; picking one fills its channels, which stay editable afterwards
export const ITEM_COLORS = {
  sailor: { main: "body", acc: "navigator" },
  feather: { main: "holo", acc: "navigator" },
  headphones: { main: "claude", acc: "holo" },
};
export const ROLES = {
  cat: ["main"],
  bear: ["main"],
  bunny: ["main"],
  antenna: ["main", "acc"],
  halo: ["acc"],
  tophat: ["main", "acc"],
  party: ["main", "acc"],
  round: ["main"],
  square: ["main"],
  monocle: ["main"],
  bowtie: ["main"],
  bell: ["main", "acc"],
  scarf: ["main"],
  sailor: ["main", "acc"],
  headphones: ["main", "acc"],
  feather: ["main", "acc"],
  earring: ["main"],
  clip: ["main"],
  bow: ["main"],
};

const mount = (a, r = 96) => `translate(${pt(pol(a, r))}) rotate(${f(90 - a)})`;
const stroke = (cls, w) =>
  `class="${cls}" fill="none" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
// solid shape with rounded corners: filled and stroked in the same channel color
const blob = (slot, ch, w) =>
  `class="f-${slot}-${ch} c-${slot}-${ch}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

function headBack(id, sw) {
  switch (id) {
    case "cat":
      return [126, 82]
        .map(
          (a) =>
            `<path ${blob("head", "main", 10)} transform="${mount(a)}" d="M-17 8L0 -28L17 8Z"/>`,
        )
        .join("");
    case "bear":
      return [128, 80]
        .map(
          (a) =>
            `<circle class="f-head-main" transform="${mount(a)}" cx="0" cy="-8" r="18"/>`,
        )
        .join("");
    case "bunny":
      return [
        [116, -10, 0.7],
        [92, 6, 1],
      ]
        .map(
          ([a, off, k]) =>
            `<g transform="${mount(a)} rotate(${f(off + sw * k)})"><ellipse class="f-head-main" cx="0" cy="-28" rx="14" ry="30"/></g>`,
        )
        .join("");
    case "antenna":
      return `<g transform="${mount(98)} rotate(${f(sw)})"><path ${stroke("c-head-main", 14)} d="M0 0Q5 -20 0 -38"/><circle class="f-head-acc" cx="0" cy="-50" r="12"/></g>`;
  }
  return "";
}
function headFront(id, sw, t) {
  switch (id) {
    case "sailor":
      return `<g transform="${mount(106)} rotate(${f(sw * 0.2)})"><path class="f-head-main" d="M-34 3L-38 -30Q0 -40 38 -30L34 3Q0 -3 -34 3Z"/><path class="f-head-acc" d="M-37.1 -23Q0 -31 37.1 -23L36.1 -15Q0 -23 -36.1 -15ZM-35.6 -11Q0 -19 35.6 -11L34.8 -4Q0 -12 -34.8 -4Z"/></g>`;
    case "halo":
      return `<g transform="${mount(98)}"><ellipse ${stroke("c-head-acc", 12)} cx="0" cy="${f(-28 + 3 * Math.sin(t * 2.2))}" rx="36" ry="9"/></g>`;
    case "tophat":
      return `<g transform="${mount(104)} rotate(${f(sw * 0.2)})"><rect class="f-head-main" x="-40" y="-7" width="80" height="12" rx="6"/><rect class="f-head-main" x="-22" y="-48" width="44" height="46" rx="7"/><rect class="f-head-acc" x="-22" y="-20" width="44" height="10"/></g>`;
    case "party":
      return `<g transform="${mount(110)} rotate(${f(sw * 0.3)})"><path ${blob("head", "main", 8)} d="M-24 2L0 -46L24 2Z"/><circle class="f-head-acc" cx="0" cy="-55" r="11"/></g>`;
  }
  return "";
}
// Side pieces sit where an ear would be on this profile: the back of the head, around 130–172°.
function sideBack(id, sw) {
  if (id !== "feather") return "";
  const blade = (L, w) =>
    `M0 0C${-w} ${f(-L * 0.3)} ${f(-w * 0.8)} ${f(-L * 0.8)} ${f(-L * 0.14)} ${-L}C${f(w * 0.6)} ${f(-L * 0.75)} ${w} ${f(-L * 0.3)} 0 0Z`;
  return (
    `<g transform="${mount(166, 92)} rotate(${f(sw * 0.6)})">` +
    `<path class="f-side-acc" transform="rotate(58)" d="${blade(66, 18)}"/>` +
    `<path class="f-side-main" transform="rotate(26)" d="${blade(56, 16)}"/>` +
    `<path class="f-side-main" d="${blade(42, 14)}"/></g>`
  );
}
function sideFront(id, sw) {
  switch (id) {
    case "headphones":
      return (
        `<path ${stroke("c-side-main", 16)} d="M${pt(pol(150, 113))}A113 113 0 0 1 ${pt(pol(76, 113))}"/>` +
        `<rect class="f-side-acc" transform="${mount(166, 98)}" x="-24" y="-17" width="48" height="34" rx="17"/>`
      );
    case "earring":
      return `<g transform="translate(${pt(pol(172, 99))}) rotate(${f(sw * 0.8)})"><circle class="f-side-main" cx="0" cy="13" r="10"/></g>`;
    case "clip":
      return `<rect class="f-side-main" transform="${mount(140, 86)}" x="-17" y="-6.5" width="34" height="13" rx="6.5"/>`;
    case "bow":
      return `<g class="f-side-main" transform="${mount(132, 100)} rotate(${f(sw * 0.3)})"><path d="M-4 0L-24 -14Q-28 0 -24 14ZM4 0L24 -14Q28 0 24 14Z"/><circle r="7"/></g>`;
  }
  return "";
}
function glassesD(id, gx, gy) {
  // frames sit one ring-width outside the eyes so the two never touch
  const L = [113 + gx, 117 + gy],
    R = [163 + gx, 117 + gy],
    M = stroke("c-glasses-main", 10);
  switch (id) {
    case "round":
      return `<circle ${M} cx="${f(L[0])}" cy="${f(L[1])}" r="31"/><circle ${M} cx="${f(R[0])}" cy="${f(R[1])}" r="31"/><path ${M} d="M${f(L[0] - 31)} ${f(L[1] - 6)}L62 106"/>`;
    case "square":
      return `<rect ${M} x="${f(L[0] - 26)}" y="${f(L[1] - 22)}" width="52" height="44" rx="15"/><rect ${M} x="${f(R[0] - 26)}" y="${f(R[1] - 22)}" width="52" height="44" rx="15"/><path ${M} d="M${f(L[0] - 26)} ${f(L[1] - 6)}L62 106"/>`;
    case "monocle":
      return `<circle ${M} cx="${f(R[0])}" cy="${f(R[1])}" r="31"/>`;
  }
  return "";
}
function neckD(id, sw) {
  switch (id) {
    case "bowtie":
      return `<g ${blob("neck", "main", 6)} transform="translate(176 206) rotate(-32)"><path d="M-4 0L-22 -13V13ZM4 0L22 -13V13Z"/><circle r="7"/></g>`;
    case "bell": {
      const a = pol(-150, 84),
        b = pol(-60, 84);
      return `<path ${stroke("c-neck-main", 12)} d="M${pt(a)}A84 84 0 0 0 ${pt(b)}"/><g transform="translate(${pt(b)}) rotate(${f(sw * 0.6)})"><circle class="f-neck-acc" cx="0" cy="14" r="13"/></g>`;
    }
    case "scarf": {
      const a = pol(-150, 84),
        b = pol(-72, 84),
        S2 = stroke("c-neck-main", 18);
      return `<path ${S2} d="M${pt(a)}A84 84 0 0 0 ${pt(b)}"/><g transform="rotate(${f(sw * 0.8)} ${pt(a)})"><path ${S2} d="M${pt(a)}q-12 22 -6 40"/></g>`;
    }
  }
  return "";
}

/* ---------- faces ---------- */
const ring = (o) => ({ shape: "ring", rx: 16, ry: 16, ...o });
const yawn = (t) => {
  const p = (t % 4.2) / 1.6;
  return p < 1 ? Math.sin(Math.PI * p) ** 2 : 0;
};

export const FACES = {
  neutral: {
    label: "平静",
    kao: "(0 0",
    f: () => ({ gap: [50, 50], eyes: [ring(), ring()] }),
  },
  happy: {
    label: "开心",
    kao: "(^ ^",
    f: () => ({
      gap: [58, 58],
      eyes: [{ shape: "up" }, { shape: "up" }],
      blush: 0.45,
    }),
  },
  wink: {
    label: "眨眼",
    kao: "(0 ^",
    f: () => ({ gap: [56, 52], eyes: [ring(), { shape: "up" }] }),
  },
  love: {
    label: "喜欢",
    kao: "(♡ ♡",
    f: (t) => {
      const s = 0.8 + 0.08 * Math.sin(t * 9);
      return {
        gap: [56, 56],
        eyes: [
          { shape: "heart", s, sw: 8 },
          { shape: "heart", s, sw: 8 },
        ],
        blush: 0.7,
        emit: "heart",
      };
    },
  },
  shy: {
    label: "害羞",
    kao: "(o o *",
    f: () => ({
      gap: [40, 40],
      eyes: [
        ring({ rx: 13, ry: 12, dx: -3, dy: 5 }),
        ring({ rx: 13, ry: 12, dx: -3, dy: 5 }),
      ],
      blush: 1,
      lookLock: true,
    }),
  },
  surprised: {
    label: "惊讶",
    kao: "(O O",
    f: () => ({
      gap: [62, 62],
      eyes: [ring({ rx: 20, ry: 21 }), ring({ rx: 20, ry: 21 })],
      bang: true,
    }),
  },
  angry: {
    label: "生气",
    kao: "(ò ó",
    f: () => ({
      gap: [36, 36],
      eyes: [ring({ ry: 11, dy: 4 }), ring({ ry: 11, dy: 4 })],
      brows: "angry",
      anger: true,
      shake: true,
    }),
  },
  sad: {
    label: "难过",
    kao: "(ó ò",
    f: () => ({
      gap: [34, 40],
      eyes: [ring({ ry: 14, dy: 4 }), ring({ ry: 14, dy: 4 })],
      brows: "sad",
      emit: "tear",
    }),
  },
  sleepy: {
    label: "犯困",
    kao: "(- -",
    f: (t) => {
      const y = yawn(t);
      return {
        gap: [50 + 14 * y, 50 + 14 * y],
        eyes: [
          { shape: "lid", ry: 9 - 7 * y },
          { shape: "lid", ry: 9 - 7 * y },
        ],
      };
    },
  },
  sleep: {
    label: "睡着",
    kao: "(u u",
    f: (t) => {
      const b = 40 + 6 * Math.sin(t * 1.7);
      return {
        gap: [b, b],
        eyes: [{ shape: "down" }, { shape: "down" }],
        emit: "z",
      };
    },
  },
  dizzy: {
    label: "晕乎",
    kao: "(@ @",
    f: (t) => ({
      gap: [54 + 5 * Math.sin(t * 5), 48],
      eyes: [
        { shape: "spiral", rot: t * 7 },
        { shape: "spiral", rot: t * 7 + 1.4 },
      ],
      orbit: true,
    }),
  },
  dragged: {
    label: "被拎起",
    kao: "(> <",
    f: (t) => {
      const g = 55 + 3 * Math.sin(t * 22);
      return {
        gap: [g, g],
        eyes: [{ shape: "gt" }, { shape: "lt" }],
        sweat: true,
      };
    },
  },
  content: {
    label: "惬意",
    f: (t, p) => {
      const r = 11 - 9 * (p ? p.drowse : 0);
      return {
        gap: [46, 46],
        eyes: [
          { shape: "lid", ry: r },
          { shape: "lid", ry: r },
        ],
      };
    },
  },
  waking: {
    label: "醒来",
    f: (t, p) => {
      const mt = p ? p.modeT : 1;
      const k = clamp(mt / 0.5, 0, 1),
        y = mt > 0.5 ? Math.sin(clamp((mt - 0.5) / 0.9, 0, 1) * Math.PI) : 0;
      const r = Math.max(0, 10 * k * (1 - 0.7 * y));
      return {
        gap: [50 + 12 * y, 50 + 12 * y],
        eyes: [
          { shape: "lid", ry: r },
          { shape: "lid", ry: r },
        ],
      };
    },
  },
  squeeze: {
    label: "回神",
    f: () => ({
      gap: [44, 44],
      eyes: [
        { shape: "lid", ry: 0 },
        { shape: "lid", ry: 0 },
      ],
    }),
  },
  listening: {
    label: "倾听",
    f: () => ({
      gap: [44, 44],
      eyes: [
        ring({ rx: 17, ry: 18, dy: -1 }),
        ring({ rx: 17, ry: 18, dy: -1 }),
      ],
      listen: true,
    }),
  },
  thinking: {
    label: "思考",
    f: (t) => ({
      gap: [46, 46],
      eyes: [
        ring({ rx: 14, ry: 15, dx: 3, dy: -4 }),
        ring({ rx: 14, ry: 15, dx: 3, dy: -4 }),
      ],
      think: true,
    }),
  },
  run: {
    label: "冲刺",
    f: (t) => {
      const g = 55 + 4 * Math.sin(t * 16);
      return { gap: [g, g], eyes: [ring(), ring()], sweat: true };
    },
  },
};
export const GALLERY = [
  "neutral",
  "happy",
  "wink",
  "love",
  "shy",
  "surprised",
  "angry",
  "sad",
  "sleepy",
  "sleep",
  "dizzy",
  "dragged",
];

/** One frame of the figure as SVG markup, in logo units. */
export function figure(fc, o) {
  const t = o.t,
    lx = o.look[0],
    ly = o.look[1],
    acc = o.acc,
    sw = o.swing || 0;
  let s = `<g class="ink" fill="none" stroke-width="${LEG_W}" stroke-linecap="round">`;
  for (const l of o.legs)
    s += `<path d="M${f(l[0])} ${f(l[1])}L${f(l[2])} ${f(l[3])}"/>`;
  s += `</g><g transform="translate(0 ${f(o.low)})">`;
  s += sideBack(acc.side, sw);
  s += headBack(acc.head, sw);
  s += `<path class="ink" fill="none" stroke-width="${BODY_W}" stroke-linecap="round" d="${cPath(fc.gap[0], fc.gap[1])}"/>`;
  s += neckD(acc.neck, sw);
  if (fc.blush > 0.02) {
    s += `<g class="blush" opacity="${f(fc.blush * 0.8)}"><ellipse cx="${f(99 + lx)}" cy="146" rx="11" ry="5.5"/><ellipse cx="${f(167 + lx)}" cy="146" rx="11" ry="5.5"/></g>`;
  }
  const close = o.eyeClose || 0;
  fc.eyes.forEach((e, i) => {
    const ee = { ...e };
    if ((ee.shape === "ring" || ee.shape === "lid") && o.blink)
      ee.ry *= 1 - o.blink;
    const cx = EYES[i][0] + lx,
      cy = EYES[i][1] + ly;
    const tr =
      close > 0.01
        ? ` transform="translate(0 ${f(cy)}) scale(1 ${f(Math.max(0.08, 1 - close) * 100) / 100}) translate(0 ${f(-cy)})"`
        : "";
    s += `<path class="eye" fill="none" stroke-width="${e.sw || 12}" stroke-linecap="round" stroke-linejoin="round"${tr} d="${eyePath(ee, cx, cy)}"/>`;
  });
  s += glassesD(acc.glasses, lx * 0.4, ly * 0.3);
  if (fc.brows) {
    const bx = lx * 0.5,
      by = ly * 0.4;
    const d =
      fc.brows === "angry"
        ? `M${f(98 + bx)} ${f(88 + by)}L${f(124 + bx)} ${f(97 + by)}M${f(152 + bx)} ${f(97 + by)}L${f(178 + bx)} ${f(88 + by)}`
        : `M${f(98 + bx)} ${f(96 + by)}L${f(123 + bx)} ${f(88 + by)}M${f(153 + bx)} ${f(88 + by)}L${f(178 + bx)} ${f(96 + by)}`;
    s += `<path class="ink" fill="none" stroke-width="9" stroke-linecap="round" d="${d}"/>`;
  }
  s += sideFront(acc.side, sw);
  s += headFront(acc.head, sw, t);
  if (fc.orbit) {
    const top = HEAD_TOP[acc.head] ?? 12;
    for (let i = 0; i < 3; i++) {
      const a = t * 3.2 + i * 2.094,
        sn = Math.sin(a);
      s += `<circle class="eye" fill="none" stroke-width="4" cx="${f(128 + 62 * Math.cos(a))}" cy="${f(top + 12 * sn)}" r="${sn < 0 ? 5 : 7}" opacity="${sn < 0 ? 0.55 : 1}"/>`;
    }
  }
  if (fc.listen) {
    // sound waves drifting in toward the face
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.9 + i / 3) % 1,
        r = 46 - 30 * p,
        a0 = -0.55,
        a1 = 0.55;
      s += `<path class="eye" fill="none" stroke-width="7" stroke-linecap="round" opacity="${f(Math.sin(Math.PI * p))}" d="M${f(196 + r * Math.cos(a0))} ${f(104 + r * Math.sin(a0))}A${f(r)} ${f(r)} 0 0 1 ${f(196 + r * Math.cos(a1))} ${f(104 + r * Math.sin(a1))}"/>`;
    }
  }
  if (fc.think) {
    // three rings rising from the head, the eye's own shape
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.8 + i / 3) % 1;
      s += `<circle class="eye" fill="none" stroke-width="5" cx="${f(214 + 10 * i)}" cy="${f(46 - 22 * i - 6 * k)}" r="${4 + 3 * i}" opacity="${f(0.4 + 0.6 * Math.sin(Math.PI * k))}"/>`;
    }
  }
  if (fc.sweat)
    s += `<path class="tearf" transform="translate(56 ${f(64 + 3 * Math.sin(t * 7))}) scale(1.3)" d="${DROP}"/>`;
  if (fc.anger) {
    const k = 1 + 0.12 * Math.sin(t * 10);
    s += `<g class="angry" transform="translate(210 44) scale(${f(k * 10) / 10})" fill="none" stroke-width="7" stroke-linecap="round"><path d="M-13 -4Q-4 -4 -4 -13M4 -13Q4 -4 13 -4M13 4Q4 4 4 13M-4 13Q-4 4 -13 4"/></g>`;
  }
  if (fc.bang)
    s += `<g transform="translate(222 30)"><path class="ink" fill="none" stroke-width="11" stroke-linecap="round" d="M0 -18V4"/><circle class="inkf" cx="0" cy="18" r="5.5"/></g>`;
  if (o.zmark)
    s +=
      '<path class="eye" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" d="M204 22H220L204 42H220M226 4H236L226 16H236"/>';
  return s + "</g>";
}

/** A static figure for previews and tiles. */
export function mini(face, acc, t = 0, extra = {}) {
  return figure(FACES[face].f(t), {
    look: [0, 0],
    legs: STAND,
    low: 0,
    t,
    blink: 0,
    acc,
    ...extra,
  });
}

/* ---------- skin ---------- */
/** Bodies the pet can wear: Coo (drawn here) or the DeepSeek whale maid (web/whale, with its colour schemes). */
export const FIGURES = [
  ["coo", "Coo"],
  ["whale", "DeepSeek 大肥鱼"],
];
export function defaultSkin() {
  return {
    figure: "coo",
    scheme: "deepseek",
    palette: "mint",
    head: "none",
    side: "none",
    glasses: "none",
    neck: "none",
    colors: JSON.parse(JSON.stringify(CHANNEL_DEFAULT)),
  };
}
const validColor = (slot, v) =>
  v === "eye" ||
  (v === "body" && !NO_BODY[slot]) ||
  ACC_COLORS.some((c) => c.id === v);
/** Keeps what is valid in `raw`, defaults the rest. */
export function normalizeSkin(raw) {
  const skin = defaultSkin();
  if (!raw || typeof raw !== "object") return skin;
  if (FIGURES.some(([id]) => id === raw.figure)) skin.figure = raw.figure;
  // the whale's schemes are listed in its model; the pet page falls back to the original for an unknown id
  if (typeof raw.scheme === "string" && /^[a-z0-9-]{1,32}$/.test(raw.scheme))
    skin.scheme = raw.scheme;
  if (PALETTES.some((p) => p.id === raw.palette)) skin.palette = raw.palette;
  for (const slot of SLOTS)
    if (SLOT_LISTS[slot].some((h) => h[0] === raw[slot]))
      skin[slot] = raw[slot];
  for (const slot of SLOTS)
    for (const ch of ["main", "acc"]) {
      const v = raw.colors?.[slot]?.[ch];
      if (validColor(slot, v)) skin.colors[slot][ch] = v;
    }
  return skin;
}
/** Picking an item: fills the character colors of pieces that carry them. */
export function wear(skin, slot, id) {
  const next = { ...skin, colors: JSON.parse(JSON.stringify(skin.colors)) };
  next[slot] = id;
  if (ITEM_COLORS[id]) Object.assign(next.colors[slot], ITEM_COLORS[id]);
  return next;
}
function channelValue(skin, slot, ch, dark) {
  const v = skin.colors[slot][ch];
  if (v === "body") return "var(--skin-ink)";
  if (v === "eye") return "var(--skin-eye)";
  const c = ACC_COLORS.find((x) => x.id === v);
  return dark ? c.d : c.l;
}
/** CSS custom properties for one theme side. */
export function skinVars(skin, dark) {
  const p = PALETTES.find((x) => x.id === skin.palette) || PALETTES[0];
  let s = `--skin-ink:${p[dark ? "d" : "l"][0]};--skin-eye:${p[dark ? "d" : "l"][1]};`;
  for (const slot of SLOTS)
    for (const ch of ["main", "acc"])
      s += `--c-${slot}-${ch}:${channelValue(skin, slot, ch, dark)};`;
  return s;
}
/** A stylesheet applying `skin` under `selector`, following the page's light/dark choice. */
export function skinCss(skin, selector = "html:root") {
  return (
    `${selector}{${skinVars(skin, false)}}` +
    `@media (prefers-color-scheme: dark){${selector}:not([data-theme="light"]){${skinVars(skin, true)}}}` +
    `${selector}[data-theme="dark"]{${skinVars(skin, true)}}`
  );
}

/* ---------- the pages' round buttons: icons (24 units, currentColor) and the theme switch ---------- */
const icon = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  chat: icon(
    '<path d="M6 4.5h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-6l-4.5 3.5v-3.5H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3z"/>',
  ),
  moon: icon(
    '<path d="M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z"/>',
  ),
  sun: icon(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v1.6M12 19.6v1.6M2.8 12h1.6M19.6 12h1.6M5.5 5.5l1.1 1.1M17.4 17.4l1.1 1.1M5.5 18.5l1.1-1.1M17.4 6.6l1.1-1.1"/>',
  ),
  play: icon('<path d="M8 5.5v13l10.5-6.5z"/>'),
  pause: icon('<path d="M9 5.5v13M15 5.5v13"/>'),
  // eight flat teeth around a hub
  settings: icon(
    `<path d="${Array.from({ length: 32 }, (_, i) => {
      const a = ((i - 0.5) * Math.PI) / 16,
        r = i % 4 < 2 ? 9.6 : 7.2;
      return `${i ? "L" : "M"}${f(12 + r * Math.cos(a))} ${f(12 + r * Math.sin(a))}`;
    }).join("")}Z"/><circle cx="12" cy="12" r="3"/>`,
  ),
  power: icon('<path d="M12 3.5v8M7.2 6.3a8 8 0 1 0 9.6 0"/>'),
  mic: icon(
    '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3"/>',
  ),
  // the same microphone struck through
  micOff: icon(
    '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3M4 4l16 16"/>',
  ),
  sound: icon(
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  ),
  soundOff: icon(
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  ),
  // a T-shirt: the dressing page
  shirt: icon(
    '<path d="M8.5 3.5 4 6l-1.5 4.5L6 12v8.5h12V12l3.5-1.5L20 6l-4.5-2.5a3.5 3.5 0 0 1-7 0z"/>',
  ),
  eye: icon(
    '<path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="3"/>',
  ),
  // a page that opens in the browser
  external: icon(
    '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  ),
  eyeOff: icon(
    '<path d="M3 12s3.2-6 9-6c1.6 0 3 .4 4.2 1M21 12s-3.2 6-9 6c-1.6 0-3-.4-4.2-1"/><path d="M9.9 14.1a3 3 0 0 1 4.2-4.2M4 4l16 16"/>',
  ),
  // how much the pet walks on its own, as a gauge: low, middle, high
  roam_off: icon(
    '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16 7 13.2"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>',
  ),
  roam_calm: icon(
    '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16V10"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>',
  ),
  roam_free: icon(
    '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l5-2.8"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/><path d="M19.5 6.5l1.5-1.5M21 10h1.5"/>',
  ),
};
/** Sets `theme` ('dark' | 'light') on the page; `button`, when given, shows the mode a click switches to. */
export function applyTheme(theme, button) {
  document.documentElement.dataset.theme = theme;
  if (!button) return;
  const toLight = theme === "dark";
  button.innerHTML = toLight ? ICONS.sun : ICONS.moon;
  button.title = toLight ? "切到白天模式" : "切到夜间模式";
  button.setAttribute("aria-label", button.title);
}

/* ---------- sound: synthesized with Web Audio, no files ---------- */
export function createSfx({
  storageKey = "cortico-pet.sound.v1",
  volume = 0.55,
} = {}) {
  let ctx = null,
    master = null,
    unlocked = false,
    on = true,
    noiseBuf = null,
    gainValue = volume;
  try {
    on = localStorage.getItem(storageKey) !== "off";
  } catch (e) {
    /* default on */
  }
  const R = (a, b) => a + Math.random() * (b - a);
  function ready() {
    if (!on || !unlocked || document.hidden) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = gainValue;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone({
    type = "sine",
    f0 = 440,
    f1 = f0,
    dur = 0.1,
    vol = 0.2,
    at = 0,
    attack = 0.005,
    vib = 0,
    vibRate = 0,
    filter = 0,
  }) {
    const c = ready();
    if (!c) return;
    const t0 = c.currentTime + at,
      o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    if (vib) {
      const l = c.createOscillator(),
        lg = c.createGain();
      l.frequency.value = vibRate;
      lg.gain.value = vib;
      l.connect(lg);
      lg.connect(o.frequency);
      l.start(t0);
      l.stop(t0 + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (filter) {
      const bq = c.createBiquadFilter();
      bq.type = "lowpass";
      bq.frequency.value = filter;
      o.connect(bq);
      node = bq;
    }
    node.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }
  function noise({
    type = "bandpass",
    f0 = 1000,
    f1 = f0,
    q = 1,
    dur = 0.2,
    vol = 0.15,
    at = 0,
    attack = 0.01,
  }) {
    const c = ready();
    if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + at,
      s = c.createBufferSource(),
      bq = c.createBiquadFilter(),
      g = c.createGain();
    s.buffer = noiseBuf;
    bq.type = type;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t0);
    bq.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(bq);
    bq.connect(g);
    g.connect(master);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.03);
  }
  const api = {
    unlock() {
      unlocked = true;
      ready();
    },
    isOn: () => on,
    set(v) {
      on = v;
      try {
        localStorage.setItem(storageKey, v ? "on" : "off");
      } catch (e) {
        /* not persisted */
      }
    },
    volume(v) {
      gainValue = v;
      if (master) master.gain.value = v;
    },
    step(run, i) {
      const k = run ? 1.25 : 1;
      tone({
        f0: (i ? 520 : 440) * k,
        f1: (i ? 380 : 330) * k,
        dur: 0.06,
        vol: run ? 0.07 : 0.05,
      });
      if (run) noise({ f0: 2500, q: 0.8, dur: 0.05, vol: 0.03 });
    },
    skid() {
      noise({ type: "highpass", f0: 1800, f1: 900, dur: 0.22, vol: 0.08 });
    },
    jump() {
      tone({
        type: "triangle",
        f0: 200,
        f1: 720,
        dur: 0.24,
        vol: 0.22,
        vib: 40,
        vibRate: 22,
      });
    },
    land(hard) {
      tone({
        f0: hard ? 160 : 190,
        f1: 48,
        dur: hard ? 0.28 : 0.16,
        vol: hard ? 0.4 : 0.25,
      });
      noise({
        type: "lowpass",
        f0: hard ? 700 : 500,
        f1: 120,
        dur: 0.12,
        vol: hard ? 0.25 : 0.12,
      });
      if (hard)
        tone({
          type: "square",
          f0: 420,
          f1: 300,
          dur: 0.08,
          vol: 0.06,
          at: 0.02,
          filter: 1600,
        });
    },
    grab() {
      tone({
        type: "triangle",
        f0: 680,
        f1: 1500,
        dur: 0.14,
        vol: 0.18,
        vib: 60,
        vibRate: 30,
      });
    },
    squeak() {
      tone({
        type: "triangle",
        f0: R(900, 1200),
        f1: R(1300, 1700),
        dur: 0.09,
        vol: 0.08,
        vib: 40,
        vibRate: 35,
      });
    },
    whoosh() {
      noise({ f0: 300, f1: 2400, q: 1.4, dur: 0.38, vol: 0.22, attack: 0.08 });
    },
    chirps() {
      for (let i = 0; i < 3; i++)
        tone({
          f0: 2300 + i * 120,
          f1: 3200,
          dur: 0.06,
          vol: 0.06,
          at: i * 0.11,
        });
    },
    shake() {
      for (let i = 0; i < 5; i++)
        tone({
          type: "square",
          f0: 180,
          f1: 160,
          dur: 0.05,
          vol: 0.05,
          at: i * 0.06,
          filter: 900,
        });
    },
    hmm() {
      tone({ type: "triangle", f0: 330, f1: 360, dur: 0.12, vol: 0.08 });
      tone({
        type: "triangle",
        f0: 392,
        f1: 470,
        dur: 0.16,
        vol: 0.08,
        at: 0.14,
      });
    },
    yawn() {
      tone({
        type: "triangle",
        f0: 520,
        f1: 240,
        dur: 1,
        vol: 0.1,
        vib: 12,
        vibRate: 5,
        filter: 1500,
        attack: 0.15,
      });
    },
    snore() {
      noise({
        type: "lowpass",
        f0: 250,
        f1: 700,
        dur: 0.7,
        vol: 0.09,
        attack: 0.35,
      });
    },
    purr() {
      tone({
        type: "sawtooth",
        f0: 62,
        f1: 58,
        dur: 0.9,
        vol: 0.08,
        vib: 6,
        vibRate: 24,
        filter: 320,
        attack: 0.1,
      });
    },
    poke() {
      tone({ f0: 320, f1: 200, dur: 0.09, vol: 0.16 });
    },
    nod() {
      tone({ type: "triangle", f0: 520, f1: 440, dur: 0.07, vol: 0.08 });
      tone({
        type: "triangle",
        f0: 520,
        f1: 440,
        dur: 0.07,
        vol: 0.08,
        at: 0.2,
      });
    },
    spin() {
      tone({
        type: "triangle",
        f0: 300,
        f1: 1200,
        dur: 0.3,
        vol: 0.12,
        vib: 30,
        vibRate: 18,
      });
    },
    happy() {
      tone({ type: "triangle", f0: 660, f1: 700, dur: 0.1, vol: 0.14 });
      tone({
        type: "triangle",
        f0: 990,
        f1: 1050,
        dur: 0.14,
        vol: 0.14,
        at: 0.09,
      });
    },
    wink() {
      tone({ f0: 1760, dur: 0.5, vol: 0.1 });
      tone({ f0: 2637, dur: 0.45, vol: 0.06, at: 0.04 });
    },
    love() {
      tone({ f0: 480, f1: 820, dur: 0.1, vol: 0.14 });
      tone({ f0: 600, f1: 1000, dur: 0.12, vol: 0.14, at: 0.13 });
    },
    surprised() {
      tone({ f0: 380, f1: 1500, dur: 0.2, vol: 0.16, vib: 15, vibRate: 12 });
    },
    angry() {
      tone({
        type: "sawtooth",
        f0: 120,
        f1: 95,
        dur: 0.5,
        vol: 0.12,
        vib: 12,
        vibRate: 14,
        filter: 700,
      });
    },
    sad() {
      tone({
        type: "triangle",
        f0: 440,
        f1: 392,
        dur: 0.3,
        vol: 0.13,
        vib: 8,
        vibRate: 6,
      });
      tone({
        type: "triangle",
        f0: 392,
        f1: 262,
        dur: 0.55,
        vol: 0.13,
        at: 0.3,
        vib: 10,
        vibRate: 5,
      });
    },
    shy() {
      tone({ f0: 1300, f1: 1600, dur: 0.07, vol: 0.07 });
      tone({ f0: 1450, f1: 1750, dur: 0.07, vol: 0.06, at: 0.1 });
    },
    expr(n) {
      const m = {
        happy: "happy",
        wink: "wink",
        love: "love",
        surprised: "surprised",
        angry: "angry",
        sad: "sad",
        shy: "shy",
        sleepy: "yawn",
      };
      if (m[n]) api[m[n]]();
    },
    tick() {
      tone({ f0: 1200, f1: 1000, dur: 0.03, vol: 0.05 });
    },
    pop() {
      tone({ f0: 240, f1: 720, dur: 0.07, vol: 0.14 });
    },
    sparkle() {
      [1568, 2093, 2637].forEach((fr, i) =>
        tone({ f0: fr, dur: 0.25, vol: 0.06, at: i * 0.06 }),
      );
    },
    select() {
      tone({ type: "triangle", f0: 520, f1: 1040, dur: 0.1, vol: 0.12 });
    },
    babble(ch) {
      const fr = 330 + (ch.codePointAt(0) % 9) * 28;
      tone({
        type: "square",
        f0: fr,
        f1: fr * R(0.85, 1.1),
        dur: 0.05,
        vol: 0.05,
        filter: 1800,
      });
    },
    blub() {
      tone({ f0: R(500, 700), f1: R(900, 1200), dur: 0.05, vol: 0.05 });
    },
    listenStart() {
      tone({ f0: 880, dur: 0.12, vol: 0.1 });
      tone({ f0: 1320, dur: 0.16, vol: 0.1, at: 0.1 });
    },
    listenEnd() {
      tone({ f0: 1320, dur: 0.1, vol: 0.09 });
      tone({ f0: 990, dur: 0.16, vol: 0.09, at: 0.09 });
    },
  };
  return api;
}

/* ---------- actions the pet can be asked to do ---------- */
/** Expressions: a face held for a few seconds. */
export const EXPRESSIONS = [
  "neutral",
  "happy",
  "wink",
  "love",
  "shy",
  "surprised",
  "angry",
  "sad",
  "sleepy",
  "thinking",
];
/** Motions: things the body does. `sit` and `sleep` last until something else happens. */
export const MOTIONS = [
  "stand",
  "jump",
  "hop",
  "look",
  "turn",
  "nod",
  "shake",
  "spin",
  "sit",
  "sleep",
  "dizzy",
  "walk",
  "run",
];

/* ---------- the live pet: simulation, rendering, pointer ---------- */
/**
 * `els`: { svg, petG, shadowEl, fxG } inside a stage element that receives pointer events.
 * `opts.bounds()` returns { W, H, floorY, S } in stage pixels.
 * `opts.onEvent(kind, detail)` reports what happened to the body: arrived, interrupted, touch, mode.
 * `opts.enter: 'drop'` starts the pet above the top edge, falling to the floor.
 * `opts.walkInPlace` animates strides at a fixed anchor; the desktop host owns screen movement.
 * `opts.figure`, when given, draws the body instead of the built-in one: `figure.draw(petG, face, frame)` keeps
 * its own elements inside `petG` (same logo space, feet at y=256). Its frame adds the face's name, the mode,
 * how long the mode has run, the talk level, drowsiness and how far the body sits.
 * `figure.groupTilt(mode, tilt, lean)`, if present, returns the rotation (degrees) the whole group gets
 * instead of tilt + lean; the frame carries tilt, lean and that rotation (groupRot) so the figure can bend the rest.
 * `figure.colors.z`, if present, colours the sleep z's (otherwise they take the skin's eye colour).
 */
export function createPet(els, opts) {
  const { petG, shadowEl, fxG } = els;
  let custom = opts.figure || null;
  const sfx = opts.sfx;
  const onEvent = opts.onEvent || (() => {});
  let W = 0,
    H = 0,
    floorY = 0,
    S = 0.42,
    T = 0;
  let roam = opts.roam ?? "free";
  let skin = opts.skin || defaultSkin();
  let hold = 0; // until T: an order from outside is in progress, free roaming waits
  const initialGroupFacing = custom?.groupFacing?.();
  const pet = {
    x: 260,
    fy: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    faceVis:
      initialGroupFacing === 1 || initialGroupFacing === -1
        ? initialGroupFacing
        : 1,
    mode: "idle",
    modeT: 0,
    dur: 0,
    target: 0,
    speed: 0,
    stride: 0,
    lift: 0,
    bob: 0,
    phase: 0,
    lastHalf: 0,
    lean: 0,
    tilt: 0,
    tiltV: 0,
    sq: 0,
    sqv: 0,
    sitK: 0,
    stretch: 0,
    low: 0,
    gap: [50, 50],
    look: [0, 0],
    drowse: 0,
    feet: STAND.map((l) => [l[2], l[3]]),
    blinkT: 1.5,
    blinkAge: 9,
    expr: null,
    exprUntil: 0,
    nextAt: 1.2,
    emitAt: 0,
    airKind: "jump",
    turned: false,
    startle: false,
    lastAct: "",
    turnAcc: 0,
    dx: 0,
    dy: 0,
    jumpV: 700,
    jumpVx: 0,
    xf: null,
    blushK: 0,
    eyeSig: "",
    eyeCur: null,
    eyePrev: null,
    eyeDims: [
      [16, 16, 0, 0],
      [16, 16, 0, 0],
    ],
    swapAge: 9,
    glance: [0, 0],
    glanceAt: 0,
    swing: 0,
    swingV: 0,
    prevA: null,
    velX: 0,
    talkK: 0,
    sfxAt: 0,
    skid: false,
    cue: 0,
    pulse: null,
    walkId: 0,
    listening: false,
    thinking: false,
    placed: false,
  };
  const pointer = { x: -1e4, y: -1e4, inside: false, vx: 0, samples: [] };
  let press = null,
    strokeAcc = 0,
    petCool = 0;
  let locomotion = null;
  let heldAnchor = null;
  let releaseOrigin = null;
  let placementHandoff = null;
  let placementToken = -1;
  let rejectedReaction = null;
  function viewportOrigin() {
    const value = opts.viewportOrigin?.();
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? value
      : null;
  }
  function handoffLocal() {
    const origin = viewportOrigin() || placementHandoff?.origin;
    if (!placementHandoff || !origin) return null;
    placementHandoff.origin = { ...origin };
    return {
      x: placementHandoff.world.x - origin.x,
      y: placementHandoff.world.y - origin.y,
    };
  }
  function beginPlacementHandoff(token) {
    if (placementHandoff?.token === token) return true;
    const origin = viewportOrigin();
    if (
      !Number.isSafeInteger(token) ||
      token <= placementToken ||
      !origin ||
      !pet.xf
    )
      return false;
    placementToken = token;
    placementHandoff = {
      token,
      committed: false,
      origin: { ...origin },
      // The installed SVG transform rounds its DIP root to 0.1, so latch
      // that actually drawn root rather than its unrounded simulation value.
      world: { x: origin.x + f(pet.xf.AX), y: origin.y + f(pet.xf.AY) },
    };
    return true;
  }
  function commitPlacementHandoff(token) {
    if (!placementHandoff || placementHandoff.token !== token) return false;
    placementHandoff.committed = true;
    return true;
  }
  function cancelPlacementHandoff() {
    if (!placementHandoff) return false;
    const local = handoffLocal();
    placementHandoff = null;
    heldAnchor = null;
    if (local) releaseOrigin = { ...local, at: T };
    setLocomotion(null);
    return true;
  }
  function setLocomotion(value) {
    const active = value && value.state !== "idle" ? value : null;
    if (placementHandoff?.committed && active?.state !== "held") {
      const local = handoffLocal();
      if (local) releaseOrigin = { ...local, at: T };
      heldAnchor = null;
      placementHandoff = null;
    }
    if (active?.state === "held" && !heldAnchor && active.grip && pet.xf) {
      const c = pet.xf,
        r = (c.rot * Math.PI) / 180;
      const dx = active.grip.x - c.AX,
        dy = active.grip.y - c.AY;
      const pickup = custom?.pickupPoint?.();
      heldAnchor = {
        point: active.grip,
        x: c.ax + (dx * Math.cos(r) + dy * Math.sin(r)) / c.kx,
        y: c.ay + (-dx * Math.sin(r) + dy * Math.cos(r)) / c.ky,
        pickup:
          Array.isArray(pickup) &&
          pickup.length === 2 &&
          pickup.every(Number.isFinite)
            ? [...pickup]
            : null,
        at: T,
      };
      heldAnchor.startX = heldAnchor.x;
      heldAnchor.startY = heldAnchor.y;
      releaseOrigin = null;
    }
    if (active?.state === "held" && heldAnchor && active.grip)
      heldAnchor.point = active.grip;
    if (active?.state !== "held" && heldAnchor) {
      if (pet.xf)
        releaseOrigin = {
          x: pet.xf.AX - (value?.placementShift?.x ?? 0),
          y: pet.xf.AY - (value?.placementShift?.y ?? 0),
          at: T,
        };
      heldAnchor = null;
    }
    if (
      active?.state !== locomotion?.state ||
      (active && pet.mode !== `locomotion-${active.state}`)
    ) {
      setMode(active ? `locomotion-${active.state}` : "idle");
      pet.fy = floorY;
      pet.vx = pet.vy = 0;
    }
    locomotion = active;
  }
  const P = [];

  // points on the body in logo units: where the eyes look from, where tears, z's and hearts start, the bubble's spot
  const COO_ANCHORS = {
    gaze: [140, 117],
    tear: [166, 136],
    z: [196, 40],
    hearts: [90, 175, 34],
    bubble: [146, 0],
  };
  let A = { ...COO_ANCHORS, ...custom?.anchors };
  const minX = () => Math.min(W / 2, 104 * S + 8),
    maxX = () => Math.max(W / 2, W - 104 * S - 8);

  function resize() {
    cancelPlacementHandoff();
    const b = opts.bounds();
    W = b.W;
    H = b.H;
    floorY = b.floorY;
    S = b.S;
    if (!pet.placed && W > 0) {
      pet.x = opts.startX != null ? opts.startX : W * 0.7;
      pet.placed = true;
      if (opts.enter === "drop") {
        pet.fy = -8;
        pet.vy = 0;
        pet.vx = 0;
        pet.airKind = "drop";
        setMode("air");
      }
    }
    pet.x = clamp(pet.x, minX(), maxX());
    if (!opts.walkInPlace) pet.target = clamp(pet.target, minX(), maxX());
    if (pet.mode !== "air" && pet.mode !== "drag") pet.fy = floorY;
  }

  function toStage(lx, ly) {
    const c = pet.xf;
    if (!c) return { x: pet.x, y: floorY };
    const x = (lx - c.ax) * c.kx,
      y = (ly - c.ay) * c.ky,
      r = (c.rot * Math.PI) / 180;
    return {
      x: c.AX + x * Math.cos(r) - y * Math.sin(r),
      y: c.AY + x * Math.sin(r) + y * Math.cos(r),
    };
  }
  function hitPet(p) {
    const c = toStage(128, 128);
    return Math.hypot(p.x - c.x, p.y - c.y) < 108 * S;
  }

  function setMode(m, o = {}) {
    const prev = pet.mode;
    if ((prev === "walk" || prev === "run") && m !== "idle" && pet.walkId) {
      onEvent("interrupted", {
        walkId: pet.walkId,
        x: Math.round(pet.x),
        by: m,
      });
      pet.walkId = 0;
    }
    pet.mode = m;
    pet.modeT = 0;
    pet.turned = false;
    pet.startle = false;
    pet.skid = false;
    pet.cue = 0;
    Object.assign(pet, o);
    if (prev !== m) onEvent("mode", { mode: m });
  }
  const busy = () =>
    pet.mode === "drag" || pet.mode === "air" || pet.mode === "crouch";
  function pickTarget(minDist) {
    for (let i = 0; i < 12; i++) {
      const x = rnd(minX(), maxX());
      if (Math.abs(x - pet.x) > minDist) return x;
    }
    return pet.x - minX() > maxX() - pet.x ? minX() : maxX();
  }

  /** Runs a motion. Returns false when the body cannot take it now (in the air, being dragged). */
  function act(a) {
    if (busy()) return false;
    pet.expr = null;
    pet.lastAct = a;
    const seated = pet.mode === "sleep" || pet.mode === "sit";
    switch (a) {
      case "stand":
        setMode(seated ? "wake" : "idle", seated ? { startle: false } : {});
        pet.nextAt = T + 3;
        break;
      case "walk":
        setMode("walk", {
          target: opts.walkInPlace ? pet.x + pet.facing * 160 : pickTarget(160),
        });
        break;
      case "run":
        setMode("run", {
          target: opts.walkInPlace
            ? pet.x + pet.facing * 320
            : pet.x < W / 2
              ? maxX() - rnd(0, 30)
              : minX() + rnd(0, 30),
        });
        break;
      case "jump":
        setMode("crouch", { jumpV: 720, jumpVx: pet.facing * 40 });
        break;
      case "hop":
        setMode("crouch", { jumpV: 480, jumpVx: 0 });
        break;
      case "look":
        setMode("look");
        break;
      case "turn":
        if (!seated) setMode("idle");
        pet.facing *= -1;
        sfx.tick();
        break;
      case "nod":
        pulse("nod", 0.7);
        sfx.nod();
        break;
      case "shake":
        pulse("shake", 0.7);
        sfx.shake();
        break;
      case "spin":
        if (!seated) setMode("idle");
        pulse("spin", 0.6);
        sfx.spin();
        break;
      case "sit":
        setMode("sit", { dur: 1e9 });
        break;
      case "sleep":
        setMode("sleep", { dur: 1e9 });
        break;
      case "dizzy":
        setMode("dizzy");
        break;
      default:
        return false;
    }
    return true;
  }
  function pulse(kind, dur) {
    pet.pulse = { kind, t0: T, dur };
  }

  function setExpr(n, seconds) {
    if (n === "sleep") {
      act("sleep");
      return;
    }
    if (busy()) return;
    if (n === "dragged") {
      pet.expr = null;
      pet.vy = -1150;
      pet.vx = rnd(-120, 120);
      pet.airKind = "throw";
      pet.sqv -= 3;
      sfx.whoosh();
      sfx.jump();
      setMode("air");
      return;
    }
    if (n === "dizzy") {
      pet.expr = null;
      setMode("dizzy");
      return;
    }
    if (pet.mode === "look" || pet.mode === "land") setMode("idle");
    pet.expr = n;
    pet.exprUntil = T + (seconds ?? (n === "sleepy" ? 4.4 : 3.2));
    pet.nextAt = Math.max(pet.nextAt, pet.exprUntil + 0.6);
    pet.sqv += n === "surprised" ? -2.2 : 0.8;
    sfx.expr(n);
    if (n === "love") for (let i = 0; i < 4; i++) emitHeart();
  }

  /** Walks (or runs) to stage x. Resolves the walk through onEvent('arrived' | 'interrupted'). */
  function walkTo(x, run, walkId) {
    if (busy()) return false;
    if (pet.mode === "sleep" || pet.mode === "sit")
      setMode("wake", { startle: true });
    const target = clamp(x, minX(), maxX());
    pet.expr = null;
    if (Math.abs(target - pet.x) < 2) {
      onEvent("arrived", { walkId, x: Math.round(pet.x) });
      return true;
    }
    setMode(run ? "run" : "walk", { target, walkId });
    return true;
  }

  function faceName() {
    const m = pet.mode;
    if (m === "drag") return "dragged";
    if (m === "air" && pet.airKind === "throw")
      return pet.vy < 0 ? "dragged" : "surprised";
    if (m === "air" && pet.airKind === "drop") return "surprised";
    if (m === "dizzy") return pet.modeT < 2.4 ? "dizzy" : "squeeze";
    if (m === "wake") return pet.startle ? "surprised" : "waking";
    if (pet.listening && m !== "sleep") return "listening";
    if (m === "sleep") return "sleep";
    if (pet.expr && T < pet.exprUntil) return pet.expr;
    if (pet.thinking) return "thinking";
    if (m === "sit") return "content";
    if (m === "run") return "run";
    return "neutral";
  }

  function decide() {
    const calm = roam === "calm";
    const opts2 = [
      ["walk", calm ? 10 : 28],
      ["run", calm ? 0 : 12],
      ["look", 14],
      ["jump", calm ? 2 : 8],
      ["sit", 16],
      ["expr", 12],
      ["wait", calm ? 30 : 10],
    ].filter((o) => o[1] > 0 && (o[0] !== pet.lastAct || o[0] === "wait"));
    let r = Math.random() * opts2.reduce((a, o) => a + o[1], 0),
      pick = "wait";
    for (const o of opts2) {
      if ((r -= o[1]) < 0) {
        pick = o[0];
        break;
      }
    }
    if (pick === "look") {
      setMode("look");
      pet.lastAct = "look";
    } else if (pick === "expr") {
      setExpr(
        ["happy", "wink", "love", "sleepy", "surprised", "shy"][
          Math.floor(Math.random() * 6)
        ],
      );
      pet.lastAct = "expr";
    } else if (pick === "sit") {
      setMode("sit", { dur: rnd(6, 9) });
      pet.lastAct = "sit";
    } else if (pick !== "wait") act(pick);
    if (pet.mode === "idle" && T >= pet.nextAt) pet.nextAt = T + rnd(2, 4);
  }

  /* particles */
  function emit(type, p, o = {}) {
    P.push({ type, x: p.x, y: p.y, vx: 0, vy: 0, age: 0, life: 1, ...o });
  }
  function emitHeart() {
    emit(
      "heart",
      toStage(rnd(A.hearts[0], A.hearts[1]), A.hearts[2] + pet.low),
      { vx: rnd(-20, 20), vy: rnd(-70, -45), life: 1.6 },
    );
  }
  function dustAt(lx, n, spread) {
    for (let i = 0; i < n; i++) {
      emit("dust", toStage(lx, 250), {
        vx: rnd(-spread, spread) - pet.facing * rnd(10, 40),
        vy: rnd(-30, -8),
        life: rnd(0.4, 0.65),
      });
    }
  }

  function step(dt) {
    T += dt;
    pet.modeT += dt;
    const m = pet.mode,
      mt = pet.modeT;
    let sqT = 0,
      strideT = 0,
      liftT = 0,
      leanT = 0,
      sitT = 0,
      bobT = 0,
      rate = 0,
      lookT = [0, 0],
      tiltT = 0;
    let tk = 160,
      tc = 12,
      drowseT = 0;
    const free =
      !rejectedReaction && roam !== "off" && T > hold && !opts.dialogOpen?.();

    pet.blinkT -= dt;
    pet.blinkAge += dt;
    if (pet.blinkT <= 0) {
      pet.blinkAge = 0;
      pet.blinkT = Math.random() < 0.2 ? 0.28 : rnd(2.2, 5.2);
    }

    const head = toStage(A.gaze[0], A.gaze[1]);
    const pdx = pointer.x - head.x,
      pdy = pointer.y - head.y,
      pm = Math.hypot(pdx, pdy) || 1;
    const track = () => {
      if (!pointer.inside) {
        if (T > pet.glanceAt) {
          pet.glance = Math.random() < 0.45 ? [0, 0] : [rnd(-3, 5), rnd(-3, 3)];
          pet.glanceAt = T + rnd(1.2, 3);
        }
        return pet.glance;
      }
      const k = Math.min(1, pm / 120);
      return [((pdx * pet.facing) / pm) * 5 * k, (pdy / pm) * 4 * k];
    };

    switch (m) {
      case "idle": {
        lookT = track();
        if (
          !rejectedReaction &&
          pointer.inside &&
          !press &&
          pdx * pet.facing < -50 &&
          pm < 600
        ) {
          pet.turnAcc += dt;
          if (pet.turnAcc > 0.9) {
            pet.facing *= -1;
            pet.turnAcc = 0;
          }
        } else pet.turnAcc = 0;
        if (pet.listening) {
          lookT = [3, -4];
          tiltT = -7;
          leanT = -2;
        }
        if (
          free &&
          !pet.listening &&
          T > pet.nextAt &&
          !(pet.expr && T < pet.exprUntil)
        )
          decide();
        break;
      }
      case "walk":
      case "run": {
        const run = m === "run",
          d = pet.target - pet.x,
          dist = Math.abs(d),
          dir = Math.sign(d) || pet.facing;
        pet.facing = dir;
        const vMax = run ? 250 : 78;
        const vT = Math.min(vMax, run ? dist * 4 + 20 : dist * 3 + 14);
        strideT = run ? 17 : 10;
        liftT = run ? 15 : 8;
        bobT = run ? 7 : 3;
        rate = run ? 4.4 : 2.1;
        leanT = run ? (dist < 50 && pet.speed > 120 ? -6 : 11) : 4;
        if (leanT < 0 && !pet.skid) {
          pet.skid = true;
          sfx.skid();
        }
        const ramp = Math.min(1, mt / (run ? 0.35 : 0.25));
        pet.speed = lerp(pet.speed, vT * smooth(ramp), ease(run ? 6 : 9, dt));
        const travel = dir * Math.min(dist, pet.speed * dt);
        if (opts.walkInPlace) pet.target -= travel;
        else pet.x += travel;
        const k = clamp(pet.speed / vMax, 0, 1);
        strideT *= 0.4 + 0.6 * k;
        liftT *= 0.4 + 0.6 * k;
        pet.phase += Math.PI * 2 * rate * dt * Math.max(0.35, k);
        lookT = [run ? 4 : 3, run ? 1 : 0];
        const half = Math.floor(pet.phase / Math.PI);
        if (half !== pet.lastHalf) {
          sfx.step(run, half & 1);
          if (run && pet.speed > 120) dustAt(128, dist < 50 ? 3 : 1, 20);
        }
        pet.lastHalf = half;
        if (dist < 1.5) {
          pet.speed = 0;
          const id = pet.walkId;
          pet.walkId = 0;
          setMode("idle");
          pet.nextAt = T + rnd(1.2, 3.2);
          if (id) onEvent("arrived", { walkId: id, x: Math.round(pet.x) });
        }
        break;
      }
      case "look": {
        if (!pet.cue) {
          pet.cue = 1;
          sfx.hmm();
        }
        if (mt < 0.9) lookT = [4, -4];
        else if (mt < 1.8) {
          if (!pet.turned) {
            pet.turned = true;
            pet.facing *= -1;
          }
          lookT = [5, 0];
        } else if (mt < 2.6) lookT = [1, 4];
        else {
          setMode("idle");
          pet.nextAt = T + rnd(1, 2.5);
        }
        break;
      }
      case "sit": {
        sitT = 1;
        lookT = track().map((v) => v * (1 - pet.drowse));
        if (pet.listening) {
          lookT = [3, -4];
          tiltT = -7;
        }
        drowseT = clamp(
          (mt - 1.5) / Math.max(1, Math.min(pet.dur, 60) - 1.5),
          0,
          free ? 1 : 0.45,
        );
        if (pet.drowse > 0.5)
          leanT = 7 * pet.drowse * Math.pow(Math.max(0, Math.sin(T * 1.3)), 6);
        if (free && mt > pet.dur) {
          if (Math.random() < 0.6) setMode("sleep", { dur: rnd(8, 12) });
          else {
            setMode("idle");
            pet.sqv -= 1.2;
            pet.nextAt = T + rnd(1.5, 3);
          }
        }
        break;
      }
      case "sleep": {
        sitT = 1;
        drowseT = 1;
        leanT = 5;
        if (free && mt > pet.dur) setMode("wake");
        break;
      }
      case "wake": {
        if (pet.startle) {
          sitT = 0;
          lookT = [3, -2];
          if (mt > 0.9) {
            setMode("idle");
            pet.nextAt = T + rnd(1.5, 3);
          }
        } else {
          sitT = mt < 1.1 ? 1 : 0;
          if (mt > 0.5 && !pet.cue) {
            pet.cue = 1;
            sfx.yawn();
          }
          sqT = mt > 0.5 && mt < 1.3 ? -0.1 : 0;
          leanT = mt < 0.5 ? 5 : mt < 1.2 ? -5 : 0;
          lookT = mt > 1.2 ? track() : [0, 0];
          if (mt > 1.8) {
            setMode("idle");
            pet.nextAt = T + rnd(1, 2);
          }
        }
        break;
      }
      case "crouch": {
        sqT = 0.24;
        sitT = 0.3;
        if (mt > 0.16) {
          pet.vy = -pet.jumpV;
          pet.vx = pet.jumpVx;
          pet.airKind = "jump";
          pet.sqv -= 2.6;
          sfx.jump();
          setMode("air");
        }
        break;
      }
      case "air": {
        pet.vy += 2300 * dt;
        pet.vx *= Math.exp(-dt * 0.4);
        pet.x += pet.vx * dt;
        pet.fy += pet.vy * dt;
        if (pet.x < minX()) {
          pet.x = minX();
          pet.vx = Math.abs(pet.vx) * 0.55;
          pet.sqv += 0.6;
        }
        if (pet.x > maxX()) {
          pet.x = maxX();
          pet.vx = -Math.abs(pet.vx) * 0.55;
          pet.sqv += 0.6;
        }
        if (pet.fy - 250 * S < 0 && pet.vy < 0) {
          pet.fy = 250 * S;
          pet.vy = Math.abs(pet.vy) * 0.3;
        }
        sqT = -Math.min(0.12, Math.abs(pet.vy) / 6000);
        tiltT = clamp(pet.vx * 0.025, -30, 30);
        tk = 70;
        tc = 8;
        if (pet.fy >= floorY && pet.vy > 0) land();
        break;
      }
      case "land": {
        sitT = 0.35 * (1 - smooth(clamp(mt / 0.35, 0, 1)));
        lookT = [2, 2];
        if (mt > 0.4) setMode("idle");
        break;
      }
      case "dizzy": {
        sitT = mt < 2.6 ? 1 : 0;
        if (mt < 2.4 && T > pet.sfxAt) {
          sfx.chirps();
          pet.sfxAt = T + 0.9;
        }
        if (mt >= 2.4 && !pet.cue) {
          pet.cue = 1;
          sfx.shake();
        }
        if (mt < 2.4) tiltT = 8 * Math.sin(T * 4.5) * Math.min(1, mt * 2);
        else if (mt < 3) {
          const k = (mt - 2.4) / 0.6;
          tiltT = 12 * Math.sin(mt * 34) * (1 - k);
        } else {
          setMode("idle");
          pet.sqv -= 1;
          pet.nextAt = T + rnd(1.5, 3);
        }
        break;
      }
      case "drag": {
        pet.dx = lerp(pet.dx, pointer.x, ease(28, dt));
        pet.dy = lerp(
          pet.dy,
          Math.min(pointer.y, floorY - 245 * S),
          ease(28, dt),
        );
        tiltT = clamp(pointer.vx * 0.035, -40, 40);
        tk = 90;
        tc = 5;
        if (Math.abs(pointer.vx) > 500 && T > pet.sfxAt) {
          sfx.squeak();
          pet.sfxAt = T + rnd(0.4, 0.7);
        }
        break;
      }
    }

    if (locomotion) {
      pet.phase = locomotion.phase;
      pet.facing =
        custom?.motionFacing?.(locomotion, T) ??
        (locomotion.state === "climb" ? 1 : locomotion.facing);
      const walking = locomotion.state === "walk";
      strideT = walking ? 10 : locomotion.state === "climb" ? 12 : 0;
      liftT = walking ? 8 : locomotion.state === "climb" ? 15 : 0;
      bobT = walking ? 2 : 0;
      tiltT =
        locomotion.state === "glide"
          ? 18 * locomotion.facing
          : locomotion.state === "held"
            ? locomotion.swing * 0.4
            : 0;
      pet.swing = locomotion.swing;
      leanT = 0;
      sitT = locomotion.state === "land" ? 0.12 : 0;
    }

    // short gestures layered over whatever the body is doing
    if (pet.pulse) {
      const k = (T - pet.pulse.t0) / pet.pulse.dur;
      if (k >= 1) pet.pulse = null;
      else if (pet.pulse.kind === "nod")
        leanT += 9 * Math.abs(Math.sin(k * Math.PI * 2));
      else if (pet.pulse.kind === "shake")
        tiltT += 10 * Math.sin(k * Math.PI * 6) * (1 - k);
      else if (pet.pulse.kind === "spin" && k > 0.5 && !pet.pulse.flipped) {
        pet.pulse.flipped = true;
        pet.facing *= -1;
      } else if (pet.pulse.kind === "spin" && k < 0.5 && !pet.pulse.first) {
        pet.pulse.first = true;
        pet.facing *= -1;
        pet.sqv -= 1;
      }
    }

    const fname = faceName(),
      fc = FACES[fname].f(T, pet);
    if (fc.lookLock || pet.mode === "sleep" || pet.mode === "drag")
      lookT = [0, 0];

    // eye shape changes hide under a quick blink; same-shape changes (ring size) ease
    const sig = fc.eyes.map((e) => e.shape).join();
    if (sig !== pet.eyeSig) {
      if (pet.eyeCur) {
        pet.eyePrev = pet.eyeCur;
        pet.swapAge = 0;
      }
      pet.eyeSig = sig;
      fc.eyes.forEach((e, i) => {
        pet.eyeDims[i] = [e.rx ?? 16, e.ry ?? 16, e.dx || 0, e.dy || 0];
      });
    }
    pet.swapAge += dt;
    pet.eyeCur = fc.eyes.map((e, i) => {
      if (e.shape !== "ring" && e.shape !== "lid") return e;
      const d = pet.eyeDims[i],
        tgt = [e.rx ?? 16, e.ry ?? 16, e.dx || 0, e.dy || 0];
      for (let j = 0; j < 4; j++) d[j] = lerp(d[j], tgt[j], ease(16, dt));
      return { ...e, rx: d[0], ry: d[1], dx: d[2], dy: d[3] };
    });
    pet.blushK = lerp(pet.blushK, fc.blush || 0, ease(6, dt));

    // springs & easing
    pet.sqv += ((sqT - pet.sq) * 280 - pet.sqv * 14) * dt;
    pet.sq = clamp(pet.sq + pet.sqv * dt, -0.35, 0.45);
    pet.tiltV += ((tiltT - pet.tilt) * tk - pet.tiltV * tc) * dt;
    pet.tilt += pet.tiltV * dt;
    pet.lean = lerp(pet.lean, leanT, ease(7, dt));
    pet.sitK = lerp(pet.sitK, sitT, ease(m === "land" ? 18 : 6, dt));
    pet.drowse = lerp(
      pet.drowse,
      drowseT,
      ease(m === "sit" || m === "sleep" ? 1.5 : 6, dt),
    );
    pet.stretch = lerp(
      pet.stretch,
      m === "drag" || locomotion?.state === "held" ? 1 : 0,
      ease(8, dt),
    );
    pet.stride = lerp(pet.stride, strideT, ease(10, dt));
    pet.lift = lerp(pet.lift, liftT, ease(10, dt));
    pet.bob = lerp(pet.bob, bobT, ease(10, dt));
    pet.look[0] = lerp(pet.look[0], lookT[0], ease(9, dt));
    pet.look[1] = lerp(pet.look[1], lookT[1], ease(9, dt));
    pet.gap[0] = lerp(pet.gap[0], fc.gap[0], ease(8, dt));
    pet.gap[1] = lerp(pet.gap[1], fc.gap[1], ease(8, dt));
    // Physical contacts require a stable coordinate scale; articulated directional poses handle the turn.
    // Complete original views own their display basis. Legacy figures still
    // use the original turn squash; their requested direction is unchanged.
    const groupFacing = custom?.groupFacing?.();
    pet.faceVis =
      groupFacing === 1 || groupFacing === -1
        ? groupFacing
        : locomotion
          ? pet.facing
          : lerp(pet.faceVis, pet.facing, ease(15, dt));
    if (m !== "walk" && m !== "run" && !locomotion)
      pet.phase = lerp(
        pet.phase,
        Math.round(pet.phase / Math.PI) * Math.PI,
        ease(6, dt),
      );
    pointer.vx *= Math.exp(-dt * 6);

    // secondary motion for ears/antenna/scarf: lags behind horizontal movement
    const AX = pet.mode === "drag" ? pet.dx : pet.x;
    if (pet.prevA != null)
      pet.velX = lerp(pet.velX, (AX - pet.prevA) / dt, 0.25);
    pet.prevA = AX;
    const swingT = clamp(
      -pet.velX * 0.06 * Math.sign(pet.faceVis || 1),
      -28,
      28,
    );
    pet.swingV += ((swingT - pet.swing) * 110 - pet.swingV * 7) * dt;
    pet.swing = clamp(pet.swing + pet.swingV * dt, -40, 40);
    if (locomotion) pet.swing = locomotion.swing;

    pet.low = pet.sitK * 29 + pet.bob * Math.abs(Math.sin(pet.phase));
    pet.feet.forEach((ft, i) => {
      const hx = HIPS[i][0],
        hy = HIPS[i][1] + pet.low;
      let tx, ty;
      if (locomotion?.state === "held") {
        tx = hx + Math.sin(T * 2 + i) * 2;
        ty = FOOT_Y;
      } else if (locomotion?.state === "glide") {
        tx = hx + (i ? 8 : -6);
        ty = FOOT_Y - 12;
      } else if (m === "drag") {
        tx = hx + 7 * Math.sin(T * 11 + i * 2.2);
        ty = hy + 36;
      } else if (m === "air") {
        tx = hx + (i ? 9 : -9);
        ty = hy + 33;
      } else {
        const ph = pet.phase + i * Math.PI;
        const sx = hx + pet.stride * Math.sin(ph),
          sy = FOOT_Y - pet.lift * Math.max(0, Math.cos(ph));
        tx = lerp(sx, hx + 26, pet.sitK);
        ty = lerp(sy, FOOT_Y, pet.sitK);
      }
      const r = m === "drag" || m === "air" ? 14 : 40;
      ft[0] = lerp(ft[0], tx, ease(r, dt));
      ft[1] = lerp(ft[1], ty, ease(r, dt));
    });

    if (fc.emit && T > pet.emitAt) {
      if (fc.emit === "heart") {
        emitHeart();
        pet.emitAt = T + 0.45;
      }
      if (fc.emit === "z") {
        emit("z", toStage(A.z[0], A.z[1] + pet.low), {
          vx: pet.facing * 16,
          vy: -26,
          life: 2.4,
        });
        pet.emitAt = T + 1.3;
        sfx.snore();
      }
      if (fc.emit === "tear") {
        emit("drop", toStage(A.tear[0] + pet.look[0], A.tear[1] + pet.low), {
          vx: pet.facing * rnd(10, 30),
          vy: -20,
          life: 3,
        });
        pet.emitAt = T + 0.8;
      }
    }
    strokeAcc *= Math.exp(-dt * 1.5);
    petCool -= dt;

    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === "drop") {
        p.vy += 900 * dt;
        if (p.y > floorY) p.age = p.life;
      }
      if (p.type === "dust") p.vx *= Math.exp(-dt * 4);
      if (p.age >= p.life) P.splice(i, 1);
    }
    pet.talkK *= Math.exp(-dt * 12);
    pet._fc = fc;
    pet._fname = fname;
  }

  function land() {
    const impact = pet.vy,
      kind = pet.airKind;
    pet.fy = floorY;
    pet.vy = 0;
    pet.vx = 0;
    pet.sqv += clamp(impact * 0.0024, 0.8, 4.5);
    sfx.land(kind !== "jump" && impact > 1000);
    dustAt(128, impact > 900 ? 7 : 3, 70);
    if (kind === "throw" && impact > 1000) {
      setMode("dizzy");
      onEvent("touch", { kind: "crash" });
      return;
    }
    setMode("land");
    if (kind === "throw") {
      pet.expr = "surprised";
      pet.exprUntil = T + 0.9;
      pet.nextAt = T + 2;
    } else if (kind === "drop") {
      pet.expr = "happy";
      pet.exprUntil = T + 1.6;
      pet.nextAt = T + 2.6;
    } else pet.nextAt = T + rnd(0.8, 2);
  }

  function render() {
    const fc = pet._fc || FACES.neutral.f(0),
      fname = pet._fname || "neutral";
    const drag = pet.mode === "drag";
    const br = Math.sin(T * (pet.mode === "sleep" ? 1.7 : 2.4));
    // Contact IK owns physical weight shift; whole-group breathing would slide planted soles.
    const fixedScale = locomotion || releaseOrigin || custom?.fixedScale;
    const sx = fixedScale
      ? 1
      : (1 + pet.sq * 0.7) * (1 - 0.05 * pet.stretch) * (1 - 0.009 * br);
    const sy = fixedScale
      ? 1
      : (1 - pet.sq) * (1 + 0.09 * pet.stretch) * (1 + 0.016 * br);
    const ax = 128,
      ay = drag ? 36 : 256;
    const manualRegistration = Boolean(
      locomotion || heldAnchor || releaseOrigin || placementHandoff,
    );
    let AX = drag ? pet.dx : pet.x,
      AY = drag ? pet.dy : pet.fy;
    if (fc.shake) AX += Math.sin(T * 60) * 1.4;
    // a custom figure may keep tilt and lean off the whole group and bend its own parts instead
    const kx = S * pet.faceVis * sx,
      ky = S * sy,
      lean = pet.lean * pet.faceVis;
    const renderMode = locomotion?.state ?? pet.mode;
    const rot = locomotion
      ? 0
      : custom?.groupTilt
        ? custom.groupTilt(renderMode, pet.tilt, lean)
        : pet.tilt + lean;
    if (heldAnchor) {
      if (heldAnchor.pickup) {
        const blend = clamp((T - heldAnchor.at) / 0.22, 0, 1);
        const eased = blend * blend * (3 - 2 * blend);
        heldAnchor.x = lerp(heldAnchor.startX, heldAnchor.pickup[0], eased);
        heldAnchor.y = lerp(heldAnchor.startY, heldAnchor.pickup[1], eased);
      }
      const r = (rot * Math.PI) / 180,
        x = (heldAnchor.x - ax) * kx,
        y = (heldAnchor.y - ay) * ky;
      AX = heldAnchor.point.x - x * Math.cos(r) + y * Math.sin(r);
      AY = heldAnchor.point.y - x * Math.sin(r) - y * Math.cos(r);
    } else if (releaseOrigin) {
      const blend = clamp((T - releaseOrigin.at) / 0.24, 0, 1);
      const eased = blend * blend * (3 - 2 * blend);
      AX = lerp(releaseOrigin.x, AX, eased);
      AY = lerp(releaseOrigin.y, AY, eased);
      if (blend >= 1) releaseOrigin = null;
    }
    const placed = handoffLocal();
    if (placed) {
      AX = placed.x;
      AY = placed.y;
    }
    if (rejectedReaction) {
      if (manualRegistration) rejectedReaction.root = { x: f(AX), y: f(AY) };
      else if (rejectedReaction.root) {
        AX = rejectedReaction.root.x;
        AY = rejectedReaction.root.y;
      }
    }
    pet.xf = { AX, AY, ax, ay, kx, ky, rot };
    petG.setAttribute(
      "transform",
      `translate(${f(AX)} ${f(AY)}) rotate(${f(rot)}) scale(${kx.toFixed(4)} ${ky.toFixed(4)}) translate(${-ax} ${-ay})`,
    );

    const legs = pet.feet.map((ft, i) => [
      HIPS[i][0],
      HIPS[i][1] + pet.low,
      ft[0],
      ft[1],
    ]);
    const blink =
      pet.blinkAge < 0.16 ? Math.sin((Math.PI * pet.blinkAge) / 0.16) : 0;
    let eyes = pet.eyeCur || fc.eyes,
      eyeClose = 0;
    if (pet.swapAge < 0.07 && pet.eyePrev) {
      eyes = pet.eyePrev;
      eyeClose = pet.swapAge / 0.07;
    } else if (pet.swapAge < 0.16) eyeClose = 1 - (pet.swapAge - 0.07) / 0.09;
    const face = {
      ...fc,
      eyes,
      gap: pet.gap.map((g) => Math.min(64, g + pet.talkK * 12)),
      blush: pet.blushK,
    };
    const frame = {
      look: pet.look,
      legs,
      low: pet.low,
      t: T,
      blink,
      eyeClose,
      acc: skin,
      swing: pet.swing,
      gait: { phase: pet.phase, stride: pet.stride, lift: pet.lift },
    };
    if (custom)
      custom.draw(petG, face, {
        ...frame,
        face: fname,
        mode: renderMode,
        modeT: pet.modeT,
        talk: pet.talkK,
        drowse: pet.drowse,
        sit: pet.sitK,
        facing: pet.faceVis,
        tilt: pet.tilt,
        lean,
        groupRot: rot,
        worldScale: S,
        gripPoint: heldAnchor ? [heldAnchor.x, heldAnchor.y] : null,
        // Whole cels register to this stable model point; the outer group
        // alone transfers the clicked point to pickup over the grab ease.
        heldPickupPoint: heldAnchor?.pickup ? [...heldAnchor.pickup] : null,
        locomotion,
      });
    else petG.innerHTML = figure(face, frame);

    const footY = drag ? pet.dy + 220 * S * 1.09 : pet.fy;
    const shadow = contactShadow(S, floorY - footY, pet.sq, Boolean(drag));
    shadowEl.setAttribute("cx", f(AX));
    shadowEl.setAttribute("cy", f(floorY - 2));
    shadowEl.setAttribute("rx", f(shadow.rx));
    shadowEl.setAttribute("ry", f(shadow.ry));
    shadowEl.setAttribute("opacity", shadow.opacity.toFixed(3));

    let s = "";
    const sc = S / 0.48;
    // sleep z's take the eye colour, or the custom figure's own colour for them
    const zPaint = custom?.colors?.z
      ? `stroke="${custom.colors.z}"`
      : 'class="eye"';
    for (const p of P) {
      const a = p.age / p.life;
      if (p.type === "z") {
        const op = a < 0.15 ? a / 0.15 : 1 - (a - 0.15) / 0.85,
          z = (0.7 + 0.9 * a) * sc;
        s += `<path ${zPaint} fill="none" stroke-width="${f(3 / z)}" stroke-linecap="round" stroke-linejoin="round" opacity="${f(op)}" transform="translate(${f(p.x + Math.sin(p.age * 2.5) * 6)} ${f(p.y)}) scale(${f(z)})" d="M-6 -7H6L-6 7H6"/>`;
      } else if (p.type === "heart") {
        s += `<path class="p-heart" fill="none" stroke-width="5" stroke-linejoin="round" opacity="${f(1 - a * a)}" transform="translate(${f(p.x + Math.sin(p.age * 4) * 5)} ${f(p.y)}) scale(${f((0.45 + 0.35 * a) * sc)})" d="${heartD(0, 0, 1)}"/>`;
      } else if (p.type === "dust") {
        s += `<circle class="p-dust" fill="none" stroke-width="2" cx="${f(p.x)}" cy="${f(p.y)}" r="${f((3 + 8 * a) * sc)}" opacity="${f(0.7 * (1 - a))}"/>`;
      } else if (p.type === "drop") {
        s += `<path class="tearf" transform="translate(${f(p.x)} ${f(p.y)}) scale(${f(0.9 * sc)})" d="${DROP}"/>`;
      }
    }
    fxG.innerHTML = s;
    return fname;
  }

  /* pointer: stage-pixel coordinates */
  function velocity() {
    const s = pointer.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const a = s[0],
      b = s[s.length - 1],
      dt = Math.max(0.016, (b.t - a.t) / 1000);
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }
  function pointerDown(p) {
    Object.assign(pointer, p, { inside: true });
    if (!hitPet(p) || pet.mode === "air") return false;
    press = { x: p.x, y: p.y, t: performance.now() };
    pointer.samples = [{ t: performance.now(), x: p.x, y: p.y }];
    return true;
  }
  /** Returns the cursor the stage should show. */
  function pointerMove(p) {
    const now = performance.now();
    const ddx = p.x - pointer.x,
      ddy = p.y - pointer.y;
    Object.assign(pointer, p, { inside: true });
    pointer.samples.push({ t: now, x: p.x, y: p.y });
    while (pointer.samples.length > 2 && now - pointer.samples[0].t > 110)
      pointer.samples.shift();
    pointer.vx = lerp(pointer.vx, velocity().x, 0.35);

    if (
      press &&
      pet.mode !== "drag" &&
      Math.hypot(p.x - press.x, p.y - press.y) > 6
    ) {
      const scruff = toStage(128, 36);
      pet.expr = null;
      setMode("drag", { dx: scruff.x, dy: scruff.y });
      sfx.grab();
      pet.sqv -= 1.2;
      pet.tiltV = 0;
      onEvent("touch", { kind: "grab" });
    }
    if (press) return "grabbing";
    const over = hitPet(p);
    if (over && ["idle", "look", "sit", "sleep"].includes(pet.mode)) {
      strokeAcc += Math.hypot(ddx, ddy);
      if (strokeAcc > 320 && petCool <= 0) {
        strokeAcc = 0;
        petCool = 2.5;
        sfx.purr();
        if (pet.mode === "sleep") emitHeart();
        else setExpr(Math.random() < 0.5 ? "love" : "shy");
        onEvent("touch", { kind: "pet", asleep: pet.mode === "sleep" });
      }
    }
    return over ? "grab" : "";
  }
  function pointerUp() {
    if (!press) return;
    if (pet.mode === "drag") {
      // hand over from the scruff anchor to the feet anchor without a visual jump
      const foot = toStage(128, 256);
      const v = velocity();
      pet.x = clamp(foot.x, minX(), maxX());
      pet.fy = Math.min(floorY, foot.y);
      pet.vx = clamp(v.x, -1800, 1800);
      pet.vy = clamp(v.y, -1800, 1400);
      pet.airKind = "throw";
      const speed = Math.hypot(v.x, v.y);
      if (speed > 700) sfx.whoosh();
      setMode("air");
      onEvent("touch", {
        kind: speed > 700 ? "throw" : "drop",
        x: Math.round(pet.x),
      });
    } else if (performance.now() - press.t < 400) {
      if (pet.mode === "sleep" || pet.mode === "sit") {
        const wasAsleep = pet.mode === "sleep";
        setMode("wake", { startle: true });
        pet.sqv -= 2.2;
        pet.nextAt = T + 2.4;
        sfx.surprised();
        onEvent("touch", { kind: "poke", woke: wasAsleep });
      } else if (pet.mode !== "dizzy") {
        sfx.poke();
        const r = ["happy", "wink", "surprised", "love", "angry"][
          Math.floor(Math.random() * 5)
        ];
        setExpr(r);
        if (Math.random() < 0.5 && pet.mode === "idle")
          setMode("crouch", { jumpV: 480, jumpVx: 0 });
        onEvent("touch", { kind: "poke" });
      }
    }
    press = null;
  }
  function pointerLeave() {
    if (!press) pointer.inside = false;
  }

  // A new authored reaction replaces the old one, including airborne or seated poses.
  // Callers never mutate simulation state to force an editor preview through busy().
  function replaceReaction(motion, expression, holdExpression = false) {
    rejectedReaction = null;
    custom?.acceptReactionPlayback?.();
    setMode("idle");
    pet.fy = floorY;
    pet.vx = pet.vy = pet.speed = 0;
    pet.pulse = null;
    pet.expr = null;
    pet.sitK = pet.low = pet.stride = pet.lift = pet.bob = 0;
    pet.feet = STAND.map((leg) => [leg[2], leg[3]]);
    P.length = 0;
    if (motion) act(motion);
    pet.expr = expression || "neutral";
    pet.exprUntil = holdExpression ? Infinity : T + 2;
  }

  // A refused authored request never enters legacy physics. Its figure owns
  // retained pixels; the core owns only the last actually installed root.
  function replaceRejectedReaction(motion, expression, holdExpression, code) {
    const root = pet.xf ? { x: f(pet.xf.AX), y: f(pet.xf.AY) } : null;
    setMode("idle");
    pet.fy = floorY;
    pet.vx = pet.vy = pet.speed = 0;
    pet.pulse = null;
    P.length = 0;
    rejectedReaction = { motion, code, root };
    custom?.rejectReactionPlayback?.(code);
    pet.expr = expression || "neutral";
    pet.exprUntil = holdExpression ? Infinity : T + 2;
  }

  resize();
  return {
    pet,
    step,
    render,
    resize,
    act,
    replaceReaction,
    replaceRejectedReaction,
    getReactionFailure() {
      return rejectedReaction?.code ?? null;
    },
    placementDelta() {
      return heldAnchor && pet.xf
        ? { x: pet.xf.AX - pet.x, y: pet.xf.AY - floorY }
        : { x: 0, y: 0 };
    },
    beginPlacementHandoff,
    commitPlacementHandoff,
    cancelPlacementHandoff,
    setLocomotion,
    setExpr,
    walkTo,
    toStage,
    hitPet,
    busy,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerLeave,
    get pressing() {
      return !!press;
    },
    get time() {
      return T;
    },
    get bounds() {
      return { W, H, floorY, S, minX: minX(), maxX: maxX() };
    },
    setSkin(s) {
      skin = s;
    },
    /** Swaps the body's drawing: a custom figure (see `opts.figure`) or null for the built-in Coo. */
    setFigure(fig) {
      if (fig === custom) return;
      custom = fig || null;
      A = { ...COO_ANCHORS, ...custom?.anchors };
      petG.textContent = "";
      render();
    },
    get figure() {
      return custom;
    },
    get skin() {
      return skin;
    },
    setRoam(r) {
      roam = r;
      if (r !== "off") pet.nextAt = T + 1;
    },
    get roam() {
      return roam;
    },
    /** Outside orders keep free roaming quiet for `seconds`. */
    holdRoam(seconds) {
      hold = Math.max(hold, T + seconds);
    },
    talk() {
      pet.talkK = 1;
    },
    setListening(on) {
      pet.listening = on;
      if (on && (pet.mode === "walk" || pet.mode === "run")) setMode("idle");
    },
    setThinking(on) {
      pet.thinking = on;
    },
    /** Head top in stage pixels, for placing a speech bubble. */
    anchor() {
      return toStage(
        A.bubble[0],
        (custom ? A.bubble[1] : (HEAD_TOP[skin.head] ?? 12) - 8) + pet.low,
      );
    },
    emitHeart,
  };
}
