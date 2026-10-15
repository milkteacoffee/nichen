/* 凡界十区域对比截图：node tools/shot_regions.js（验证 G5 无雷同） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WWW = path.join(__dirname, '..', 'www');
const OUT = path.join(__dirname, '..', '_shots', 'regions');
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
function baseSave(seed) {
  const world = G.Data.generateWorld(seed || 12345, true);
  return {
    life: 1, worldSeed: seed || 12345, world: world,
    origin: 'test', originFx: { a: .05, h: .05 },
    linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    talents: [], skills: {}, skillEquip: [],
    items: {}, stone: 500, qi: 1200, po: 30,
    globalLevel: 1, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
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
  const targets = ['fan1', 'fan2', 'fan3', 'fan4', 'fan5', 'fan6', 'fan7', 'fan8', 'fan9', 'fan10'];
  targets.forEach(function (rid) {
    const save = baseSave(12345);
    const meta = { bonds: {}, regrets: [], progress: {} };
    G.game.save = save; G.game.meta = meta;
    const isHand = ['fan1', 'fan2', 'fan3', 'fan10'].indexOf(rid) >= 0;
    if (!isHand) G.RegionGen.ensure(save, rid);
    if (G.Data.Encounters) G.Data.Encounters.tickStep = function () {};
    if (G.Data.StoryEvents) G.Data.StoryEvents.pendingFor = function () { return null; };
    if (G.Data.Chapters) G.Data.Chapters.pendingFor = function () { return null; };
    G.game.changeScene(G.Data.regions.mapIdOf(rid), { toSpawn: true });
    G.game.scene._encounter = function () {};
    G.game.scene._encounterRoam = function () {};
    G.game.scene._rollUnit = function () { return null; };
    if (G.game.scene.overlay) G.game.scene.clearOverlay();
    pump(4);
    if (G.game.scene.overlay) G.game.scene.clearOverlay();
    pump(2);
    snap('rg_' + rid);
  });
  console.log('完成 → ' + OUT);
})();
