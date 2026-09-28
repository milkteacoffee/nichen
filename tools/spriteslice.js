/* spriteslice —— 纯色键底精灵条 → 透明 PNG（色键抠图 + 去溢色 + 自动分帧 + 脚对齐）
   用法：
     node tools/spriteslice.js <原图> --out <输出.png> [--frames N] [--key RRGGBB]
                                  [--gap 2] [--name 逻辑名] [--single]
   抠图口径（双判据，取更严格）：
     · 距离判据：像素到键色的 RGB 距离；
     · 色相判据：AI 生成的"品红底"常是带噪点、含绿的浅粉，距离判据会漏；
       改用品红色相强度 min(r-g,b-g)——白/灰/金云与红/蓝/绿主体该值低，粉底高。
   横向精灵条按"全透明列"切帧；给 --frames N 时帧数不符整体不写盘并落诊断图。
   --single：整图就是一个主体（不分帧），抠图后保留整幅宽度、仅裁纵向空白。
   依赖：NODE_PATH 指向已安装 @napi-rs/canvas 的 node_modules。重跑幂等。 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { _: [], key: 'FF00FF', gap: 2 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--out') a.out = argv[++i];
    else if (t === '--frames') a.frames = parseInt(argv[++i], 10);
    else if (t === '--key') a.key = String(argv[++i]).replace('#', '');
    else if (t === '--gap') a.gap = parseInt(argv[++i], 10);
    else if (t === '--name') a.name = argv[++i];
    else if (t === '--single') a.single = true;
    else if (!t.startsWith('--')) a._.push(t);
  }
  return a;
}

function hexRgb(hex) {
  const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function main() {
  const A = parseArgs(process.argv.slice(2));
  const src = A._[0];
  if (!src || !A.out) {
    console.error('用法：node tools/spriteslice.js <原图> --out <输出.png> [--frames N] [--key RRGGBB] [--single]');
    process.exit(2);
  }
  const napi = require('@napi-rs/canvas');
  const { createCanvas, loadImage } = napi;
  const img = await loadImage(src);
  const W = img.width, H = img.height;
  const cv = createCanvas(W, H);
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const frame = cx.getImageData(0, 0, W, H);
  const d = frame.data;
  const K = hexRgb(A.key);

  /* ---- 双判据色键抠图 + 去品红溢色 ---- */
  const D0 = 58, D1 = 132;                 // 距离：全透 / 全不透
  const H_HI = 62, H_LO = 20;              // 品红色相 min(r-g,b-g)：>=HI 全透，<=LO 全不透
  for (let p = 0; p < d.length; p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    /* 判据一：到键色的 RGB 距离 */
    const dr = r - K[0], dg = g - K[1], db = b - K[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let aDist = 255;
    if (dist <= D0) aDist = 0;
    else if (dist < D1) aDist = Math.round(255 * (dist - D0) / (D1 - D0));
    /* 判据二：品红色相强度（白/灰/金云与非粉主体该值低） */
    const hue = Math.min(r - g, b - g);
    let aHue = 255;
    if (hue >= H_HI) aHue = 0;
    else if (hue > H_LO) aHue = Math.round(255 * (H_HI - hue) / (H_HI - H_LO));
    /* 取更严格（更透明）者 */
    let alpha = Math.min(aDist, aHue);
    /* 去品红溢色：凡带品红色相(min(r-g,b-g)>6)的像素，把超出绿的红/蓝基本收平为
       中性，使云呈白/灰而非粉色；金/红/蓝等非品红色相 hue<=0，不受影响。 */
    let nr = r, nb = b;
    if (hue > 6) {
      /* 先去共色（品红），再把残留的单向暖色收 70%，使云近中性白/灰；
         金色等含冷向（b<g）的像素 hue<=0，不会进入此分支，金色得以保留。 */
      const ex = Math.min(r - g, b - g);
      nr = r - ex;
      nb = b - ex;
      nr -= Math.max(0, nr - g) * 1.0;
      nb -= Math.max(0, nb - g) * 1.0;
    }
    d[p] = Math.max(0, Math.round(nr));
    d[p + 2] = Math.max(0, Math.round(nb));
    d[p + 3] = alpha;
  }
  cx.putImageData(frame, 0, 0);

  /* ---- 列占用 → 分帧 ---- */
  const ATH = 16;
  const colHas = new Array(W).fill(false);
  for (let x0 = 0; x0 < W; x0++) {
    for (let y0 = 0; y0 < H; y0++) {
      if (d[(y0 * W + x0) * 4 + 3] > ATH) { colHas[x0] = true; break; }
    }
  }
  let frames = [];
  if (A.single) {
    frames = [[0, W - 1]];
  } else {
    let x0 = 0;
    while (x0 < W) {
      while (x0 < W && !colHas[x0]) x0++;
      let x1 = x0;
      while (x1 < W) {
        if (!colHas[x1]) {
          let gap = 1;
          while (x1 + gap < W && !colHas[x1 + gap]) gap++;
          if (gap >= A.gap) break;
        }
        x1++;
      }
      if (x0 < W) {
        let end = x1 - 1;
        while (end >= x0 && !colHas[end]) end--;
        if (end >= x0) frames.push([x0, end]);
      }
      x0 = x1 + 1;
    }
  }

  /* ---- 每帧内容包围盒 ---- */
  const rects = frames.map(function (fr) {
    let top = H, bottom = -1;
    for (let y0 = 0; y0 < H; y0++) {
      let rowHas = false;
      for (let xx = fr[0]; xx <= fr[1]; xx++) {
        if (d[(y0 * W + xx) * 4 + 3] > ATH) { rowHas = true; break; }
      }
      if (rowHas) { if (y0 < top) top = y0; bottom = y0; }
    }
    return { l: fr[0], r: fr[1], t: top, b: bottom, w: fr[1] - fr[0] + 1, h: bottom - top + 1 };
  });

  if (A.frames && rects.length !== A.frames) {
    const diag = A.out.replace(/\.png$/i, '') + '_diag.png';
    fs.writeFileSync(diag, cv.toBuffer('image/png'));
    throw new Error('帧数不符：期望 ' + A.frames + '，实得 ' + rects.length
      + '；诊断图 ' + diag + '（请调整 --gap，或检查原图帧间留白）');
  }
  if (!rects.length || rects.some((r) => r.b < 0)) throw new Error('未检测到主体内容');

  /* ---- 脚对齐拼条 ---- */
  const cellW = Math.max.apply(null, rects.map((r) => r.w));
  const cellH = Math.max.apply(null, rects.map((r) => r.h));
  const out = createCanvas(cellW * rects.length, cellH);
  const oc = out.getContext('2d');
  rects.forEach(function (r, i) {
    const sub = cx.getImageData(r.l, r.t, r.w, r.h);
    const cell = createCanvas(cellW, cellH);
    cell.getContext('2d').putImageData(sub, Math.round((cellW - r.w) / 2), cellH - r.h);
    oc.drawImage(cell, i * cellW, 0);
  });

  fs.mkdirSync(path.dirname(A.out), { recursive: true });
  fs.writeFileSync(A.out, out.toBuffer('image/png'));
  console.log('OK ' + A.out + '  帧=' + rects.length + '  格=' + cellW + '×' + cellH
    + '  条=' + (cellW * rects.length) + '×' + cellH);
  if (A.name) {
    console.log('manifest 片段：');
    console.log("  '" + A.name + "': 'assets/img/" + path.basename(A.out) + "',");
  }
}

main().catch(function (e) {
  console.error('[spriteslice] ' + e.message);
  process.exit(1);
});
