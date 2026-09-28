/* 精灵条管线：下载生成图 → 边缘泛洪抠掉浅色背景/投影 → 等分 N 帧 →
   水平居中、脚底对齐 → 输出紧凑透明 PNG（供 sprites.js 切片烘焙）。
   用法：node tools/spritepipe.js <url> <nFrames> <outPng>
*/
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

async function main() {
  const url = process.argv[2];
  const N = parseInt(process.argv[3], 10);
  const outPng = process.argv[4];

  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const img = await loadImage(buf);
  const W = img.width, H = img.height;

  const src = createCanvas(W, H);
  const sx = src.getContext('2d');
  sx.drawImage(img, 0, 0);
  const frame = sx.getImageData(0, 0, W, H);
  const d = frame.data;

  /* 背景判定：高亮、低饱和（白底 + 浅灰投影）。角色描边深、道袍有饱和色，会挡住泛洪。 */
  function isBg(i) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx - mn, lum = (r + g + b) / 3;
    return lum > 182 && sat < 40;
  }

  /* 从四条边泛洪，连通的背景像素置透明（不碰内部眼白等）。 */
  const visited = new Uint8Array(W * H);
  const queue = [];
  function seed(x, y) {
    const k = y * W + x;
    if (!visited[k] && isBg(k * 4)) { visited[k] = 1; queue.push(k); }
  }
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  let head = 0;
  while (head < queue.length) {
    const k = queue[head++], x = k % W, y = (k / W) | 0;
    d[k * 4 + 3] = 0;
    if (x > 0) seed(x - 1, y);
    if (x < W - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < H - 1) seed(x, y + 1);
  }
  /* 已透明像素颜色清零，避免后续缩放混入白边 */
  for (let k = 0; k < W * H; k++) {
    if (d[k * 4 + 3] === 0) { d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 0; }
  }
  sx.putImageData(frame, 0, 0);

  /* 等分 N 列，逐帧求内容包围盒与脚底 */
  const cw = W / N;
  const frames = [];
  for (let i = 0; i < N; i++) {
    const x0 = Math.round(i * cw), x1 = Math.round((i + 1) * cw);
    let minX = W, maxX = 0, minY = H, maxY = 0, found = false;
    for (let y = 0; y < H; y++) {
      for (let x = x0; x < x1; x++) {
        if (d[(y * W + x) * 4 + 3] !== 0) {
          found = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) throw new Error('帧 ' + i + ' 抠空了，需调阈值或重生成');
    frames.push({ x0, x1, minX, maxX, minY, maxY, cx: (minX + maxX) / 2 });
  }
  const baseline = Math.max.apply(null, frames.map(f => f.maxY));
  const topY = Math.min.apply(null, frames.map(f => f.minY));

  /* 清除每帧脚底以下残留的地面投影（泛洪阈值未覆盖的深色细影） */
  frames.forEach(function (f) {
    for (let y = f.maxY + 2; y < H; y++) {
      for (let x = f.x0; x < f.x1; x++) {
        const k = (y * W + x) * 4;
        d[k + 3] = 0; d[k] = d[k + 1] = d[k + 2] = 0;
      }
    }
  });
  sx.putImageData(frame, 0, 0);

  const FW = Math.ceil(cw);
  const mTop = 8, mBot = 8;
  const outH = (baseline + mBot) - (topY - mTop);
  const out = createCanvas(N * FW, outH);
  const ox = out.getContext('2d');
  frames.forEach(function (f, i) {
    const localCx = f.cx - f.x0;                 /* 帧内中心（非绝对坐标） */
    const dx = Math.round(i * FW + FW / 2 - localCx);
    const dy = Math.round(baseline - f.maxY) - (topY - mTop);
    ox.drawImage(src, f.x0, 0, f.x1 - f.x0, H,
      dx, dy, f.x1 - f.x0, H);
  });

  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, out.toBuffer('image/png'));
  console.log('wrote ' + outPng + '  ' + (N * FW) + 'x' + outH);
  frames.forEach((f, i) => {
    console.log('  帧' + i + ' 脚' + f.maxY + ' 顶' + f.minY +
      ' 宽' + (f.maxX - f.minX) + ' 居中偏移' + Math.round(i * FW + FW / 2 - f.cx));
  });
}
main().catch(e => { console.error(e); process.exit(1); });
