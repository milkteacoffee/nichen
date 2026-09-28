/* 新境界模型（36 阶/境，共 684）代码自检探针 —— 独立于 smoke 的旧断言。
   用法：node tools/probe-newmodel.js
   校验：境界称谓 / scaleLevel / realmPos / needQi 每境总量 / 寿元 / breakState /
         心魔物种 / 副本锚点 / 野外遭遇带覆盖（四界内无空洞）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WWW = path.join(__dirname, '..', 'www');

function makeGradient() { return { addColorStop() {} }; }
function makeCtx() {
  const noop = () => {};
  return {
    canvas: null, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'top', globalAlpha: 1, globalCompositeOperation: 'source-over',
    lineJoin: 'miter', lineCap: 'butt', shadowColor: '#000', shadowBlur: 0,
    shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop,
    transform: noop, resetTransform: noop, clip: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop, arc: noop,
    arcTo: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop, fillRect: noop,
    strokeRect: noop, clearRect: noop, fillText: noop, strokeText: noop,
    measureText: (s) => ({ width: String(s).length * 7 }),
    createLinearGradient: makeGradient, createRadialGradient: makeGradient,
    createPattern: () => null, drawImage: noop, putImageData: noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), setLineDash: noop
  };
}
function makeCanvas(w, h) {
  const c = { width: w || 300, height: h || 150, style: {},
    getContext() { if (!c._ctx) { c._ctx = makeCtx(); c._ctx.canvas = c; } return c._ctx; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: c.width, height: c.height }; } };
  return c;
}
const gameCanvas = makeCanvas(480, 272);
const doc = {
  createElement: (t) => (t === 'canvas' ? makeCanvas(1, 1) : { style: {}, appendChild() {}, addEventListener() {} }),
  getElementById: (id) => (id === 'game' ? gameCanvas : null), addEventListener() {}
};
const rafQueue = [];
const sandbox = {
  console, document: doc, window: null, performance: { now: () => Date.now() },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('offline')),
  Image: class { constructor() { this.width = 1; this.height = 1; } },
  localStorage: (() => { const m = {}; return {
    getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }, clear: () => { for (const k in m) delete m[k]; } }; })(),
  navigator: { userAgent: 'node' }, devicePixelRatio: 2
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1280; sandbox.window.innerHeight = 720;
sandbox.window.devicePixelRatio = 2;
sandbox.window.addEventListener = () => {}; sandbox.window.removeEventListener = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext('this.Math = Math;', sandbox);

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
for (const rel of srcs) {
  vm.runInContext(fs.readFileSync(path.join(WWW, rel), 'utf8'), sandbox, { filename: rel });
}
const G = sandbox.G, P = G.Player, D = G.Data.dungeons;
let fail = 0;
function ck(name, cond, extra) {
  if (cond) { console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? '  -> ' + extra : '')); }
};
function eq(name, got, want) { ck(name, got === want, 'got ' + got + ' want ' + want); }
function approx(name, got, want, tol) { ck(name, Math.abs(got - want) <= (tol || 1), 'got ' + got + ' want ~' + want); }

console.log('A. 境界称谓 stageName');
[
  [1, '淬体一重初期'], [4, '淬体一重巅峰'], [5, '淬体二重初期'], [36, '淬体九重巅峰'],
  [37, '炼气一重初期'], [72, '炼气九重巅峰'], [73, '筑基一重初期'], [252, '炼虚九重巅峰'],
  [253, '合体一重初期'], [360, '渡劫九重巅峰'], [361, '人仙一重初期'], [576, '大罗金仙九重巅峰'],
  [577, '准圣一重初期'], [684, '道祖九重巅峰']
].forEach((c) => eq('gl' + c[0] + ' = ' + c[1], P.realmInfo(c[0]).n, c[1]));

console.log('B. scaleLevel (压缩阶 1..171)');
[[1,1],[36,9],[37,10],[72,18],[73,19],[252,63],[253,64],[684,171]].forEach((c) =>
  eq('scaleLevel(' + c[0] + ')', P.scaleLevel(c[0]), c[1]));

console.log('C. realmPos');
(function () {
  let a = P.realmPos(37);
  ck('gl37 r1 stage1 chong1 phase0', a.r === 1 && a.stage === 1 && a.chong === 1 && a.phase === 0,
    JSON.stringify(a));
  a = P.realmPos(40);
  ck('gl40 r1 stage4 chong1 phase3', a.r === 1 && a.stage === 4 && a.chong === 1 && a.phase === 3,
    JSON.stringify(a));
  a = P.realmPos(41);
  ck('gl41 r1 stage5 chong2 phase0', a.r === 1 && a.stage === 5 && a.chong === 2 && a.phase === 0,
    JSON.stringify(a));
})();

console.log('D. needQi 每大境总量（与旧 285 基准等价）');
const emptySave = { talents: [], origin: null, bonus: {}, world: null, skills: {} };
function realmSum(r) {
  let t = 0; for (let s = 1; s <= 36; s++) t += P.needQi(emptySave, r * 36 + s); return Math.round(t);
}
approx('淬体总量 ≈ 11400', realmSum(0), 11400, 2);
approx('炼气总量 ≈ 57000', realmSum(1), 57000, 40);
approx('筑基总量 ≈ 114000', realmSum(2), 114000, 80);

console.log('E. 寿元 lifespanOf');
[
  [1,100],[37,150],[73,200],[109,300],[145,500],[181,800],[217,1000],[253,1500],
  [289,2000],[325,3000],[361,5000],[397,8000],[433,12000],[469,20000],[505,30000],
  [541,50000],[577,100000],[613,200000],[649,Infinity]
].forEach((c) => eq('gl' + c[0] + ' 寿元 ' + c[1], P.lifespanOf(c[0]), c[1]));

console.log('F. breakState');
(function () {
  let sv = { globalLevel: 36, qi: 999999, items: { 淬体突破丹: 1 } };
  let b = P.breakState(sv);
  ck('gl36 持丹灵气足 = big&ready', b.big === true && b.ready === true, JSON.stringify(b));
  sv = { globalLevel: 35, qi: 999999, items: {} };
  b = P.breakState(sv);
  ck('gl35 非 big', b.big === false, JSON.stringify(b));
  sv = { globalLevel: 252, qi: 999999, items: {} };
  b = P.breakState(sv);
  ck('gl252 凡界顶 = worldcap', b.worldcap === true && b.ready === false, JSON.stringify(b));
  sv = { globalLevel: 577, qi: 999999, items: {} };
  b = P.breakState(sv);
  ck('gl577 道界 = daoRealm&!ready', b.daoRealm === true && b.ready === false, JSON.stringify(b));
})();

console.log('G. 心魔（快照）/ 狼王');
(function () {
  const snap = { level: 36, maxhp: 300, atk: 30, def: 14, spd: 16 };
  const hd = G.Data.makeHeartDemon2(snap);
  ck('心魔 level36 名为心魔', hd.name === '心魔' && hd.level === 36 && hd.species === '心魔',
    JSON.stringify({ n: hd.name, l: hd.level, sp: hd.species }));
  const wk = G.Data.makeWolfKing();
  ck('赤炎狼王 level36 有3技能', wk.name === '赤炎狼王' && wk.level === 36 && wk.skills.length === 3,
    wk.name + ' skills=' + wk.skills.length);
})();

console.log('H. 副本锚点');
(function () {
  const fan = [0,1,2,3,4].map((i) => D.anchorGL('fan', i));
  ck('fan 锚点 [36,108,180,216,252]', fan.join() === '36,108,180,216,252', fan.join());
  ck('DAO_ENTER_GL=577', D.DAO_ENTER_GL === 577, String(D.DAO_ENTER_GL));
  ck('道界九关 [588..684]', D.DAO_TRIALS.map((t) => t.gl).join() ===
    '588,600,612,624,636,648,660,672,684', D.DAO_TRIALS.map((t) => t.gl).join());
})();

console.log('I. 野外遭遇带覆盖（四界内无空洞）');
(function () {
  /* 从 regions 数据收集 enc 区间 */
  const bands = [];
  G.Data.regions.all().forEach(function (rg) {
    (rg.zones || []).forEach(function (z) {
      if (z.enc) bands.push([z.enc.min, z.enc.max]);
    });
  });
  /* maps.js 手写 field/cave 教学区遭遇带（凡界 fan1–4，覆盖 gl5–36） */
  [[5, 16], [13, 24], [17, 32], [21, 36]].forEach((b) => bands.push(b));
  const worlds = P.WORLDS;
  let holes = [];
  worlds.forEach(function (w) {
    /* 道界为特殊隐藏世界：靠「道则回廊」九关试炼推进，无开放野外刷怪带，故不校验。
       fan gl1–4 为新手引导（首战固定妖兽、沈伯授功），本就无野外遭遇，从 5 起算。 */
    if (w.id === 'dao') return;
    const g0 = w.id === 'fan' ? 5 : w.start;
    for (let gl = g0; gl <= w.cap; gl++) {
      let covered = bands.some((b) => gl >= b[0] && gl <= b[1]);
      if (!covered) holes.push(w.id + ':' + gl);
    }
  });
  ck('凡/灵/仙 三界每个 gl（fan 自5起）都有野外遭遇带（0 空洞）', holes.length === 0,
    holes.length + ' holes e.g. ' + holes.slice(0, 8).join(','));
})();

console.log('');
if (fail) { console.error('探针发现 ' + fail + ' 个问题'); process.exit(1); }
console.log('新模型探针全部通过 ✓');
