/* 图标管线：下载生成图 → 从四边泛洪抠掉近黑背景（含主体缝隙黑腔）→
   裁内容包围盒 → 居中放进 size 方图（透明），与现有 mat.* 256px 图标同规格。
   用法：node tools/iconpipe.js <url> <outPng> [size=256]
*/
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

async function main() {
  const url = process.argv[2];
  const outPng = process.argv[3];
  const SZ = parseInt(process.argv[4] || '256', 10);

  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const img = await loadImage(buf);
  const W = img.width, H = img.height;
  const cv = createCanvas(W, H), cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const im = cx.getImageData(0, 0, W, H), d = im.data;

  function dark(k) {
    const r = d[k], g = d[k + 1], b = d[k + 2];
    return (r + g + b) / 3 < 16;
  }
  const vis = new Uint8Array(W * H), q = [];
  function seed(x, y) {
    const k = y * W + x;
    if (!vis[k] && dark(k * 4)) { vis[k] = 1; q.push(k); }
  }
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  let h = 0;
  while (h < q.length) {
    const k = q[h++], x = k % W, y = (k / W) | 0;
    d[k * 4 + 3] = 0;
    if (x > 0) seed(x - 1, y); if (x < W - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1); if (y < H - 1) seed(x, y + 1);
  }
  for (let k = 0; k < W * H; k++)
    if (d[k * 4 + 3] === 0) d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 0;

  /* 内容包围盒 */
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] !== 0) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  cx.putImageData(im, 0, 0);

  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const fit = SZ - 16, k = Math.min(fit / bw, fit / bh);
  const dw = Math.round(bw * k), dh = Math.round(bh * k);
  const out = createCanvas(SZ, SZ), ox = out.getContext('2d');
  ox.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ox) ox.imageSmoothingQuality = 'high';
  ox.drawImage(cv, minX, minY, bw, bh, (SZ - dw) / 2, (SZ - dh) / 2, dw, dh);

  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, out.toBuffer('image/png'));
  console.log('wrote ' + outPng + ' ' + SZ + 'x' + SZ + ' (src ' + bw + 'x' + bh + ')');
}
main().catch(e => { console.error(e); process.exit(1); });
