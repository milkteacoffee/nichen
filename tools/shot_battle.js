/* 战斗状态机无头截图：node tools/shot_battle.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WWW = path.join(__dirname, '..', 'www');
const OUT = path.join(__dirname, '..', '_shots', 'battle');
fs.mkdirSync(OUT, { recursive: true });
const napi = require('@napi-rs/canvas');
const { createCanvas, GlobalFonts } = napi;
[['C:/Windows/Fonts/simkai.ttf', ['LXGW WenKai', 'KaiTi']],
 ['C:/Windows/Fonts/msyh.ttc', ['Microsoft YaHei']],
 ['C:/Windows/Fonts/simsun.ttc', ['SimSun']]].forEach(function (x) {
  if (!fs.existsSync(x[0])) return;
  x[1].forEach(function (n) { try { GlobalFonts.registerFromPath(x[0], n); } catch (e) {} });
});
function makeRealCanvas(w, h) {
  const c = createCanvas(w || 300, h || 150);
  c.style = {}; c.addEventListener = () => {}; c.removeEventListener = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  return c;
}
const gameCanvas = makeRealCanvas(1280, 720);
const doc = {
  createElement(tag) { return tag === 'canvas' ? makeRealCanvas(1, 1) : { style: {}, appendChild() {}, addEventListener() {} }; },
  getElementById(id) { return id === 'game' ? gameCanvas : null; },
  addEventListener() {}
};
let rafQueue = [];
const sandbox = {
  console, document: doc, window: null,
  performance: { now: () => Date.now() },
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('offline')),
  Image: class { constructor() { this.width = 1; this.height = 1; } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
  navigator: { userAgent: 'node' }, devicePixelRatio: 2
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1280; sandbox.window.innerHeight = 720; sandbox.window.devicePixelRatio = 2;
sandbox.window.addEventListener = () => {}; sandbox.window.removeEventListener = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).forEach(function (rel) {
  vm.runInContext(fs.readFileSync(path.join(WWW, rel), 'utf8'), sandbox, { filename: rel });
});
const G = sandbox.G;
let vclock = sandbox.performance.now();
function pump(frames) {
  for (let i = 0; i < frames; i++) {
    const q = rafQueue; rafQueue = [];
    if (!q.length) break;
    vclock += 16.7;
    q.forEach(function (fn) { fn(vclock); });
  }
}
async function preload() {
  const mf = JSON.parse(fs.readFileSync(path.join(WWW, 'assets', 'manifest.json'), 'utf8'));
  let ok = 0;
  for (const key of Object.keys(mf)) {
    if (typeof mf[key] !== 'string') continue;
    const p = path.join(WWW, mf[key]);
    if (!fs.existsSync(p)) continue;
    try { G.Assets.register(key, await napi.loadImage(p)); ok++; } catch (e) {}
  }
  console.log('素材登记 ' + ok);
}
function snap(name) {
  fs.writeFileSync(path.join(OUT, name + '.png'), gameCanvas.toBuffer('image/png'));
  console.log('· ' + name + '.png');
}
function baseSave() {
  const world = G.Data.generateWorld(12345, true);
  return {
    life: 1, worldSeed: 12345, world: world,
    origin: 'test', originFx: { a: .05, h: .05 },
    linggen: { elems: ['火'], coef: { 火: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    talents: [], skills: {}, skillEquip: [],
    items: {}, stone: 500, qi: 1200, po: 30,
    globalLevel: 40, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
    quest: { step: 'free', flags: {} },
    scene: 'town', map: 'town', pos: { x: 5, y: 5 },
    chestsOpened: [], bossKilled: false, hp: 200, chronicle: [],
    secrets: {}, aff: {}, affGot: {}
  };
}
(async function main() {
  await preload();
  G.game.start();
  pump(2);
  const save = baseSave();
  const meta = { bonds: {}, regrets: [], progress: {} };
  G.game.save = save; G.game.meta = meta;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 40, '苍鬃狼'), mapId: 'field' });
  pump(3);
  var sc = G.game.scene;
  /* 施法聚气：直接把玩家置于 cast 状态并指定火元素 */
  sc.castT.P = 1; sc._curSpellElem = '火';
  pump(1);
  snap('cast_glow');
  /* 直接令敌人死亡，分阶段截倒地（侧倒中 / 已淡出） */
  sc.castT.P = 0;
  sc.es[0].hp = 0;
  sc.deathT.E0 = 0.16;
  pump(1);
  snap('down');
  sc.deathT.E0 = 0.6;
  pump(1);
  snap('down_faded');
  console.log('完成 → ' + OUT);
})();
