/* 野怪收益曲线验算（缺口 U5）——《逆尘》野外刷怪的可行性逐区对表
 *
 * 用法：node tools/zone-curve.js [--json]
 *
 * 回答三个问题（HANDOVER §6.4 / 闭环报告 U5）：
 *   ① **覆盖**：gl 1–171 逐级看，哪几段**根本没有野外遭遇带**？
 *   ② **场次**：站在某区的遭遇带里刷，一个境界（9 段 + 1 次大突破）要刷多少场？
 *   ③ **预算**：这些场次换算成年岁，塞得进该境界的寿元预算吗？
 *
 * 口径（对齐《经济数值表 v0.2》§4 / §6）：
 *   · 基准档 = 五行三灵根（灵气系数 1.0、无天赋/出身/仙力加成）
 *   · 灵气/场 = 80 × L × 灵根系数 × (1+灵气加成) × 境界差 × 双只组系数
 *     —— `battle.js: _victory` 的野外分支，**逐只结算再合计**
 *   · 破境需求 = 100 × 门槛系数 × 段数² × 新手境校准（`player.js: needQi`）
 *   · 境界差（gl − L > 5 → ×0.5）按"玩家站在该带内"取 1
 *
 * ⚠️ 本工具**只读**，不改任何数据；结论用来判断 `zones.enc` 该不该调。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');
const AS_JSON = process.argv.indexOf('--json') >= 0;

/* ---------- 无头沙箱（与其它 tools 同构）---------- */
function makeGradient() { return { addColorStop() {} }; }
function makeCtx() {
  const noop = () => {};
  return {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    globalCompositeOperation: 'source-over', lineJoin: 'miter', lineCap: 'butt',
    shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
    setTransform: noop, transform: noop, resetTransform: noop, clip: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, rect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop,
    measureText: (s) => ({ width: String(s).length * 7 }),
    createLinearGradient: makeGradient, createRadialGradient: makeGradient,
    createPattern: () => null,
    drawImage: function (img) {
      if (!img) throw new Error('drawImage(null)');
      if (!img.width || !img.height) throw new Error('drawImage 源尺寸为 0');
    },
    putImageData: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) })
  };
}
function makeCanvas(w, h) {
  const c = {
    width: w || 300, height: h || 150, style: {},
    getContext() { if (!c._ctx) { c._ctx = makeCtx(); c._ctx.canvas = c; } return c._ctx; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: c.width, height: c.height }; }
  };
  return c;
}

const gameCanvas = makeCanvas(480, 272);
let rafQueue = [];
const sandbox = {
  console,
  document: {
    createElement(tag) { return tag === 'canvas' ? makeCanvas(1, 1) : { style: {}, appendChild() {}, addEventListener() {} }; },
    getElementById(id) { return id === 'game' ? gameCanvas : null; },
    addEventListener() {}
  },
  window: null,
  performance: { now: () => Date.now() },
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('offline')),
  Image: class { constructor() { this.width = 1; this.height = 1; } },
  localStorage: (() => {
    const m = {};
    return {
      getItem: (k) => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: (k) => { delete m[k]; },
      clear: () => { for (const k in m) delete m[k]; }
    };
  })(),
  navigator: { userAgent: 'node' },
  devicePixelRatio: 2
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1280;
sandbox.window.innerHeight = 720;
sandbox.window.devicePixelRatio = 2;
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
for (const rel of srcs) {
  vm.runInContext(fs.readFileSync(path.join(WWW, rel), 'utf8'), sandbox, { filename: rel });
}
const G = sandbox.G;
const P = G.Player;

/* 时钟钉死：本工具不依赖时间，但钉住可让输出完全可复现（见 HANDOVER §5.9） */
vm.runInContext('Date.now = function () { return 1774512000000; };', sandbox);

/* ---------- 基准档 ---------- */
const BASE_LG_COEF = 1.0;
function baseSave(gl) {
  return {
    globalLevel: gl || 1, qi: 0, po: 0, stone: 0,
    linggen: { kind: '五行三', elems: ['木', '火', '土'], coef: { 木: 1.0, 火: 1.0, 土: 1.0 }, stoneBonus: 0 },
    talents: [], originFx: {}, bonus: {}, items: {}, world: { traits: [] }
  };
}
/* 灵气/场（含双只组） */
function qiPerBattle(enc, pair) {
  const save = baseSave();
  const r = P.rates(save);
  const L = (enc.min + enc.max) / 2;
  return 80 * L * BASE_LG_COEF * (1 + (r.qi || 0)) * 1 * (1 + (pair || 0) / 100)
    * P.realmQiCoef(L);
}

/* ---------- ① 收集全部遭遇带 ---------- */
/* 手写地图（凡界 F1–F3 复用 town/field/cave）+ 生成型区域（regions.js） */
const bands = [];
['town', 'field', 'cave'].forEach((mid) => {
  const md = G.Data.maps[mid];
  if (!md || !md.zones) return;
  const rid = G.Data.regions.regionIdOf(mid) || mid;
  const rn = (G.Data.regions.byId(rid) || {}).n || mid;
  md.zones.forEach((z) => bands.push({
    region: rid, regionName: rn, scene: mid, zone: z.id,
    enc: z.enc, pair: z.pair || 0, hand: true
  }));
});
['fan', 'ling', 'xian', 'dao'].forEach((w) => {
  G.Data.regions.of(w).forEach((r) => {
    (r.zones || []).forEach((z) => bands.push({
      region: r.id, regionName: r.n, scene: r.map || r.id, zone: z.id,
      enc: z.enc, pair: z.pair || 0, hand: !!r.map
    }));
  });
});
bands.sort((a, b) => a.enc.min - b.enc.min || a.enc.max - b.enc.max);

/* ---------- ② 覆盖检查：gl 1–171 ---------- */
const MAX_GL = P.MAX_GL;
const covered = new Array(MAX_GL + 2).fill(false);
bands.forEach((b) => {
  for (let gl = b.enc.min; gl <= b.enc.max; gl++) if (gl <= MAX_GL) covered[gl] = true;
});
const gaps = [];
for (let gl = 1; gl <= MAX_GL; gl++) {
  if (covered[gl]) continue;
  if (gaps.length && gaps[gaps.length - 1].to === gl - 1) gaps[gaps.length - 1].to = gl;
  else gaps.push({ from: gl, to: gl });
}

/* ---------- ③ 逐境场次验算 ---------- */
/* 覆盖某境的带：与该境 gl 区间有交集 */
function bandsForRealm(t) {
  return bands.filter((b) => b.enc.max >= t.y0 && b.enc.min <= t.y1);
}
const realmRows = [];
P.REALMS.forEach((t) => {
  const bs = bandsForRealm(t);
  /* 该境全量需求：9 段小突破 + 1 次大突破（大突破同样按 stage 9 的 needQi） */
  let need = 0;
  for (let s = 1; s <= 9; s++) need += P.needQi(baseSave(t.y0 + s - 1), t.y0 + s - 1);
  /* 最优带 = 每场灵气最高者 */
  let best = null;
  bs.forEach((b) => {
    const q = qiPerBattle(b.enc, b.pair);
    if (!best || q > best.q) best = { band: b, q: q };
  });
  const n = best ? need / best.q : null;
  /* 年岁：每 10 场 +1 岁，每次突破 +2 岁（9 次） */
  const years = best ? n / P.AGE_PER_BATTLE + 9 * P.AGE_PER_BREAK : null;
  const prev = P.REALMS[P.REALMS.indexOf(t) - 1];
  const budget = P.lifespanOf(t.y0) - (prev ? P.lifespanOf(prev.y0) : 16);   /* 入世 16 岁 */
  realmRows.push({
    realm: t.n, y0: t.y0, y1: t.y1, gate: t.gate, need: need,
    bandCount: bs.length, best: best, battles: n, years: years, budget: budget,
    dao: P.isDaoRealm(t.y0)
  });
});

/* ---------- 输出 ---------- */
const out = [];
function w(s) { out.push(s); }
function pad(s, n) { s = String(s); let w2 = 0; for (const ch of s) w2 += /[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w2)); }
function num(v, d) { return v == null || !isFinite(v) ? '—' : (Math.round(v * (d == null ? 1 : Math.pow(10, d))) / Math.pow(10, d == null ? 0 : d)).toLocaleString('en-US'); }

w('野怪收益曲线验算（缺口 U5）');
w('口径：五行三灵根（灵气系数 1.0、无加成）；灵气/场 已含双只组期望与境界系数');
w('');

w('【① 遭遇带一览】共 ' + bands.length + ' 条');
w('  ' + pad('区域', 12) + pad('段', 8) + pad('enc', 12) + pad('双只', 6) + pad('灵气/场', 10) + '对应境界');
bands.forEach((b) => {
  const ri = P.realmInfo(b.enc.min), rj = P.realmInfo(b.enc.max);
  const span = ri.realm === rj.realm ? ri.realm : ri.realm + '–' + rj.realm;
  w('  ' + pad(b.regionName, 12) + pad(b.zone, 8)
    + pad(b.enc.min + '–' + b.enc.max, 12)
    + pad(b.pair + '%', 6)
    + pad(num(qiPerBattle(b.enc, b.pair)), 10)
    + span);
});
w('');

w('【② 覆盖缺口】gl 1–' + MAX_GL + ' 中没有任何野外遭遇带的区间');
if (!gaps.length) w('  无 —— 全境界都有野外可刷。');
else gaps.forEach((g) => {
  const t0 = P.realmInfo(g.from), t1 = P.realmInfo(g.to);
  w('  ⚠ gl ' + g.from + '–' + g.to + '（' + t0.n + ' → ' + t1.n + '，共 ' + (g.to - g.from + 1) + ' 级）'
    + '　所属界：' + worldOf(g.from));
});
w('');

w('【③ 逐境场次验算】一个境界 = 9 段小突破 + 1 次大突破（大突破另需突破丹）');
w('  ' + pad('境界', 12) + pad('gl', 10) + pad('全境灵气', 16) + pad('最优区域', 12) + pad('场次', 10) + pad('年岁', 8) + '寿元预算');
realmRows.forEach((r) => {
  if (r.dao) {
    w('  ' + pad(r.realm, 12) + pad(r.y0 + '–' + r.y1, 10) + pad(num(r.need), 16)
      + pad(r.best ? r.best.band.regionName : '（无）', 12) + pad('—', 10) + pad('—', 8)
      + '道界无破境（唯道则回廊）');
    return;
  }
  w('  ' + pad(r.realm, 12) + pad(r.y0 + '–' + r.y1, 10) + pad(num(r.need), 16)
    + pad(r.best ? r.best.band.regionName : '（无）', 12)
    + pad(num(r.battles), 10) + pad(num(r.years), 8)
    + (isFinite(r.budget) ? num(r.budget) + ' 岁' : '—'));
});
w('');
function worldOf(gl) {
  const w2 = P.worldOfGL(gl);
  return (G.Data.regions.worldNames[w2.id] || w2.n);
}

/* ---------- 告警 ---------- */
const warns = [];
if (gaps.length) {
  gaps.forEach((g) => {
    if (g.from === 1) return;                       /* 淬体一段无遭遇带 = 教学开局，正常 */
    /* 道界（gl ≥ 145）不要求野外带：**道界无破境之说**，进境与道晶都来自「道则回廊」九关，
       野外刷怪只是补充。所以只在三界（gl ≤ 144）缺带时告警。 */
    if (g.from >= 145) return;
    warns.push('gl ' + g.from + '–' + g.to + ' 无野外遭遇带（' + worldOf(g.from) + '）');
  });
}
realmRows.forEach((r) => {
  if (r.dao || !r.best) return;
  if (r.battles > 200) warns.push(r.realm + ' 需刷 ' + num(r.battles) + ' 场（>200，野外路线过慢）');
  if (isFinite(r.budget) && r.years > r.budget) {
    warns.push(r.realm + ' 需 ' + num(r.years) + ' 岁 > 寿元预算 ' + num(r.budget) + ' 岁（刷不完就坐化）');
  }
});

if (AS_JSON) {
  console.log(JSON.stringify({
    bands: bands.length,
    gaps: gaps,
    realms: realmRows.map((r) => ({
      realm: r.realm, y0: r.y0, y1: r.y1, gate: r.gate, need: r.need,
      bestRegion: r.best ? r.best.band.regionName : null,
      qiPer: r.best ? r.best.q : null,
      battles: r.battles, years: r.years, budget: r.budget, dao: r.dao
    })),
    warnings: warns
  }, null, 2));
  process.exit(0);
}

w('【告警】' + (warns.length ? warns.length + ' 条' : '无'));
warns.forEach((s) => w('  ⚠ ' + s));
w('');

console.log(out.join('\n'));
