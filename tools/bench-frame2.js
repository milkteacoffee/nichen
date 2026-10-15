/* 帧耗时基准②：重场景（云州/副本/战斗多敌·天道五阶段/结局）。
   用法：node tools/bench-frame2.js （在项目根，node_modules 可解析 @napi-rs/canvas） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');
let napi;
try { napi = require('@napi-rs/canvas'); }
catch (e) { console.error('缺少 @napi-rs/canvas'); process.exit(2); }
const { createCanvas } = napi;

function makeRealCanvas(w, h) {
  const c = createCanvas(w || 300, h || 150);
  c.style = {};
  c.addEventListener = () => {};
  c.removeEventListener = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  return c;
}
const gameCanvas = makeRealCanvas(1440, 816);
const doc = {
  createElement(tag) { return tag === 'canvas' ? makeRealCanvas(1, 1) : { style: {}, appendChild() {}, addEventListener() {} }; },
  getElementById(id) { return id === 'game' ? gameCanvas : null; },
  addEventListener() {}
};
const sandbox = {
  console, document: doc, window: null,
  performance: { now: () => Date.now() },
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('offline')),
  Image: class { constructor() { this.width = 1; this.height = 1; } },
  localStorage: (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, clear: () => { for (const k in m) delete m[k]; } }; })(),
  navigator: { userAgent: 'node' },
  devicePixelRatio: 3
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1440;
sandbox.window.innerHeight = 816;
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
for (const rel of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) {
  const p = path.join(WWW, rel);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: rel });
}
const G = sandbox.G;

async function preloadAssets() {
  const mfPath = path.join(WWW, 'assets', 'manifest.json');
  if (!fs.existsSync(mfPath)) return 0;
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  let ok = 0;
  for (const key of Object.keys(mf)) {
    if (typeof mf[key] !== 'string') continue;
    const p = path.join(WWW, mf[key]);
    if (!fs.existsSync(p)) continue;
    try { G.Assets.register(key, await napi.loadImage(p)); ok++; } catch (e) {}
  }
  return ok;
}

(async function main() {
  const loaded = await preloadAssets();
  G.game.start();
  const save = {
    life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
    origin: 'test', originFx: { a: .05, h: .05 },
    linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    talents: [], skills: { 缠藤指: { lv: 2 }, 回春诀: { lv: 1 } }, skillEquip: ['缠藤指'],
    items: { 回春丹: 5, 妖囊: 2, 解封符: 1 },
    stone: 5000, qi: 1200, po: 30,
    globalLevel: 400, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
    quest: { step: 'free', flags: {} },
    scene: 'town', map: 'town', pos: null,
    chestsOpened: [], bossKilled: false, hp: 2000, chronicle: [],
    beasts: [], beastTeam: [], riding: null
  };
  G.game.save = save;
  G.game.meta = { past: [], xianli: 0, endings: {}, progress: G.Storage.defaultProgress() };
  G.game.meta.progress.activeWorld = 'fan';

  console.log('S=' + G.game.S + '  K=' + G.Art.K + '  素材键 ' + loaded + ' 个');

  /* 每个用例：name, enter(params) */
  const cases = [
    ['yunzhou', () => { save.pos = null; G.game.changeScene('yunzhou', { toSpawn: true }); }],
    ['dungeon', () => {
      save.dungeonSet = G.Data.dungeons.rollSet(save.worldSeed + ':set').slice(0, 5);
      save.pos = null; G.game.changeScene('dungeon');
    }],
    ['battle3', () => {
      G.game.changeScene('battle', {
        enemies: [
          G.Data.makeEnemy('青纹蛇', 380, '青纹蛇'),
          G.Data.makeEnemy('赤炎狼', 380, '赤炎狼'),
          G.Data.makeEnemy('树精', 380, '树精')
        ], mapId: 'field'
      });
    }],
    ['battleBoss', () => { G.game.changeScene('battle', { script: 'wolfKing', mapId: 'cave' }); }],
    ['tdStage5', () => { save.tdWar = { stage: 5, done: false }; G.game.changeScene('tiandaowar'); }],
    ['tdBattle5', () => { G.game.changeScene('battle', { script: 'tiandao', tdStage: 5, mapId: 'tiandaowar' }); }],
    ['ending', () => { G.game.changeScene('ending'); }]
  ];

  const ROUNDS = 5, N = 60, ctx = G.game.ctx;
  for (const [name, enter] of cases) {
    try {
      enter();
    } catch (e) { console.log(name.padEnd(12) + ' 进入失败：' + e.message); continue; }
    const sc = G.game.scene;
    if (!sc) { console.log(name.padEnd(12) + ' 无场景'); continue; }
    for (let i = 0; i < 30; i++) { if (sc.update) sc.update(1 / 60); sc.render(ctx); }
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) {
      const t0 = Date.now();
      for (let i = 0; i < N; i++) { if (sc.update) sc.update(1 / 60); sc.render(ctx); }
      runs.push((Date.now() - t0) / N);
    }
    runs.sort((a, b) => a - b);
    const best = runs[0], med = runs[Math.floor(ROUNDS / 2)];
    console.log(`${name.padEnd(12)} ${best.toFixed(2)} ms/帧  (${(1000 / best).toFixed(0)} fps 上限)` +
      `   最小/中位/最大 ${best.toFixed(1)}/${med.toFixed(1)}/${runs[ROUNDS - 1].toFixed(1)}`);
  }
})();
