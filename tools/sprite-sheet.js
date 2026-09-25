/* 战斗立绘放大预览：把关键精灵以 8 倍放大并排导出，便于近距离审造型。
   用法：NODE_PATH=... node tools/sprite-sheet.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');
const OUT = path.join(__dirname, '..', '_shots', 'sprites.png');

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
const S = G.Sprites;

const names = ['hero', 'killer', 'wolf', 'wolfking', 'snake'];
const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const list = only.length ? names.filter(n => only.includes(n)) : names;
const Z = 12;                /* 放大倍数（精灵 40 逻辑 → 480 屏幕） */

fs.mkdirSync(path.dirname(OUT), { recursive: true });

/* 单张高倍图：便于近距离判断造型 */
for (const n of list) {
  const c = S.beast(n);
  const side = 40 * Z, pad = 16;
  const o = createCanvas(side + pad * 2, side + pad * 2 + 30);
  const x = o.getContext('2d');
  x.fillStyle = '#20242e'; x.fillRect(0, 0, o.width, o.height);
  x.fillStyle = '#2b3040'; x.fillRect(pad, pad, side, side);
  x.imageSmoothingEnabled = true;
  x.drawImage(c, pad, pad, side, side);
  x.fillStyle = '#cfd6e6'; x.font = '20px sans-serif'; x.textAlign = 'center';
  x.fillText(n, o.width / 2, o.height - 10);
  const p = path.join(path.dirname(OUT), 'spr_' + n + '.png');
  fs.writeFileSync(p, o.toBuffer('image/png'));
  console.log('· ' + p);
}

/* 并排总览 */
const CELL = 40 * Z + 26;
const W = list.length * CELL, H = 40 * Z + 44;
const out = createCanvas(W, H);
const x = out.getContext('2d');
x.fillStyle = '#20242e';
x.fillRect(0, 0, W, H);

list.forEach((n, i) => {
  const c = S.beast(n);
  const dx = i * CELL + 13, dy = 16;
  x.fillStyle = '#2b3040';
  x.fillRect(dx, dy, 40 * Z, 40 * Z);
  x.imageSmoothingEnabled = true;
  x.drawImage(c, dx, dy, 40 * Z, 40 * Z);
  x.fillStyle = '#cfd6e6';
  x.font = '20px sans-serif';
  x.textAlign = 'center';
  x.fillText(n, dx + 20 * Z, H - 12);
});

fs.writeFileSync(OUT, out.toBuffer('image/png'));
console.log('已导出 ' + OUT + '  (' + W + '×' + H + ')');
