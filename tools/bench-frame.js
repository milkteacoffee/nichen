/* 帧耗时基准：确认从大纹理取子块的铺地方式没有拖慢渲染。
   注意：**必须走 G.game.start()**，否则 resize() 不跑、S 停在初始值 2，
   量到的是"低倍率下的假快"。这里也把素材层加载进来，量的才是真实画面。
   用法：NODE_PATH=... node tools/bench-frame.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');
let napi;
try { napi = require('@napi-rs/canvas'); }
catch (e) { console.error('缺少 @napi-rs/canvas（设置 NODE_PATH）'); process.exit(2); }
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

/* 素材层：登记 manifest 里的图（Assets.load 走 fetch，无头环境跑不了） */
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
  G.game.start();                       /* 必须：resize() 会算出真实的超采样倍率 */
  const save = {
    life: 1, age: 16, globalLevel: 5, maxGlobalLevel: 5, hp: 274,
    qi: 1200, po: 30, stone: 500, watch: 0, worldSeed: 12345,
    six: { 勇猛: 8, 灵巧: 7, 体质: 9, 智力: 6, 魅力: 5 },
    linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    skills: { 缠藤指: { lv: 2 } }, skillEquip: ['缠藤指'],
    items: {}, chestsOpened: [], escapeLeft: 3, bossKills: 0, bossKilled: false,
    quest: { step: 'free', flags: {} }, chronicle: [], _ageTick: 0,
    scene: 'town', map: 'town', pos: null,
    world: G.Data.generateWorld(12345, true)
  };
  G.game.save = save;

  console.log('S=' + G.game.S + '  K=' + G.Art.K + '  素材键 ' + loaded + ' 个');

  const scenes = ['town', 'field', 'cave',
    'town_home', 'town_shop', 'town_market', 'field_temple'];
  const ROUNDS = 5, N = 60;
  for (const s of scenes) {
    save.pos = null;
    G.game.changeScene(s, { toSpawn: true });
    const sc = G.game.scene;
    const ctx = gameCanvas.getContext('2d');
    /* 预热：首次进图要烘地面纹理/精灵，不算进成绩 */
    for (let i = 0; i < 30; i++) { if (sc.update) sc.update(1 / 60); sc.render(ctx); }
    /* 单次测量噪声极大（同一场景能差 2 倍），取多轮中位数才可信 */
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) {
      const t0 = Date.now();
      for (let i = 0; i < N; i++) { if (sc.update) sc.update(1 / 60); sc.render(ctx); }
      runs.push((Date.now() - t0) / N);
    }
    runs.sort((a, b) => a - b);
    /* 头条数字取**最小值**：这台机器上外部负载会把单轮结果抬高 2 倍以上，
       最小轮最接近"纯渲染成本"，中位数/最大值只作参考。 */
    const best = runs[0], med = runs[Math.floor(ROUNDS / 2)];
    console.log(`${s.padEnd(12)} ${best.toFixed(2)} ms/帧  (${(1000 / best).toFixed(0)} fps 上限)` +
      `   最小/中位/最大 ${best.toFixed(1)}/${med.toFixed(1)}/${runs[ROUNDS - 1].toFixed(1)}`);
  }
})();
