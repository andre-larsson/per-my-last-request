import { TILES, LEVELS } from './game.js';
import { TILE_ART, artUrl } from './view.js';

// Map labels use full names, wrapped onto at most two lines, so a stop never needs decoding.
const LABELS = [['Camp'], ['Practice', 'rat'], ['Noticeboard'], ['Tin boar'], ['Prize', 'purse'], ['Prize', 'bruiser'], ['Field', 'medic'], ['Quickfoot'], ['Armorer'], ['Bench'], ['Champion'], ['Home', 'stretch']];
const GLYPH = { camp: '⌂', enemy: '⚔', medic: '+', shop: '⚒', purse: '¤', bench: '≡', road: '·' };

const loop = (x0, y0, x1, y1, r) => `M${x0 + r} ${y0}H${x1 - r}Q${x1} ${y0} ${x1} ${y0 + r}V${y1 - r}Q${x1} ${y1} ${x1 - r} ${y1}H${x0 + r}Q${x0} ${y1} ${x0} ${y1 - r}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}Z`;

// Wide layout: camp on the left, five stops along the top, the medic on the right, five along the bottom.
const WIDE = {
  w: 640, h: 312, box: [64, 88, 576, 236, 70], title: [320, 168], side: {},
  pos: [[64, 162], [118, 88], [219, 88], [320, 88], [421, 88], [522, 88], [576, 162], [522, 236], [421, 236], [320, 236], [219, 236], [118, 236]],
};
// Tall layout for narrow screens: the same loop turned on its side, so labels stay full size.
// Stops on the two long sides carry their labels inside the loop, clear of the hero marker.
const TALL = {
  w: 360, h: 476, box: [56, 84, 304, 412, 56], title: [180, 258], side: { 0: 'right', 11: 'right', 5: 'left', 6: 'left' },
  pos: [[56, 212], [56, 84], [139, 84], [221, 84], [304, 84], [304, 212], [304, 312], [304, 412], [221, 412], [139, 412], [56, 412], [56, 312]],
};
const WIDE_TUTORIAL = { w: 640, h: 312, box: [110, 88, 530, 236, 70], title: [290, 168], side: {}, pos: { 0: [110, 162], 1: [430, 88], 11: [430, 236] } };
const TALL_TUTORIAL = { w: 360, h: 300, box: [56, 88, 304, 232, 56], title: null, side: {}, pos: { 0: [56, 160], 1: [240, 88], 11: [240, 232] } };

/** The loop's rounded rectangle as closely spaced points, clockwise from the top edge, so stops can be spaced along it. */
function loopPoints([x0, y0, x1, y1, r]) {
  const points = [];
  const line = (ax, ay, bx, by) => { for (let i = 0; i < 240; i++) points.push([ax + (bx - ax) * i / 240, ay + (by - ay) * i / 240]); };
  const curve = (ax, ay, cx, cy, bx, by) => { for (let i = 0; i < 120; i++) { const t = i / 120, u = 1 - t; points.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]); } };
  line(x0 + r, y0, x1 - r, y0); curve(x1 - r, y0, x1, y0, x1, y0 + r);
  line(x1, y0 + r, x1, y1 - r); curve(x1, y1 - r, x1, y1, x1 - r, y1);
  line(x1 - r, y1, x0 + r, y1); curve(x0 + r, y1, x0, y1, x0, y1 - r);
  line(x0, y1 - r, x0, y0 + r); curve(x0, y0 + r, x0, y0, x0 + r, y0);
  return points;
}
/**
 * A layout for an assignment that visits only some stops: the same loop, camp on the left side, and the
 * other stops spaced evenly along the loop, clockwise. On narrow screens, stops on the long sides carry their labels
 * inside the loop, as in the full circuit.
 */
function spreadLayout(course, compact) {
  const base = compact ? { w: 360, h: course.length <= 5 ? 392 : 516, box: course.length <= 5 ? [56, 88, 304, 316, 56] : [56, 84, 304, 452, 56], title: null } : { w: WIDE.w, h: WIDE.h, box: WIDE.box, title: WIDE.title };
  const [x0, y0, x1, y1] = base.box;
  const points = loopPoints(base.box);
  const lengths = [0];
  for (let i = 1; i <= points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...[0, 1].map(k => points[i % points.length][k] - points[i - 1][k])));
  const total = lengths.at(-1);
  // Camp sits at the middle of the left side, or a little above it on a tall loop with many stops, so that the first
  // stop lands on the top corner and its label stays clear of the second stop's.
  const mid = y0 + (y1 - y0) * (compact && course.length > 5 ? 0.4 : 0.5);
  const start = points.reduce((best, [x, y], i) => Math.hypot(x - x0, y - mid) < Math.hypot(points[best][0] - x0, points[best][1] - mid) ? i : best, 0);
  const pos = {};
  const side = {};
  course.forEach((tile, n) => {
    const target = (lengths[start] + n * total / course.length) % total;
    const i = lengths.findIndex(length => length >= target) % points.length;
    const [x, y] = points[i].map(Math.round);
    pos[tile] = [x, y];
    if (compact && Math.abs(x - x0) <= 10) side[tile] = 'right';
    if (compact && Math.abs(x - x1) <= 10) side[tile] = 'left';
  });
  return { ...base, side, pos };
}
const spread = new Map();
export function mapLayout(level, compact) {
  if (level === 'tutorial') return compact ? TALL_TUTORIAL : WIDE_TUTORIAL;
  const course = (LEVELS[level] || LEVELS.circuit).course;
  if (course.length === TILES.length) return compact ? TALL : WIDE;
  const key = `${level}:${compact}`;
  if (!spread.has(key)) spread.set(key, spreadLayout(course, compact));
  return spread.get(key);
}

/**
 * Draws the circuit. `from` is the stop the hero just left; when given, the marker walks from there.
 * Returns the SVG body and its viewBox, so the caller can size the element.
 */
export function renderMap(s, { compact = false, from = null } = {}) {
  const layout = mapLayout(s.level, compact);
  const route = loop(...layout.box);
  const retreated = new Set(s.log.filter(e => e.action === 'retreat').map(e => e.at));
  const nodes = TILES.map((tile, i) => {
    const at = layout.pos[i];
    if (!at) return '';
    const [x, y] = at;
    const active = i === s.position;
    const cleared = (tile.stamp && s.stamps.includes(tile.stamp)) || (tile.boss && s.champion);
    const goal = Boolean(tile.stamp || tile.boss);
    const r = active ? 25 : 21;
    const state = active ? 'active' : cleared ? 'cleared' : goal ? 'goal' : 'plain';
    const badge = cleared ? `<g class="node-badge done"><circle cx="${x + 17}" cy="${y - 17}" r="9"/><path d="M${x + 12.5} ${y - 17}l3.2 3.4 5.6-6.4"/></g>`
      : goal && retreated.has(tile.name) && !active ? `<g class="node-badge missed"><circle cx="${x + 17}" cy="${y - 17}" r="9"/><path d="M${x + 13.5} ${y - 20.5}l7 7m0-7l-7 7"/></g>` : '';
    const side = layout.side[i];
    const lines = LABELS[i];
    const lx = side === 'right' ? x + 36 : side === 'left' ? x - 36 : x;
    const ly = side ? y + 5 - (lines.length - 1) * 7 : y + r + 19;
    const label = `<text class="map-label" x="${lx}" y="${ly}" text-anchor="${side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle'}">${lines.map((line, n) => `<tspan x="${lx}" dy="${n ? 14 : 0}">${line}</tspan>`).join('')}</text>`;
    return `<g class="node ${state}"><circle class="node-ring" cx="${x}" cy="${y}" r="${r + 5}"/><circle class="node-disc" cx="${x}" cy="${y}" r="${r}"/><text class="node-glyph" x="${x}" y="${y + 7}" text-anchor="middle">${GLYPH[tile.kind]}</text><clipPath id="clip-${i}"><circle cx="${x}" cy="${y}" r="${r - 2}"/></clipPath><image href="${artUrl(TILE_ART[i])}" x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#clip-${i})" preserveAspectRatio="xMidYMid slice"/>${badge}${label}</g>`;
  }).join('');
  const [hx, hy] = layout.pos[s.position];
  const [fx, fy] = (from !== null && layout.pos[from]) || [hx, hy];
  const moving = fx !== hx || fy !== hy;
  const pin = `<g class="hero-pin${moving ? ' moving' : ''}" style="--x:${hx}px;--y:${hy}px;--fx:${fx}px;--fy:${fy}px" aria-hidden="true"><path d="M0 -30c-13 0-21 -9-21 -20a21 21 0 0 1 42 0c0 11-8 20-21 20z" class="pin-body"/><path d="M-7 -33L0 -22 7 -33z" class="pin-body"/><clipPath id="clip-hero"><circle cx="0" cy="-51" r="16"/></clipPath><circle cx="0" cy="-51" r="16" class="pin-face"/><image href="${artUrl('hero')}" x="-16" y="-67" width="32" height="32" clip-path="url(#clip-hero)" preserveAspectRatio="xMidYMin slice"/></g>`;
  let title = '';
  if (layout.title) {
    const [tx, ty] = layout.title;
    title = `<text class="map-title" x="${tx}" y="${ty}" text-anchor="middle">THE GUILD GROUNDS</text>` + (s.lap > 1
      ? `<text class="map-lap" x="${tx}" y="${ty + 22}" text-anchor="middle">LAP ${s.lap} · OPPONENTS +${(s.lap - 1) * 3} HP, +${s.lap - 1} DAMAGE</text>`
      : `<text class="map-small" x="${tx}" y="${ty + 20}" text-anchor="middle">EST. LAST TUESDAY</text>`);
  }
  const body = `<defs><pattern id="grain" width="18" height="18" patternUnits="userSpaceOnUse"><circle class="map-grain" cx="4" cy="6" r=".8"/><circle class="map-grain" cx="13" cy="15" r=".7"/></pattern></defs><rect width="${layout.w}" height="${layout.h}" fill="url(#grain)"/><path d="${route}" class="route-edge"/><path d="${route}" class="route-bed"/><path d="${route}" class="route-line"/>${title}${nodes}${pin}`;
  return { body, viewBox: `0 0 ${layout.w} ${layout.h}` };
}
