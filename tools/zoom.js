/* 局部放大审查：把指定场景渲染一帧，裁出目标区域并做整数倍最近邻放大。
   用来近距离检查精灵清晰度 / 有没有被低倍率位图放大糊掉。
   用法：node tools/zoom.js [场景] [倍数] [输出目录]
        场景 ∈ town | field | cave | title | battle | death | hall   （默认 town）
   依赖：NODE_PATH 指向已安装 @napi-rs/canvas 的 node_modules */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');
const SCENE = process.argv[2] || 'town';
const FULL_FRAME = process.argv[3] === 'full';
const ZOOM = FULL_FRAME ? 1 : Math.max(1, parseInt(process.argv[3] || '4', 10) || 4);
const OUT = process.argv[4] ? path.resolve(process.argv[4]) : path.join(__dirname, '..', '_shots');
fs.mkdirSync(OUT, { recursive: true });

let napi;
try {
  napi = require('@napi-rs/canvas');
} catch (e) {
  console.error('缺少 @napi-rs/canvas，请设置 NODE_PATH');
  process.exit(2);
}
const { createCanvas, GlobalFonts } = napi;
for (const [p, names] of [
  ['C:/Windows/Fonts/simkai.ttf', ['LXGW WenKai', 'KaiTi']],
  ['C:/Windows/Fonts/msyh.ttc', ['Microsoft YaHei']],
  ['C:/Windows/Fonts/simsun.ttc', ['SimSun']]
]) {
  if (!fs.existsSync(p)) continue;
  for (const n of names) { try { GlobalFonts.registerFromPath(p, n); } catch (e) {} }
}

function makeRealCanvas(w, h) {
  const c = createCanvas(w || 300, h || 150);
  c.style = {};
  c.addEventListener = () => {};
  c.removeEventListener = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  c.toBuffer = c.toBuffer.bind(c);
  return c;
}

/* 模拟一块 1920×1080 的桌面窗口（dpr=1）：显示倍率 ≈ 3.97，
   这是最容易暴露「内部倍率不够被放大」的场景。 */
const WIN_W = 1920, WIN_H = 1080, DPR = 1;
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
  devicePixelRatio: DPR
};
sandbox.window = sandbox;
sandbox.window.innerWidth = WIN_W;
sandbox.window.innerHeight = WIN_H;
sandbox.window.devicePixelRatio = DPR;
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
  vm.runInContext(fs.readFileSync(path.join(WWW, m[1]), 'utf8'), sandbox, { filename: m[1] });
}

function pump(frames) {
  let t = sandbox.performance.now();
  for (let i = 0; i < frames; i++) {
    const q = rafQueue; rafQueue = [];
    if (!q.length) break;
    t += 16.7;
    for (const fn of q) fn(t);
  }
}

const G = sandbox.G;

/* 素材层：Assets.load() 走 fetch + new Image().src，无头环境都跑不了（而且是异步的，
   本脚本同步流程等不到）。这里用 loadImage 直接登记 manifest 里的图，
   审查时看到的才是"装了素材"的真实精灵。 */
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
pump(10);

/* 造一份能直接进图的中期存档 */
const save = {
  life: 1, age: 24, globalLevel: 6, maxGlobalLevel: 6, hp: 300,
  qi: 900, po: 220, stone: 640, watch: 12,
  six: { 勇猛: 9, 灵巧: 8, 体质: 8, 智力: 7, 魅力: 6 },
  linggen: { kind: '五行', elems: ['木'], coef: { 木: 1.2 }, stoneBonus: 0 },
  skills: { 缠藤指: { lv: 2 }, 铁布衫: { lv: 1 }, 吐纳术: { lv: 1 } },
  items: {}, chestsOpened: [], escapeLeft: 3, bossKills: 0, bossKilled: false,
  quest: { step: 'm0-4', flags: {} },
  world: G.Data.generateWorld(7, true),
  worldSeed: 7, map: 'town', scene: 'town', pos: null,
  chronicle: [], _ageTick: 0
};
G.game.save = save;

const entry = {
  town: () => G.game.changeScene('town', { toSpawn: true }),
  field: () => G.game.changeScene('field', { toSpawn: true }),
  cave: () => G.game.changeScene('cave', { toSpawn: true }),
  town_home: () => G.game.changeScene('town_home', { toSpawn: true }),
  town_shop: () => G.game.changeScene('town_shop', { toSpawn: true }),
  town_market: () => G.game.changeScene('town_market', { toSpawn: true }),
  field_temple: () => G.game.changeScene('field_temple', { toSpawn: true }),
  title: () => G.game.changeScene('title'),
  death: () => { G.game.changeScene('death'); },
  hall: () => G.game.changeScene('hall'),
  battle: () => G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 6, '赤炎狼'), mapId: 'field' })
};
const MAP_SCENES = ['town', 'field', 'cave', 'town_home', 'town_shop', 'town_market', 'field_temple'];
(entry[SCENE] || entry.town)();
pump(30);

/* 目标区域：地图场景裁玩家所在处，UI 场景裁整屏。
   第 2 个参数给 full → 输出整屏原尺寸（用来审 UI 布局与"控件有没有残留"）。 */
const S = G.game.S;
const full = gameCanvas;

const box = { x: 0, y: 0, w: full.width, h: full.height };
if (!FULL_FRAME && MAP_SCENES.indexOf(SCENE) >= 0) {
  const sc = G.game.scene;
  const px = sc._px ? sc._px() : { x: 240, y: 136 };
  const cx = (px.x - sc._camX()) * S, cy = (px.y - sc._camY()) * S;
  const half = 60 * S;
  box.x = Math.max(0, Math.round(cx - half));
  box.y = Math.max(0, Math.round(cy - half));
  box.w = Math.min(full.width - box.x, half * 2);
  box.h = Math.min(full.height - box.y, half * 2);
}

const o = createCanvas(box.w * ZOOM, box.h * ZOOM);
const x = o.getContext('2d');
x.imageSmoothingEnabled = false;         /* 最近邻：放大后能直接看出源位图的实际分辨率 */
x.drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w * ZOOM, box.h * ZOOM);
const file = path.join(OUT, 'zoom_' + SCENE + (FULL_FRAME ? '_full' : '') + '.png');
fs.writeFileSync(file, o.toBuffer('image/png'));
console.log('S=' + S + '  K=' + G.Art.K + '  窗口 ' + WIN_W + '×' + WIN_H + ' dpr' + DPR);
console.log('素材键 ' + loaded + ' 个');
console.log('裁剪 ' + box.w + '×' + box.h + ' → 放大 ' + ZOOM + '× → ' + file);

})();
