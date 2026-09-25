/* 地面大纹理烘焙耗时基准：确认首次进入镇/山/洞不会有可见卡顿 */
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..');

/* 极简 DOM 桩，只为让 art.js 能跑 */
const doc = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    const c = createCanvas(300, 150);
    c.style = {};
    c.addEventListener = () => {};
    c.removeEventListener = () => {};
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
    return c;
  }
};

global.window = { innerWidth: 1440, innerHeight: 816, devicePixelRatio: 3 };
global.document = doc;

const ctx = { G: { Assets: { img: () => null } } };
global.G = ctx.G;

const files = ['www/js/core/art.js'];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  new Function('G', 'window', 'document', src)(ctx.G, global.window, doc);
}

const A = ctx.G.Art;
const pals = [
  { ground: '#4e7a3a', grass: '#6fae4a', dark: '#2f4a26', rock: '#8a8f96' },
  { ground: '#6a5f4e', grass: '#7d9a52', dark: '#4a4034', rock: '#8a857a' }
];
const kinds = ['grass', 'path', 'town', 'cave'];
let total = 0;
for (const pal of pals) {
  for (const k of kinds) {
    const t0 = Date.now();
    A.groundTex(k, pal);
    A.shadeTex(k, pal);
    const dt = Date.now() - t0;
    total += dt;
    console.log(`${k.padEnd(6)} ground+shade  ${dt} ms`);
  }
}
console.log(`合计 ${total} ms（每张纹理只在首次使用时烘焙一次并缓存）`);
