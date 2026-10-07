/* 剧情/立绘/过场 专用无头截图：node tools/shot_story.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WWW = path.join(__dirname, '..', 'www');
const OUT = path.join(__dirname, '..', '_shots', 'story');
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
const gameCanvas = makeRealCanvas(1440, 816);
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
  navigator: { userAgent: 'node' }, devicePixelRatio: 3
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1440; sandbox.window.innerHeight = 816; sandbox.window.devicePixelRatio = 3;
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

function baseSave(life) {
  const world = G.Data.generateWorld(12345, true);
  return {
    life: life, worldSeed: 12345, world: world,
    origin: 'test', originFx: { a: .05, h: .05 },
    linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    talents: [], skills: {}, skillEquip: [],
    items: {}, stone: 500, qi: 1200, po: 30,
    globalLevel: 5, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
    quest: { step: 'free', flags: {} },
    scene: 'town', map: 'town', pos: { x: 5, y: 5 },
    chestsOpened: [], bossKilled: false, hp: 200, chronicle: []
  };
}

const SHOW = {
  arc1: { pid: 'jiang', line: '阿尘，山外的世界大得很……不急，啊。' },
  arc2: { pid: 'xuanjizi', line: '你这孩子，命里带着劫……随我回山吧。' },
  arc3: { pid: 'aheng', line: '这一世……我很欢喜。' },
  arc4: { pid: 'nianchen', line: '爹，这一次，让我自己走吧。' },
  arc5: { pid: 'shouye', line: '师尊……弟子记住了。' }
};

(async function main() {
  await preload();
  G.game.start();
  pump(2);
  const defs = G.Arcs.list();
  defs.forEach(function (d, i) {
    if (d.id === 'arc6') return;
    const save = baseSave(i + 1);
    const meta = { bonds: {}, regrets: [], progress: {} };
    G.Arcs.ensure(meta);
    G.Arcs.begin(save, meta, d);
    G.game.save = save; G.game.meta = meta;
    G.game.changeScene('arc');
    const sc = G.scenes.arc;
    save.arc.phase = 'daily';
    const sh = SHOW[d.id];
    sc._say(sh.pid, sh.line);
    sc.line.tw.show();
    pump(3);
    snap('portrait_' + d.id);
  });

  /* 主角立绘 */
  (function () {
    const d = G.Arcs.byId('arc1');
    const save = baseSave(1);
    const meta = { bonds: {}, regrets: [], progress: {} };
    G.Arcs.ensure(meta); G.Arcs.begin(save, meta, d);
    G.game.save = save; G.game.meta = meta; G.game.changeScene('arc');
    const sc = G.scenes.arc; save.arc.phase = 'daily';
    sc._say('__hero', '我偏要逆这天道，把你们一个一个，都带回来。');
    sc.line.tw.show(); pump(3); snap('portrait_hero');
  })();

  /* 过场 Ken Burns + 字幕（arc1 两镜头，推进到第二镜头） */
  (function () {
    const d = G.Arcs.byId('arc1');
    const save = baseSave(1);
    const meta = { bonds: {}, regrets: [], progress: {} };
    G.Arcs.ensure(meta); G.Arcs.begin(save, meta, d);
    G.game.save = save; G.game.meta = meta; G.game.changeScene('arc');
    G.Cutscene.play(G.CineLib.forArc('arc1'), function () {});
    console.log('after play open=' + G.Cutscene.isOpen() + ' shots=' + G.Cutscene.shots.length + ' mode=' + G.Cutscene.mode);
    pump(70);
    console.log('after pump70 open=' + G.Cutscene.isOpen() + ' idx=' + G.Cutscene.idx + ' t=' + G.Cutscene.t.toFixed(2));
    snap('cutscene_arc1_a');
    pump(160); snap('cutscene_arc1_b');
    if (G.Cutscene.isOpen()) G.Cutscene.finish();
  })();

  console.log('完成 → ' + OUT);
})();
