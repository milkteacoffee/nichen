/* 立绘放大预览：把 G.Art.portrait 的全部 key 以高倍放大并排导出，用于审半身像造型。
   顺便打一份 ASCII 缩略图 —— 图片直读在会话里会间歇性失败，文本化手段更可靠。
   用法：NODE_PATH=... node tools/portrait-sheet.js [key ...]
   输出：_shots/portraits.png 与 _shots/por_<key>.png */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');
const SHOTS = path.join(__dirname, '..', '_shots');
const OUT = path.join(SHOTS, 'portraits.png');

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
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
for (const rel of srcs) {
  const p = path.join(WWW, rel);
  if (!fs.existsSync(p)) continue;
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: rel });
}

const G = sandbox.G;
const A = G.Art;
const Z = 6;                                     /* 放大倍数（74 逻辑 → 444 屏幕） */
const LW = A.PORTRAIT_SIZE[0], LH = A.PORTRAIT_SIZE[1];

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const keys = only.length ? only : A.PORTRAIT_KEYS;

fs.mkdirSync(SHOTS, { recursive: true });

/* 单张高倍图 + ASCII 缩略图 */
for (const k of keys) {
  const art = A.portrait(k);
  const side = LW * Z, pad = 16;
  const o = createCanvas(side + pad * 2, side + pad * 2 + 30);
  const x = o.getContext('2d');
  x.fillStyle = '#20242e'; x.fillRect(0, 0, o.width, o.height);
  x.fillStyle = '#2b3040'; x.fillRect(pad, pad, side, side);
  x.imageSmoothingEnabled = true;
  x.drawImage(art.c, pad, pad, side, side);
  x.fillStyle = '#cfd6e6'; x.font = '20px sans-serif'; x.textAlign = 'center';
  x.fillText(k, o.width / 2, o.height - 10);
  fs.writeFileSync(path.join(SHOTS, 'por_' + k + '.png'), o.toBuffer('image/png'));

  /* ASCII：把 74×74 逻辑立绘降采样成 26×26 亮度图（背景用点，暗部用 #） */
  const d = art.c.getContext('2d').getImageData(0, 0, art.c.width, art.c.height).data;
  const N = 26, ramp = ' .:-=+*#%@';
  const rows = [];
  for (let ay = 0; ay < N; ay++) {
    let row = '';
    for (let ax = 0; ax < N; ax++) {
      let s = 0, n = 0;
      const y0 = Math.floor(ay * art.c.height / N), y1 = Math.floor((ay + 1) * art.c.height / N);
      const x0 = Math.floor(ax * art.c.width / N), x1 = Math.floor((ax + 1) * art.c.width / N);
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * art.c.width + sx) * 4;
        s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n++;
      }
      const v = (s / Math.max(1, n)) / 255;
      row += ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))))];
    }
    rows.push(row);
  }
  console.log('— ' + k + ' —');
  rows.forEach(r => console.log('  ' + r));
}

/* 并排总览 */
const CELL = LW * Z + 26;
const W = keys.length * CELL, H = LH * Z + 44;
const out = createCanvas(W, H);
const x = out.getContext('2d');
x.fillStyle = '#20242e'; x.fillRect(0, 0, W, H);
keys.forEach((k, i) => {
  const art = A.portrait(k);
  const dx = i * CELL + 13, dy = 16;
  x.fillStyle = '#2b3040';
  x.fillRect(dx, dy, LW * Z, LH * Z);
  x.imageSmoothingEnabled = true;
  x.drawImage(art.c, dx, dy, LW * Z, LH * Z);
  x.fillStyle = '#cfd6e6';
  x.font = '20px sans-serif';
  x.textAlign = 'center';
  x.fillText(k, dx + LW * Z / 2, H - 12);
});
fs.writeFileSync(OUT, out.toBuffer('image/png'));
console.log('已导出 ' + OUT + '  (' + W + '×' + H + ')');
