/* 美术引擎 v2 —— 高保真程序化素材层
   ─ 所有素材以 3 倍超采样绘制（逻辑 1px = 3 设备px），边缘自然抗锯齿，摆脱"色块感"。
   ─ 每个素材先查 G.Assets.img(逻辑名)，命中直接用你的图，否则程序化兜底。
   ─ 全部结果进缓存，一帧只做 drawImage，性能无忧。 */
(function () {
  /* 超采样倍率。必须与 Game.S（画布内部倍率）保持一致：
     素材按 K 倍烘焙、再按逻辑尺寸画进 S 倍的画布 —— K < S 就是"小图放大"，糊。
     启动时由 Game.resize() 通过 setK() 设成同一个值。 */
  var K = 3;
  var A = {};

  /* ============================================================
     一、颜色工具
     ============================================================ */
  /* 颜色解析：同时支持 #rgb / #rrggbb / rgb() / rgba()，并带缓存 */
  var COL_CACHE = {};
  function parseColor(h) {
    h = String(h == null ? '#000000' : h).trim();
    var c = COL_CACHE[h];
    if (c) return c;
    var out = null;
    if (h.charAt(0) === '#') {
      var t = h.slice(1);
      if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
      if (t.length >= 6) {
        var r = parseInt(t.substr(0, 2), 16);
        var g = parseInt(t.substr(2, 2), 16);
        var b = parseInt(t.substr(4, 2), 16);
        if (isFinite(r) && isFinite(g) && isFinite(b)) out = [r, g, b, 1];
      }
    } else {
      var m = h.match(/^rgba?\(([^)]+)\)$/i);
      if (m) {
        var q = m[1].split(',');
        out = [
          parseFloat(q[0]) || 0, parseFloat(q[1]) || 0, parseFloat(q[2]) || 0,
          q.length > 3 ? (isFinite(parseFloat(q[3])) ? parseFloat(q[3]) : 1) : 1
        ];
      }
    }
    if (!out) out = [128, 128, 128, 1];   /* 无法识别时用中性灰，绝不产生错色 */
    COL_CACHE[h] = out;
    return out;
  }
  function hx(h) { var c = parseColor(h); return [c[0], c[1], c[2]]; }
  function rgb(c) {
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  }
  /* amt>0 提亮，amt<0 压暗；保留原色 alpha */
  function shade(hex, amt) {
    var c = parseColor(hex);
    var o = [c[0], c[1], c[2]].map(function (v) {
      return amt >= 0 ? v + (255 - v) * amt : v * (1 + amt);
    });
    return 'rgba(' + (o[0] | 0) + ',' + (o[1] | 0) + ',' + (o[2] | 0) + ',' + c[3] + ')';
  }
  function mix(a, b, t) {
    var p = parseColor(a), q = parseColor(b);
    return 'rgba(' + ((p[0] + (q[0] - p[0]) * t) | 0) + ','
      + ((p[1] + (q[1] - p[1]) * t) | 0) + ','
      + ((p[2] + (q[2] - p[2]) * t) | 0) + ','
      + (p[3] + (q[3] - p[3]) * t) + ')';
  }
  function alpha(hex, a) {
    var c = parseColor(hex);
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }

  /* 稳定随机（同种子同结果） */
  function rnd(seed) {
    var s = (seed >>> 0) || 88675123;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ============================================================
     二、画布与缓存
     ============================================================ */
  function cv(w, h, k) {
    k = k || K;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d');
    x.scale(k, k);
    x.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in x) x.imageSmoothingQuality = 'high';
    return { c: c, x: x, k: k };
  }
  A.cv = cv;

  var store = {};
  function cached(key, w, h, fn) {
    if (store[key]) return store[key];
    var o = cv(w, h);
    fn(o.x, w, h);
    store[key] = o;
    return o;
  }
  A.clear = function () { store = {}; };

  /* 改超采样倍率：清空缓存让所有素材按新倍率重烘。
     返回 true 表示倍率确实变了（调用方需要连带清精灵/UI 缓存）。 */
  A.setK = function (k) {
    k = Math.max(1, Math.min(6, Math.round(k || 3)));
    if (k === K) return false;
    K = k; A.K = K; store = {};
    return true;
  };

  /* 关键：缓存画布是 K 倍超采样，必须按"逻辑尺寸"绘制，否则会放大 K 倍。
     art = { c, ox, oy, w, h }（ox/oy 为相对锚点偏移，w/h 为逻辑尺寸） */
  A.blit = function (x, art, dx, dy) {
    x.drawImage(art.c, Math.round(dx + art.ox), Math.round(dy + art.oy), art.w, art.h);
  };
  /* 单张画布按逻辑尺寸绘制（用于瓦片等定尺寸素材） */
  A.blitFixed = function (x, img, dx, dy, w, h) {
    x.drawImage(img, Math.round(dx), Math.round(dy), w, h);
  };

  /* 不规则软斑路径（只建路径不填充，便于 clip / stroke） */
  function blobPath(x, cx, cy, r, sq) {
    var n = 8;
    x.beginPath();
    for (var i = 0; i <= n; i++) {
      var a = i / n * 6.2832;
      var rr = r * (0.70 + 0.30 * Math.abs(Math.sin(i * 2.37 + cx * 0.7 + cy * 0.3)));
      var px = cx + Math.cos(a) * rr;
      var py = cy + Math.sin(a) * rr * (sq == null ? 0.88 : sq);
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
  }
  A.blobPath = blobPath;

  /* 不规则软斑（做有机纹理用） */
  function blob(x, cx, cy, r, sq) {
    blobPath(x, cx, cy, r, sq);
    x.fill();
  }
  A.blob = blob;

  /* 无缝斑：把斑点按 3×3 环绕绘制，跨格边缘自然衔接（瓦片专用）
     TS 为周期边长，默认 16（小瓦片）；地面大纹理传 224。 */
  function blobTiled(x, cx, cy, r, sq, TS) {
    var P = TS || 16;
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        blob(x, cx + ox * P, cy + oy * P, r, sq);
      }
    }
  }
  A.blobTiled = blobTiled;

  /* 把一段绘制在 3×3 环绕位置各画一遍：跨边界的笔画/路径不会被裁断。
     小瓦片时代这是接缝的主要来源（草叶、碎石画到边外直接被裁掉）。 */
  function wrapDraw(x, TS, fn) {
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) { fn(x, 0, 0); continue; }
        x.save();
        x.translate(ox * TS, oy * TS);
        fn(x, ox * TS, oy * TS);
        x.restore();
      }
    }
  }
  A.wrapDraw = wrapDraw;

  /* 环绕绘制（带剔除）：逐个元素算它是否真的越界，只画必要的副本。
     无条件 9 遍会让一张纹理的描边次数直接乘 9，是烘焙耗时的大头。 */
  function wrapEach(x, TS, items, rad, drawOne) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var rr = typeof rad === 'function' ? rad(it) : rad;
      var ox0 = it.x - rr < 0 ? -1 : 0, ox1 = it.x + rr > TS ? 1 : 0;
      var oy0 = it.y - rr < 0 ? -1 : 0, oy1 = it.y + rr > TS ? 1 : 0;
      for (var oy = oy0; oy <= oy1; oy++)
        for (var ox = ox0; ox <= ox1; ox++)
          drawOne(x, it, ox * TS, oy * TS);
    }
  }
  A.wrapEach = wrapEach;

  /* 格点哈希。独立成函数而不是噪声内部的闭包——
     地面纹理要逐像素调用几十万次，闭包分配会直接吃掉几十毫秒。 */
  function n2h(a, b, seed, P) {
    if (P) {
      a = a % P; if (a < 0) a += P;
      b = b % P; if (b < 0) b += P;
    }
    var n = (a * 374761393 + b * 668265263 + (seed | 0) * 2246822519) | 0;
    n = (n ^ (n >>> 13)) * 1274126177 | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  /* 二维值噪声（0~1）：各向同性，用来替代会形成横向条纹的一维正弦/竖向渐变。
     P 为整数格点周期（可选）：给定时噪声在 P 个格点处精确重复，平铺无缝。 */
  function noise2(x, y, seed, P) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    /* 平滑插值，避免网格化 */
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a1 = n2h(xi, yi, seed, P), b1 = n2h(xi + 1, yi, seed, P);
    var c1 = n2h(xi, yi + 1, seed, P), d1 = n2h(xi + 1, yi + 1, seed, P);
    return (a1 * (1 - u) + b1 * u) * (1 - v) + (c1 * (1 - u) + d1 * u) * v;
  }
  A.noise2 = noise2;

  /* 分形噪声（多个倍频叠加，更自然） */
  function fbm2(x, y, seed, oct) {
    var s = 0, amp = 0.5, f = 1, norm = 0;
    for (var i = 0; i < (oct || 3); i++) {
      s += noise2(x * f, y * f, (seed || 0) + i * 131) * amp;
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return s / norm;
  }
  A.fbm2 = fbm2;

  /* 周期性分形噪声：坐标以"纹理像素"给出，在 TS 处精确重复。
     倍频固定用整数 2，保证每层格点周期 cells*2^i 都是整数（否则 P 取模会错位）。
     旧版把小瓦片内的本地坐标直接喂给 fbm2，边界处场不连续，
     平铺后每 16px 就出现一条接缝——这是地面网格感的根因。 */
  function fbm2p(px, py, TS, cells, oct, seed) {
    var s = 0, amp = 0.5, norm = 0, f = 1;
    for (var i = 0; i < (oct || 4); i++) {
      var P = cells * f;
      s += noise2(px / TS * P, py / TS * P, (seed || 0) + i * 131, P) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return s / norm;
  }
  A.fbm2p = fbm2p;

  /* 柔和投影 */
  function shadowEllipse(x, cx, cy, rx, ry, a) {
    var g = x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, 'rgba(0,0,0,' + (a == null ? 0.38 : a) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.save();
    x.translate(cx, cy);
    x.scale(1, ry / Math.max(rx, ry));
    x.translate(-cx, -cy);
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, Math.max(rx, ry), 0, 6.2832); x.fill();
    x.restore();
  }
  A.shadowEllipse = shadowEllipse;

  /* ============================================================
     三、瓦片（16×16 逻辑）
     ============================================================ */
  function tGrass(x, pal, v) {
    var r = rnd(v * 7919 + 101);
    var base = pal.ground;
    /* 平铺底色：禁止竖向渐变——每格一次明→暗的斜坡铺开后，
       整片草地会形成横向锯齿条纹（之前的"扫描线感"根因）。 */
    x.fillStyle = base; x.fillRect(0, 0, 16, 16);

    /* 各向同性斑驳：二维分形噪声，横纵分布对称，不会成带 */
    for (var py = 0; py < 16; py++) {
      for (var px = 0; px < 16; px++) {
        var nv = fbm2(px * 0.52, py * 0.52, v * 977 + 5, 3) - 0.5;
        if (nv > 0.13 || nv < -0.13) {
          x.fillStyle = alpha(shade(base, nv > 0 ? 0.10 : -0.11),
            Math.min(0.40, Math.abs(nv) * 1.15));
          x.fillRect(px, py, 1, 1);
        }
      }
    }
    /* 大尺度草色块（无缝环绕，跨格不露缝） */
    for (var i = 0; i < 5; i++) {
      x.fillStyle = alpha(shade(base, r() > 0.5 ? 0.08 : -0.09), 0.24);
      blobTiled(x, r() * 16, r() * 16, 2.2 + r() * 3.2, 0.8);
    }
    /* 亮草叶 */
    for (var b = 0; b < 16; b++) {
      var bx = r() * 16, by = 3.0 + r() * 12.5, hh = 1.2 + r() * 2.2;
      x.strokeStyle = alpha(pal.grass, 0.20 + r() * 0.26);
      x.lineWidth = 0.40;
      x.beginPath();
      x.moveTo(bx, by);
      x.quadraticCurveTo(bx + (r() - 0.5) * 0.8, by - hh * 0.6, bx + (r() - 0.5) * 1.6, by - hh);
      x.stroke();
    }
    /* 暗草叶（深度） */
    for (var b2 = 0; b2 < 9; b2++) {
      var bx2 = r() * 16, by2 = 5 + r() * 11, hh2 = 1 + r() * 1.6;
      x.strokeStyle = alpha(shade(pal.dark, -0.18), 0.22);
      x.lineWidth = 0.48;
      x.beginPath(); x.moveTo(bx2, by2); x.lineTo(bx2 + (r() - 0.5) * 1.4, by2 - hh2); x.stroke();
    }
    /* 偶发小花 */
    if (v === 2 || v === 5) {
      for (var f = 0; f < 2; f++) {
        var fx = 2.5 + r() * 11, fy = 2.5 + r() * 11;
        x.fillStyle = r() > 0.5 ? '#f2e6a8' : '#e8d8e4';
        blob(x, fx, fy, 0.95, 1);
        x.fillStyle = '#c9922e';
        x.fillRect(fx - 0.3, fy - 0.3, 0.6, 0.6);
      }
    }
    /* 苔藓小石 */
    if (v === 3) {
      x.fillStyle = alpha(shade(pal.rock, -0.25), 0.6);
      blob(x, 5.5, 10.5, 1.7, 0.8);
      x.fillStyle = alpha(shade(pal.rock, 0.12), 0.5);
      blob(x, 5.0, 9.8, 1.0, 0.8);
    }
    /* 草簇（少数变体上做高低起伏） */
    if (v === 1 || v === 4) {
      x.strokeStyle = alpha(shade(pal.grass, 0.16), 0.30);
      x.lineWidth = 0.55;
      var cx0 = 3 + r() * 10, cy0 = 4 + r() * 9;
      for (var k = 0; k < 5; k++) {
        x.beginPath();
        x.moveTo(cx0 + k * 0.7 - 1.4, cy0 + 1.4);
        x.quadraticCurveTo(cx0 + k * 0.7 - 1.8, cy0 - 1.2, cx0 + k * 0.7 - 2.4, cy0 - 2.2);
        x.stroke();
      }
    }
  }

  function tPath(x, pal, v) {
    var r = rnd(v * 6151 + 733);
    var base = '#9b8663';
    /* 同为平地瓦片：不用竖向渐变，改用二维噪声，避免与草地一样的横向条带 */
    x.fillStyle = base; x.fillRect(0, 0, 16, 16);

    for (var py = 0; py < 16; py++) {
      for (var px = 0; px < 16; px++) {
        var nv = fbm2(px * 0.58, py * 0.58, v * 613 + 29, 3) - 0.5;
        if (nv > 0.12 || nv < -0.12) {
          x.fillStyle = alpha(shade(base, nv > 0 ? 0.09 : -0.10),
            Math.min(0.38, Math.abs(nv) * 1.1));
          x.fillRect(px, py, 1, 1);
        }
      }
    }
    /* 夯土斑块（无缝） */
    for (var i = 0; i < 6; i++) {
      x.fillStyle = alpha(shade(base, r() > 0.5 ? 0.09 : -0.11), 0.34);
      blobTiled(x, r() * 16, r() * 16, 2.2 + r() * 3.0, 0.75);
    }
    /* 沙砾 */
    for (var d = 0; d < 34; d++) {
      x.fillStyle = alpha(r() > 0.5 ? '#c4b18c' : '#6f5f45', 0.40);
      x.fillRect(r() * 16, r() * 16, 0.9, 0.9);
    }
    /* 碎石（带接触影，避免"贴纸"感） */
    for (var s = 0; s < 4; s++) {
      var sx = 1.5 + r() * 13, sy = 1.5 + r() * 13, sr = 0.85 + r() * 1.4;
      x.fillStyle = alpha('#4f4436', 0.42); blob(x, sx + 0.2, sy + 0.6, sr * 1.10, 0.8);
      x.fillStyle = alpha('#5d5140', 0.60); blob(x, sx, sy + 0.35, sr * 1.02, 0.8);
      x.fillStyle = alpha('#bda98a', 0.80); blob(x, sx, sy - 0.25, sr * 0.80, 0.8);
      x.fillStyle = alpha('#e0d2b4', 0.45); blob(x, sx - sr * 0.22, sy - sr * 0.5, sr * 0.34, 0.9);
    }
    /* 车辙暗线 */
    x.strokeStyle = 'rgba(70,58,42,0.18)';
    x.lineWidth = 1.1;
    x.beginPath();
    var ly = 4 + r() * 8;
    x.moveTo(0, ly); x.quadraticCurveTo(8, ly + (r() - 0.5) * 2.4, 16, ly + (r() - 0.5) * 1.6);
    x.stroke();
  }

  function tTown(x, pal, v) {
    var r = rnd(v * 4831 + 211);
    /* 夯土底：城镇地面以泥土为主，石板只是散落的旧铺装，
       这样才不会有"整片砖墙"的观感。 */
    var earth = '#6a5f4e';
    x.fillStyle = earth; x.fillRect(0, 0, 16, 16);

    /* 大尺度土色变化：全部走"环绕软斑"，保证跨格无缝。
       逐像素噪声用本地坐标采样，平铺后场不连续，会留下规则接缝。 */
    for (var i = 0; i < 6; i++) {
      x.fillStyle = alpha(shade(earth, r() > 0.5 ? 0.10 : -0.13), 0.24 + r() * 0.16);
      blobTiled(x, r() * 16, r() * 16, 2.6 + r() * 3.6, 0.8);
    }
    /* 细粒：单像素，不构成接缝 */
    for (var g0 = 0; g0 < 40; g0++) {
      x.fillStyle = alpha(r() > 0.5 ? '#b9a688' : '#4a4034', 0.28);
      x.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 0.9, 0.9);
    }

    /* 石板：数量少、尺寸差异大 —— 才像村落的旧铺装，
       铺满一层的等大碎石反而会变成"鹅卵石噪音"。 */
    var base = '#8a857a';
    var n = 2 + Math.floor(r() * 2);
    var stones = [];
    for (var i = 0; i < n; i++) {
      stones.push({
        x: r() * 16, y: r() * 16,
        r: 3.2 + r() * 3.4,
        tone: -0.14 + r() * 0.22,
        sq: 0.62 + r() * 0.22,
        seed: i * 37 + v
      });
    }
    stones.forEach(function (s) {
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          var cx = s.x + ox * 16, cy = s.y + oy * 16;
          if (cx < -s.r || cx > 16 + s.r || cy < -s.r || cy > 16 + s.r) continue;
          /* 接触影（让石板"陷"进土里） */
          x.fillStyle = alpha('#332d1e', 0.26);
          blob(x, cx + 0.45, cy + 0.70, s.r * 1.04, s.sq);
          /* 石面基色 */
          x.fillStyle = shade(base, s.tone);
          blob(x, cx, cy, s.r, s.sq);
          /* 左上受光面（压低对比，否则每块石头都在"发光"） */
          x.fillStyle = alpha(shade(base, s.tone + 0.15), 0.70);
          blob(x, cx - s.r * 0.20, cy - s.r * 0.24, s.r * 0.60, s.sq);
          /* 右下背光面 */
          x.fillStyle = alpha(shade(base, s.tone - 0.20), 0.46);
          blob(x, cx + s.r * 0.26, cy + s.r * 0.30, s.r * 0.52, s.sq);
          /* 石面细斑（风蚀感） */
          var sr2 = rnd(s.seed * 977 + v * 31 + 7);
          for (var d2 = 0; d2 < 3; d2++) {
            x.fillStyle = alpha(sr2() > 0.5 ? '#ffffff' : '#4a4436', 0.11);
            blob(x, cx + (sr2() - 0.5) * s.r * 1.1, cy + (sr2() - 0.5) * s.r * 1.1,
              s.r * 0.16 + sr2() * s.r * 0.14, 0.9);
          }
        }
      }
    });

    /* 石缝苔痕 */
    for (var k = 0; k < 2; k++) {
      x.fillStyle = alpha('#4e6b4a', 0.18);
      blobTiled(x, r() * 16, r() * 16, 1.4 + r() * 1.6, 0.7);
    }
  }

  function tCave(x, pal, v) {
    var r = rnd(v * 3571 + 97);
    var base = mix(pal.rock, '#2c2a30', 0.52);
    /* 不用逐格径向渐变——那会在整片洞窟地面上留下规则的亮心网格 */
    x.fillStyle = base; x.fillRect(0, 0, 16, 16);
    for (var py = 0; py < 16; py++) {
      for (var px = 0; px < 16; px++) {
        var nv = fbm2(px * 0.62, py * 0.62, v * 421 + 13, 4) - 0.5;
        if (nv > 0.10 || nv < -0.10) {
          x.fillStyle = alpha(shade(base, nv > 0 ? 0.12 : -0.15),
            Math.min(0.46, Math.abs(nv) * 1.25));
          x.fillRect(px, py, 1, 1);
        }
      }
    }
    for (var i = 0; i < 5; i++) {
      x.fillStyle = alpha(shade(base, r() > 0.5 ? 0.09 : -0.13), 0.38);
      blobTiled(x, r() * 16, r() * 16, 2.2 + r() * 3, 0.8);
    }
    /* 裂纹 */
    for (var c = 0; c < 2; c++) {
      x.strokeStyle = alpha('#000000', 0.28);
      x.lineWidth = 0.6;
      var cx0 = r() * 16, cy0 = r() * 16;
      x.beginPath(); x.moveTo(cx0, cy0);
      for (var s = 0; s < 3; s++) {
        cx0 += (r() - 0.5) * 6; cy0 += (r() - 0.5) * 6;
        x.lineTo(cx0, cy0);
      }
      x.stroke();
    }
    /* 碎石（带影） */
    for (var p = 0; p < 5; p++) {
      var px = 1.5 + r() * 13, py = 1.5 + r() * 13;
      x.fillStyle = alpha('#0b0a0d', 0.45); blob(x, px + 0.2, py + 0.5, 1.4, 0.8);
      x.fillStyle = alpha(shade(base, -0.38), 0.62); blob(x, px, py + 0.25, 1.25, 0.8);
      x.fillStyle = alpha(shade(base, 0.26), 0.62); blob(x, px - 0.15, py - 0.25, 0.92, 0.8);
    }
    /* 微光矿点 */
    if (v === 1) {
      x.fillStyle = alpha('#8fd6e8', 0.55);
      x.fillRect(4.5, 11.5, 1, 1);
      x.fillRect(11, 5, 1, 1);
      x.fillStyle = alpha('#8fd6e8', 0.16);
      blob(x, 4.9, 11.9, 2.0, 0.9);
    }
  }

  var TILE = { grass: tGrass, path: tPath, town: tTown, cave: tCave };

  /* ============================================================
     三·五、地面大纹理（无缝周期，取代 16×16 小瓦片）

     小瓦片有两个无法调和的毛病：
       1) 瓦片内的逐像素噪声用本地坐标采样，边界场不连续 → 每 16px 一条缝；
       2) 任何大于 4px 的结构（草簇、卵石、石板）每 16px 精确重复一次 → 规则点阵。
     改成边长 224（14 格）的周期纹理后：缝彻底消失，重复周期从 36 屏幕px
     拉到 504 屏幕px —— 一屏之内看不到重复。
     ============================================================ */
  var GTS = 224;                     /* 必须是 16 的整数倍，便于按格取子矩形 */
  A.GROUND_TS = GTS;

  /* 不规则石片：顶点半径带种子的随机收缩 → 天然棱角，比正圆更像石头 */
  function rockPath(x, cx, cy, r, sq, seed, n, jag) {
    n = n || 9;
    jag = jag == null ? 0.24 : jag;
    var rr = rnd(seed * 2654435761 + 11);
    var rads = [];
    for (var i = 0; i < n; i++) rads.push(1 - jag * rr());
    x.beginPath();
    for (var j = 0; j <= n; j++) {
      var k = j % n;
      var a = j / n * 6.2832;
      var rad = r * rads[k];
      var px = cx + Math.cos(a) * rad;
      var py = cy + Math.sin(a) * rad * (sq == null ? 1 : sq);
      if (j === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
  }

  /* 逐像素斑驳：周期噪声，天然跨边界连续。
     走 ImageData 直接写像素——逐像素 fillRect 有调用开销，
     224² 张纹理上就是几万次 canvas 调用，会拖到 100ms 量级。 */
  function speckle(x, TS, base, seed, cells, oct, hi, lo, thr, amt) {
    var W = Math.round(TS * K);
    var im = x.getImageData(0, 0, W, W);
    var d = im.data;
    var hiC = parseColor(shade(base, hi));
    var loC = parseColor(shade(base, lo));
    for (var py = 0; py < TS; py++) {
      for (var px = 0; px < TS; px++) {
        var nv = fbm2p(px, py, TS, cells, oct, seed) - 0.5;
        if (nv <= thr && nv >= -thr) continue;
        var tgt = nv > 0 ? hiC : loC;
        var a = Math.min(amt, Math.abs(nv) * 1.15);
        var ia = 1 - a;
        var oy0 = py * K, ox0 = px * K;
        for (var dy = 0; dy < K; dy++) {
          var row = ((oy0 + dy) * W + ox0) * 4;
          for (var dx = 0; dx < K; dx++) {
            var o = row + dx * 4;
            d[o] = d[o] * ia + tgt[0] * a;
            d[o + 1] = d[o + 1] * ia + tgt[1] * a;
            d[o + 2] = d[o + 2] * ia + tgt[2] * a;
            d[o + 3] = 255;
          }
        }
      }
    }
    x.putImageData(im, 0, 0);
  }

  /* 大尺度色块：环绕软斑 */
  function patches(x, TS, base, r, count, rmin, rmax, sq) {
    for (var i = 0; i < count; i++) {
      x.fillStyle = alpha(shade(base, r() > 0.5 ? 0.09 : -0.11), 0.18 + r() * 0.16);
      blobTiled(x, r() * TS, r() * TS, rmin + r() * (rmax - rmin), sq || 0.85, TS);
    }
  }

  /* 噪声阈值撒点：一次 ImageData 写完，避免逐点 fillRect。
     pick(px,py) 返回 0 跳过 / 1 用 c1 / 2 用 c2。 */
  function dotLayer(x, TS, c1, c2, a, pick) {
    var W = Math.round(TS * K);
    var im = x.getImageData(0, 0, W, W), d = im.data;
    var t1 = parseColor(c1), t2 = parseColor(c2), ia = 1 - a;
    for (var py = 0; py < TS; py++) {
      for (var px = 0; px < TS; px++) {
        var code = pick(px, py);
        if (!code) continue;
        var tgt = code === 1 ? t1 : t2;
        var oy0 = py * K, ox0 = px * K;
        for (var dy = 0; dy < K; dy++) {
          var row = ((oy0 + dy) * W + ox0) * 4;
          for (var dx = 0; dx < K; dx++) {
            var o = row + dx * 4;
            d[o] = d[o] * ia + tgt[0] * a;
            d[o + 1] = d[o + 1] * ia + tgt[1] * a;
            d[o + 2] = d[o + 2] * ia + tgt[2] * a;
            d[o + 3] = 255;
          }
        }
      }
    }
    x.putImageData(im, 0, 0);
  }

  /* ---------- 草地 ---------- */
  function gGrass(x, pal) {
    var TS = GTS, r = rnd(9001), base = pal.ground;
    x.fillStyle = base; x.fillRect(0, 0, TS, TS);
    speckle(x, TS, base, 5, 12, 4, 0.13, -0.15, 0.08, 0.46);
    patches(x, TS, base, r, 30, 8, 30, 0.85);

    /* 草叶：样式在生成时算好，绘制时不再拼字符串 */
    var blades = [];
    for (var b = 0; b < 230; b++) {
      var bh = 2.4 + r() * 5.4, bdark = r() > 0.60, ba = 0.14 + r() * 0.22;
      blades.push({
        x: r() * TS, y: r() * TS, h: bh, s: (r() - 0.5) * 2.0,
        style: bdark ? alpha(shade(pal.dark, -0.16), ba * 0.85) : alpha(pal.grass, ba),
        w: 0.42 + bh * 0.05, rad: bh + 2.2
      });
    }
    wrapEach(x, TS, blades, function (o) { return o.rad; }, function (xx, o, ox, oy) {
      xx.strokeStyle = o.style;
      xx.lineWidth = o.w;
      xx.beginPath();
      xx.moveTo(o.x + ox, o.y + oy);
      xx.quadraticCurveTo(o.x + ox + o.s * 0.5, o.y + oy - o.h * 0.62,
        o.x + ox + o.s, o.y + oy - o.h);
      xx.stroke();
    });

    /* 草簇：成丛才有"草丛"的读感，单根草叶只是噪点 */
    var tufts = [];
    for (var t = 0; t < 30; t++) {
      var tk = 5 + Math.floor(r() * 3), tsc = 0.85 + r() * 0.6;
      tufts.push({
        x: r() * TS, y: r() * TS, k: tk, sc: tsc,
        style: alpha(r() > 0.5 ? shade(pal.grass, 0.18) : shade(pal.dark, -0.10), 0.30),
        rad: 2.6 * tsc + 3
      });
    }
    wrapEach(x, TS, tufts, function (o) { return o.rad; }, function (xx, o, ox, oy) {
      xx.strokeStyle = o.style;
      xx.lineWidth = 0.55;
      for (var k = 0; k < o.k; k++) {
        var bx = o.x + ox + k * 0.72 - o.k * 0.36;
        xx.beginPath();
        xx.moveTo(bx, o.y + oy + 1.5);
        xx.quadraticCurveTo(bx - 0.5, o.y + oy - 1.3 * o.sc, bx - 1.2, o.y + oy - 2.4 * o.sc);
        xx.stroke();
      }
    });

    /* 偶发小花 */
    var fl = [];
    for (var f = 0; f < 14; f++) fl.push({ x: r() * TS, y: r() * TS, c: r() > 0.5 ? '#f2e6a8' : '#e8d8e4' });
    wrapEach(x, TS, fl, 3, function (xx, o, ox, oy) {
      xx.fillStyle = o.c;
      blob(xx, o.x + ox, o.y + oy, 1.0, 1);
      xx.fillStyle = '#c9922e';
      xx.fillRect(o.x + ox - 0.3, o.y + oy - 0.3, 0.6, 0.6);
    });

    /* 苔藓小石：给草地一点体积，否则纯平 */
    var st = [];
    for (var s = 0; s < 9; s++) st.push({ x: r() * TS, y: r() * TS, rr: 1.5 + r() * 2.0 });
    wrapEach(x, TS, st, function (o) { return o.rr * 1.7; }, function (xx, o, ox, oy) {
      xx.fillStyle = alpha('#3d4a34', 0.30); blob(xx, o.x + ox + 0.3, o.y + oy + 0.7, o.rr * 1.05, 0.8);
      xx.fillStyle = alpha(shade(pal.rock, -0.20), 0.55); blob(xx, o.x + ox, o.y + oy, o.rr, 0.8);
      xx.fillStyle = alpha(shade(pal.rock, 0.16), 0.45); blob(xx, o.x + ox - 0.3, o.y + oy - 0.35, o.rr * 0.55, 0.9);
    });
  }

  /* ---------- 土路 ---------- */
  function gPath(x, pal) {
    var TS = GTS, r = rnd(6151), base = '#9b8663';
    x.fillStyle = base; x.fillRect(0, 0, TS, TS);
    speckle(x, TS, base, 29, 13, 4, 0.09, -0.11, 0.10, 0.38);
    patches(x, TS, base, r, 24, 8, 26, 0.78);

    /* 沙砾：噪声阈值撒点，不是逐格手撒 → 无重复感 */
    dotLayer(x, TS, '#cfbe9a', '#6f5f45', 0.42, function (px, py) {
      var gv = fbm2p(px, py, TS, 46, 2, 71);
      if (gv <= 0.735) return 0;
      return gv > 0.80 ? 1 : 2;
    });

    /* 碎石：接触影 + 受光面 + 背光面，三层才不像贴纸 */
    var st = [];
    for (var s = 0; s < 30; s++) {
      st.push({ x: 4 + r() * (TS - 8), y: 4 + r() * (TS - 8), rr: 1.1 + r() * 2.1, sq: 0.66 + r() * 0.26 });
    }
    wrapEach(x, TS, st, function (o) { return o.rr * 1.8; }, function (xx, o, ox, oy) {
      var bx = o.x + ox, by = o.y + oy;
      xx.fillStyle = alpha('#4f4436', 0.40); blob(xx, bx + 0.25, by + 0.65, o.rr * 1.10, o.sq);
      xx.fillStyle = alpha('#5d5140', 0.58); blob(xx, bx, by + 0.35, o.rr * 1.02, o.sq);
      xx.fillStyle = alpha('#bda98a', 0.78); blob(xx, bx, by - 0.25, o.rr * 0.80, o.sq);
      xx.fillStyle = alpha('#e0d2b4', 0.42); blob(xx, bx - o.rr * 0.22, by - o.rr * 0.5, o.rr * 0.34, 0.9);
    });
  }

  /* ---------- 村镇夯土 + 旧石板 ---------- */
  function gTown(x, pal) {
    var TS = GTS, r = rnd(4831);
    var earth = '#6a5f4e';
    x.fillStyle = earth; x.fillRect(0, 0, TS, TS);
    patches(x, TS, earth, r, 34, 8, 30, 0.82);
    speckle(x, TS, earth, 13, 16, 3, 0.11, -0.13, 0.10, 0.30);
    /* 第二种尺度的斑驳：单一尺度会读成"平涂" */
    speckle(x, TS, earth, 61, 5, 3, 0.09, -0.11, 0.12, 0.22);

    /* 旧石板：7 块，尺寸差异大、朝向随机 —— 稀疏铺装，不是满铺砖墙 */
    var slabs = [];
    for (var i = 0; i < 7; i++) {
      var sr = rnd((i * 91 + 17) * 977 + 7);
      var sp = [];
      for (var d = 0; d < 5; d++) {
        sp.push({ dx: (sr() - 0.5) * 1.1, dy: (sr() - 0.5) * 1.1, rr: 0.14 + sr() * 0.14, hi: sr() > 0.5 });
      }
      slabs.push({
        x: r() * TS, y: r() * TS, rr: 7 + r() * 9.5,
        sq: 0.62 + r() * 0.24, tone: -0.15 + r() * 0.24, sd: i * 91 + 17,
        n: 8 + Math.floor(r() * 4), sp: sp
      });
    }
    var stoneBase = '#8a857a';
    wrapEach(x, TS, slabs, function (o) { return o.rr * 1.6; }, function (xx, o, ox, oy) {
      var bx = o.x + ox, by = o.y + oy;
      /* 接触影：让石板"陷"进土里 */
      xx.fillStyle = alpha('#332d1e', 0.30);
      rockPath(xx, bx + 0.7, by + 1.0, o.rr * 1.05, o.sq, o.sd, o.n, 0.22); xx.fill();
      /* 石面基色 */
      xx.fillStyle = shade(stoneBase, o.tone);
      rockPath(xx, bx, by, o.rr, o.sq, o.sd, o.n, 0.22); xx.fill();
      /* 左上受光面 */
      xx.fillStyle = alpha(shade(stoneBase, o.tone + 0.16), 0.72);
      rockPath(xx, bx - o.rr * 0.20, by - o.rr * 0.24, o.rr * 0.60, o.sq, o.sd + 5, o.n, 0.18); xx.fill();
      /* 右下背光面 */
      xx.fillStyle = alpha(shade(stoneBase, o.tone - 0.22), 0.48);
      rockPath(xx, bx + o.rr * 0.26, by + o.rr * 0.30, o.rr * 0.52, o.sq, o.sd + 9, o.n, 0.18); xx.fill();
      /* 风蚀细斑 */
      for (var e = 0; e < o.sp.length; e++) {
        var q = o.sp[e];
        xx.fillStyle = alpha(q.hi ? '#ffffff' : '#4a4436', 0.10);
        blob(xx, bx + q.dx * o.rr, by + q.dy * o.rr, o.rr * q.rr, 0.9);
      }
    });

    /* 石板旁的碎屑与缝隙苔痕 */
    var bits = [];
    for (var b = 0; b < 34; b++) bits.push({ x: r() * TS, y: r() * TS, rr: 0.7 + r() * 1.3 });
    wrapEach(x, TS, bits, function (o) { return o.rr * 1.6; }, function (xx, o, ox, oy) {
      xx.fillStyle = alpha('#40382a', 0.34); blob(xx, o.x + ox + 0.2, o.y + oy + 0.45, o.rr, 0.8);
      xx.fillStyle = alpha('#9d9689', 0.55); blob(xx, o.x + ox, o.y + oy, o.rr * 0.85, 0.8);
    });
    var moss = [];
    for (var k = 0; k < 7; k++) moss.push({ x: r() * TS, y: r() * TS, rr: 2.0 + r() * 3.2 });
    wrapEach(x, TS, moss, function (o) { return o.rr + 1; }, function (xx, o, ox, oy) {
      xx.fillStyle = alpha('#4e6b4a', 0.16);
      blob(xx, o.x + ox, o.y + oy, o.rr, 0.7);
    });
  }

  /* ---------- 室内木地板 ---------- */
  function gFloor(x, pal) {
    var TS = GTS, r = rnd(9113);
    var wood = '#6b5136', dark = '#42301f', hi = '#84673f';
    x.fillStyle = wood; x.fillRect(0, 0, TS, TS);

    /* 横向长板：板高固定 16（= 1 格），铺起来不会有半格错位 */
    for (var row = 0; row < TS / 16; row++) {
      var y0 = row * 16;
      x.fillStyle = shade(wood, -0.06 + r() * 0.13);
      x.fillRect(0, y0, TS, 16);
      /* 板缝：下缘投影 + 上缘受光 */
      x.fillStyle = alpha(dark, 0.55);
      x.fillRect(0, y0 + 15.1, TS, 0.9);
      x.fillStyle = alpha(hi, 0.20);
      x.fillRect(0, y0, TS, 0.7);
      /* 木纹：细长曲线，越靠板中越淡 */
      for (var g = 0; g < 6; g++) {
        var gy = y0 + 1.8 + r() * 12.4;
        var gx = r() * TS, gl = 16 + r() * 44;
        x.strokeStyle = alpha(dark, 0.10 + r() * 0.13);
        x.lineWidth = 0.45 + r() * 0.5;
        x.beginPath();
        x.moveTo(gx, gy);
        x.bezierCurveTo(gx + gl * 0.32, gy - 1.2, gx + gl * 0.68, gy + 1.2, gx + gl, gy);
        x.stroke();
      }
      /* 竖向断板缝：每行错开，否则整片读成"满铺条纹" */
      var seams = 2 + Math.floor(r() * 3);
      for (var s2 = 0; s2 < seams; s2++) {
        var sx = r() * TS;
        x.fillStyle = alpha(dark, 0.40);
        x.fillRect(sx, y0 + 0.6, 0.7, 14.5);
      }
    }

    /* 木节 */
    var knots = [];
    for (var k = 0; k < 5; k++) knots.push({ x: r() * TS, y: r() * TS, rr: 1.1 + r() * 1.6 });
    wrapEach(x, TS, knots, function (o) { return o.rr * 2.2; }, function (xx, o, ox, oy) {
      xx.fillStyle = alpha(dark, 0.42);
      blob(xx, o.x + ox, o.y + oy, o.rr, 0.82);
      xx.fillStyle = alpha('#8f6d46', 0.30);
      blob(xx, o.x + ox - o.rr * 0.26, o.y + oy - o.rr * 0.26, o.rr * 0.5, 0.82);
    });

    /* 陈年磨损与浮尘 */
    speckle(x, TS, wood, 23, 10, 2.5, 0.08, -0.10, 0.10, 0.20);
    speckle(x, TS, wood, 71, 3, 2, 0.06, -0.07, 0.14, 0.14);
  }

  /* ---------- 洞窟 ---------- */
  /* 洞窟地面公共体：cave 与 bloodcave 只差**基色**与**矿点辉光色**，
     流程逐字相同（M1 §5.1：bloodcave 复用 cave 纹理流程、基色 #5a3a3c）。 */
  function gCaveBody(x, pal, base, glow) {
    var TS = GTS, r = rnd(3571);
    x.fillStyle = base; x.fillRect(0, 0, TS, TS);
    speckle(x, TS, base, 13, 14, 4, 0.12, -0.15, 0.10, 0.46);
    patches(x, TS, base, r, 24, 8, 28, 0.82);

    /* 裂纹：短步长折线 + 受光边。
       旧版步长 ±26、5 个点连成长直线段，alpha 又高，
       在洞里读成几条黑色涂鸦，而不是裂缝。 */
    var cracks = [];
    for (var c = 0; c < 14; c++) {
      var pts = [], cx0 = r() * TS, cy0 = r() * TS, ang = r() * 6.2832;
      for (var s = 0; s < 7; s++) {
        pts.push([cx0, cy0]);
        ang += (r() - 0.5) * 1.5;
        cx0 += Math.cos(ang) * (4 + r() * 8);
        cy0 += Math.sin(ang) * (4 + r() * 8);
      }
      cracks.push(pts);
    }
    wrapEach(x, TS, cracks, function (p) { return 40; }, function (xx, p, ox, oy) {
      xx.lineCap = 'round';
      xx.lineWidth = 0.5;
      xx.strokeStyle = alpha(shade(base, 0.24), 0.15);   /* 受光边 */
      xx.beginPath(); xx.moveTo(p[0][0] + ox + 0.5, p[0][1] + oy + 0.6);
      for (var i = 1; i < p.length; i++) xx.lineTo(p[i][0] + ox + 0.5, p[i][1] + oy + 0.6);
      xx.stroke();
      xx.strokeStyle = alpha('#000000', 0.20);           /* 暗缝 */
      xx.beginPath(); xx.moveTo(p[0][0] + ox, p[0][1] + oy);
      for (var j = 1; j < p.length; j++) xx.lineTo(p[j][0] + ox, p[j][1] + oy);
      xx.stroke();
    });

    /* 碎石 */
    var rub = [];
    for (var p2 = 0; p2 < 26; p2++) rub.push({ x: r() * TS, y: r() * TS, rr: 1.1 + r() * 2.2 });
    wrapEach(x, TS, rub, function (o) { return o.rr * 1.6; }, function (xx, o, ox, oy) {
      var bx = o.x + ox, by = o.y + oy;
      xx.fillStyle = alpha('#0b0a0d', 0.44); blob(xx, bx + 0.3, by + 0.6, o.rr * 1.10, 0.8);
      xx.fillStyle = alpha(shade(base, -0.38), 0.60); blob(xx, bx, by + 0.25, o.rr, 0.8);
      xx.fillStyle = alpha(shade(base, 0.26), 0.60); blob(xx, bx - 0.2, by - 0.3, o.rr * 0.74, 0.8);
    });

    /* 微光矿点：洞窟里唯一的冷色，起呼吸感。血洞换成暖红（血煞教据点）。 */
    var gl = [];
    for (var g0 = 0; g0 < 5; g0++) gl.push({ x: r() * TS, y: r() * TS });
    wrapEach(x, TS, gl, 6, function (xx, o, ox, oy) {
      xx.fillStyle = alpha(glow[0], 0.14); blob(xx, o.x + ox, o.y + oy, 4.2, 0.9);
      xx.fillStyle = alpha(glow[0], 0.40); blob(xx, o.x + ox, o.y + oy, 1.6, 0.9);
      xx.fillStyle = alpha(glow[1], 0.70); blob(xx, o.x + ox - 0.3, o.y + oy - 0.3, 0.8, 1);
    });
  }

  function gCave(x, pal) {
    gCaveBody(x, pal, mix(pal.rock, '#2c2a30', 0.52), ['#8fd6e8', '#d8f4ff']);
  }

  /* M1 §5.1：血煞外堂据点地面。基色固定 #5a3a3c（不跟世界调色板走 ——
     这是"血煞教的地盘"，换到哪一界都该是这个色）。 */
  function gBloodcave(x, pal) {
    gCaveBody(x, pal, mix('#5a3a3c', '#2a1a1e', 0.42), ['#e8846a', '#ffd9c4']);
  }

  /* 大尺度明暗图：与地面纹理同尺寸、1:1 绘制。
     以前在 explore.js 里逐格 fillRect 叠明暗，整片地面会布满 16px 方块补丁；
     改成低频图后，如果放大平铺，边缘像素被钳制又会在每块边界留一条直缝，
     所以这里直接按 GTS 烘焙，不做任何缩放。 */
  function gShade(x, pal) {
    var TS = GTS;
    var W = Math.round(TS * K);
    var im = x.getImageData(0, 0, W, W), d = im.data;
    for (var py = 0; py < TS; py++) {
      for (var px = 0; px < TS; px++) {
        var v = fbm2p(px, py, TS, 4, 3, 401) - 0.5;
        var a = 0, r = 0, g = 0, b = 0;
        if (v > 0.030) { a = Math.min(0.125, v * 0.72); r = 255; g = 250; b = 232; }
        else if (v < -0.030) { a = Math.min(0.135, -v * 0.78); r = 10; g = 14; b = 24; }
        else continue;
        /* 这张图是"叠加层"，本身透明：颜色写纯色、alpha 写 a。
           若把 alpha 写满 255，叠到地面上就是一整片不透明的黑斑。 */
        var av = Math.round(a * 255);
        var oy0 = py * K, ox0 = px * K;
        for (var dy = 0; dy < K; dy++) {
          var row = ((oy0 + dy) * W + ox0) * 4;
          for (var dx = 0; dx < K; dx++) {
            var o = row + dx * 4;
            d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = av;
          }
        }
      }
    }
    x.putImageData(im, 0, 0);
  }

  A.shadeTex = function (kind, pal) {
    var key = 's|' + kind + '|' + pal.ground;
    return cached(key, GTS, GTS, function (x) { gShade(x, pal); }).c;
  };

  /* 预热：地面纹理首次烘焙约 30~50ms。放在标题界面用空闲时间逐张做掉，
     玩家第一次进镇/进洞就不会顿一下。 */
  A.warmup = function (pal) {
    if (!pal) return;
    var jobs = [];
    ['grass', 'path', 'town', 'cave', 'floor', 'bloodcave'].forEach(function (k) {
      jobs.push(function () { A.groundTex(k, pal); });
      jobs.push(function () { A.shadeTex(k, pal); });
    });
    var idle = (typeof window !== 'undefined' && window.requestIdleCallback)
      ? function (fn) { window.requestIdleCallback(fn, { timeout: 900 }); }
      : function (fn) { if (typeof setTimeout === 'function') setTimeout(fn, 260); };
    (function next() {
      if (!jobs.length) return;
      jobs.shift()();
      idle(next);
    })();
  };

  var GROUND = { grass: gGrass, path: gPath, town: gTown, cave: gCave,
    floor: gFloor, bloodcave: gBloodcave };

  /* 取地面大纹理（逻辑 GTS×GTS，内部 K 倍超采样） */
  var GTS_MARK = [];
  A.groundTex = function (kind, pal) {
    var im = G.Assets.img('ground.' + kind);
    if (im) return im;
    var key = 'g|' + kind + '|' + pal.ground + '|' + pal.rock;
    var o = cached(key, GTS, GTS, function (x) {
      (GROUND[kind] || gGrass)(x, pal);
    });
    if (GTS_MARK.indexOf(o.c) < 0) GTS_MARK.push(o.c);
    return o.c;
  };

  /* 按世界坐标取 16×16 子块绘制：相邻格共享同一张纹理 → 跨格完全连续 */
  A.groundBlit = function (x, kind, pal, sx, sy, dx, dy) {
    var c = A.groundTex(kind, pal);
    if (GTS_MARK.indexOf(c) < 0) {   /* 外部素材：退化为整图缩放 */
      x.drawImage(c, Math.round(dx), Math.round(dy), 16, 16);
      return;
    }
    var k = c.width / GTS;
    x.drawImage(c, Math.round(sx * k), Math.round(sy * k), Math.round(16 * k), Math.round(16 * k),
      Math.round(dx), Math.round(dy), 16, 16);
  };

  /* 取瓦片：素材优先 */
  A.tile = function (kind, v, pal) {
    var im = G.Assets.img('tile.' + kind + '.' + v);
    if (im) return im;
    var key = 't|' + kind + '|' + v + '|' + pal.ground;
    return cached(key, 16, 16, function (x) {
      (TILE[kind] || tGrass)(x, pal, v);
    }).c;
  };

  /* ---- 地形过渡：路径/石板与草地交界处的自然镶边（16 种方向组合） ---- */
  var FRINGE = {};
  A.fringe = function (mask, from, to, pal) {
    if (!mask) return null;
    var key = 'f|' + mask + '|' + from + '|' + to + '|' + pal.ground;
    if (FRINGE[key]) return FRINGE[key];
    var o = cv(16, 16);
    var x = o.x;
    var r = rnd(mask * 977 + 31);
    var tone = to === 'grass' ? pal.grass : (to === 'path' ? '#a08a66' : '#8f8a7e');
    var dark = to === 'grass' ? pal.dark : '#6d6152';

    function edge(side) {
      var n = 6;
      for (var i = 0; i < n; i++) {
        var t = (i + 0.5) / n * 16 + (r() - 0.5) * 2;
        var d = 0.9 + r() * 1.9;
        var px, py, w, h;
        if (side === 'n') { px = t - 1.1; py = 0; w = 2.2 + r(); h = d; }
        else if (side === 's') { px = t - 1.1; py = 16 - d; w = 2.2 + r(); h = d; }
        else if (side === 'w') { px = 0; py = t - 1.1; w = d; h = 2.2 + r(); }
        else { px = 16 - d; py = t - 1.1; w = d; h = 2.2 + r(); }
        x.fillStyle = alpha(dark, 0.42);
        x.fillRect(px, py, w, h);
        x.fillStyle = alpha(tone, 0.62);
        var px2 = side === 'w' ? px : side === 'e' ? px + 0.35 : px + 0.25;
        var py2 = side === 'n' ? py : side === 's' ? py + 0.35 : py + 0.25;
        x.fillRect(px2, py2, Math.max(0.6, w - 0.6), Math.max(0.6, h - 0.6));
      }
      /* 边缘散草 */
      if (to === 'grass') {
        for (var g = 0; g < 5; g++) {
          var gt = r() * 16;
          var gx = side === 'w' ? 0.5 : side === 'e' ? 15.5 : gt;
          var gy = side === 'n' ? 0.5 : side === 's' ? 15.5 : gt;
          if (side === 'w' || side === 'e') gy = gt; else gx = gt;
          x.strokeStyle = alpha(pal.grass, 0.45);
          x.lineWidth = 0.5;
          x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + (r() - 0.5) * 1.4, gy - 1 - r()); x.stroke();
        }
      }
    }
    if (mask & 1) edge('n');
    if (mask & 2) edge('e');
    if (mask & 4) edge('s');
    if (mask & 8) edge('w');

    FRINGE[key] = o.c;
    return o.c;
  };

  /* ============================================================
     四、建筑
     ============================================================ */
  /* 国风屋顶：横向瓦垄 + 正脊 + 起翘飞檐 */
  function roofTiles(x, x0, y0, w, h, col) {
    var rows = Math.max(2, Math.round(h / 3.2));
    var rh = h / rows;
    for (var i = 0; i < rows; i++) {
      var y = y0 + i * rh;
      x.fillStyle = shade(col, 0.06 - i * 0.045);
      x.fillRect(x0, y, w, rh + 0.4);
      /* 瓦垄竖纹 */
      x.fillStyle = alpha('#000000', 0.16);
      for (var gx = x0 + 1.4; gx < x0 + w; gx += 3.1) {
        x.fillRect(gx, y, 0.7, rh);
      }
      x.fillStyle = alpha('#ffffff', 0.09);
      for (var gx2 = x0 + 2.8; gx2 < x0 + w; gx2 += 3.1) {
        x.fillRect(gx2, y, 0.55, rh);
      }
      /* 行间阴影 */
      x.fillStyle = alpha('#000000', 0.22);
      x.fillRect(x0, y + rh - 0.55, w, 0.55);
    }
    /* 正脊 */
    x.fillStyle = shade(col, 0.18);
    x.fillRect(x0 - 1, y0 - 1.4, w + 2, 2.2);
    x.fillStyle = alpha('#000000', 0.25);
    x.fillRect(x0 - 1, y0 + 0.8, w + 2, 0.7);
  }

  A.house = function (s, pal) {
    var W = s.w * 16, H = s.h * 16;
    var im = G.Assets.img('struct.house');
    if (im) return { c: im, ox: 0, oy: 0, w: W, h: H };
    var ox = -12, oy = -8;
    var key = 'h|' + W + '|' + H + '|' + s.roof;
    var o = cached(key, W + 24, H + 16, function (x) {
      x.translate(12, 8);
      var roofCol = s.roof || '#6b5a4a';
      var wallH = Math.max(18, H - 34);

      /* 投影 */
      shadowEllipse(x, W / 2, H + 1.5, W * 0.52, 6, 0.34);

      /* 墙体（夯土 + 木骨） */
      var wy = 30;
      var wg = x.createLinearGradient(0, wy, 0, wy + wallH);
      wg.addColorStop(0, '#c9b190');
      wg.addColorStop(1, '#a08a6c');
      x.fillStyle = wg;
      x.fillRect(0, wy, W, wallH);
      /* 土墙斑驳 */
      var r = rnd(W * 13 + H);
      for (var i = 0; i < Math.floor(W / 5); i++) {
        x.fillStyle = alpha(r() > 0.5 ? '#8d7758' : '#d8c4a4', 0.22);
        blob(x, r() * W, wy + r() * wallH, 1.8 + r() * 3, 0.8);
      }
      /* 木柱 */
      x.fillStyle = '#6b4f34';
      x.fillRect(0, wy, 3, wallH);
      x.fillRect(W - 3, wy, 3, wallH);
      x.fillStyle = alpha('#a07a4e', 0.8);
      x.fillRect(0.5, wy, 1, wallH);
      x.fillRect(W - 2.5, wy, 1, wallH);
      /* 墙裙 */
      x.fillStyle = '#7d6a4e';
      x.fillRect(0, wy + wallH - 5, W, 5);
      x.fillStyle = alpha('#000000', 0.22);
      x.fillRect(0, wy + wallH - 5.6, W, 0.8);

      /* 屋顶（含飞檐） */
      var eave = 5;
      roofTiles(x, -eave, 0, W + eave * 2, 30, roofCol);
      /* 起翘飞檐 */
      x.fillStyle = shade(roofCol, 0.12);
      x.beginPath();
      x.moveTo(-eave, 28);
      x.quadraticCurveTo(-eave - 5, 26, -eave - 6.5, 20);
      x.lineTo(-eave - 3, 20);
      x.quadraticCurveTo(-eave - 2, 25, -eave + 2, 28);
      x.closePath(); x.fill();
      x.beginPath();
      x.moveTo(W + eave, 28);
      x.quadraticCurveTo(W + eave + 5, 26, W + eave + 6.5, 20);
      x.lineTo(W + eave + 3, 20);
      x.quadraticCurveTo(W + eave + 2, 25, W + eave - 2, 28);
      x.closePath(); x.fill();
      /* 檐下阴影 */
      var sg = x.createLinearGradient(0, 30, 0, 42);
      sg.addColorStop(0, 'rgba(0,0,0,0.38)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = sg;
      x.fillRect(0, 30, W, 12);

      /* 门 */
      var dw = 14, dh = 20;
      var dx = W / 2 - dw / 2;
      var dy = wy + wallH - dh;
      x.fillStyle = '#3d2c1e';
      x.fillRect(dx - 1, dy - 1, dw + 2, dh + 1);
      var dg = x.createLinearGradient(dx, 0, dx + dw, 0);
      dg.addColorStop(0, '#6d4f34');
      dg.addColorStop(0.5, '#8a6642');
      dg.addColorStop(1, '#5d432c');
      x.fillStyle = dg;
      x.fillRect(dx, dy, dw, dh);
      x.fillStyle = alpha('#000000', 0.3);
      x.fillRect(dx + dw / 2 - 0.4, dy, 0.8, dh);
      /* 门环 */
      x.fillStyle = '#d8b768';
      x.fillRect(dx + 3, dy + 9, 1.6, 1.6);
      x.fillRect(dx + dw - 4.6, dy + 9, 1.6, 1.6);

      /* 窗（暖光） */
      var winY = wy + 8;
      [-1, 1].forEach(function (dir) {
        var wx = dir < 0 ? 8 : W - 20;
        x.fillStyle = '#4a3626';
        x.fillRect(wx - 1, winY - 1, 14, 11);
        var lg = x.createLinearGradient(0, winY, 0, winY + 9);
        lg.addColorStop(0, '#f6dc9a');
        lg.addColorStop(1, '#d9a951');
        x.fillStyle = lg;
        x.fillRect(wx, winY, 12, 9);
        x.strokeStyle = 'rgba(90,60,30,0.75)';
        x.lineWidth = 0.7;
        x.beginPath();
        x.moveTo(wx + 6, winY); x.lineTo(wx + 6, winY + 9);
        x.moveTo(wx, winY + 4.5); x.lineTo(wx + 12, winY + 4.5);
        x.stroke();
      });
    });
    return { c: o.c, ox: ox, oy: oy, w: W + 24, h: H + 16 };
  };

  A.ruin = function (s, pal) {
    var W = s.w * 16, H = s.h * 16;
    var im = G.Assets.img('struct.ruin');
    if (im) return { c: im, ox: 0, oy: 0, w: W, h: H };
    var ox = -8, oy = -8;
    var key = 'r|' + W + '|' + H;
    var o = cached(key, W + 16, H + 16, function (x) {
      x.translate(8, 8);
      shadowEllipse(x, W / 2, H + 1, W * 0.5, 5, 0.32);

      /* 残墙 */
      var wy = 16;
      var wg = x.createLinearGradient(0, wy, 0, H);
      wg.addColorStop(0, '#8d8880');
      wg.addColorStop(1, '#5f5b55');
      x.fillStyle = wg;
      x.fillRect(0, wy, W, H - wy);
      /* 砖缝 */
      x.strokeStyle = 'rgba(40,38,36,0.45)';
      x.lineWidth = 0.6;
      for (var by = wy + 5; by < H; by += 6) {
        x.beginPath(); x.moveTo(0, by); x.lineTo(W, by); x.stroke();
      }
      for (var bx = 6; bx < W; bx += 11) {
        x.beginPath(); x.moveTo(bx, wy); x.lineTo(bx, H); x.stroke();
      }
      /* 缺口（残破感） */
      var r = rnd(W * 7 + H * 3);
      x.clearRect(W * 0.12, wy, 7, 7);
      x.clearRect(W * 0.78, wy + 2, 9, 6);
      /* 苔藓 */
      for (var i = 0; i < Math.floor(W / 4); i++) {
        x.fillStyle = alpha('#5d7a52', 0.30);
        blob(x, r() * W, wy + r() * (H - wy), 1.4 + r() * 2.4, 0.7);
      }
      /* 破顶 */
      roofTiles(x, -4, 0, W + 8, 18, '#6a6259');
      x.fillStyle = alpha('#000000', 0.4);
      x.fillRect(-4, 15, W + 8, 5);
      /* 残破的顶：削掉一角 */
      x.clearRect(W * 0.55, 0, W * 0.45, 6);

      /* 门洞 */
      var dw = 13, dh = 22, dx = W / 2 - dw / 2, dy = H - dh;
      x.fillStyle = '#2a2622';
      x.fillRect(dx, dy, dw, dh);
      var dg = x.createLinearGradient(0, dy, 0, H);
      dg.addColorStop(0, 'rgba(0,0,0,0.1)');
      dg.addColorStop(1, 'rgba(0,0,0,0.85)');
      x.fillStyle = dg;
      x.fillRect(dx, dy, dw, dh);
      /* 门框 */
      x.fillStyle = '#4d4842';
      x.fillRect(dx - 1.6, dy - 1.6, 1.6, dh + 1.6);
      x.fillRect(dx + dw, dy - 1.6, 1.6, dh + 1.6);
      x.fillRect(dx - 1.6, dy - 1.6, dw + 3.2, 1.6);
    });
    return { c: o.c, ox: ox, oy: oy, w: W + 16, h: H + 16 };
  };

  A.gate = function (s, pal) {
    var W = s.w * 16, H = s.h * 16;
    var im = G.Assets.img('struct.gate');
    if (im) return { c: im, ox: 0, oy: 0, w: W, h: H };
    var ox = -4, oy = -4;
    var key = 'g|' + W + '|' + H + '|' + pal.rock;
    var o = cached(key, W + 8, H + 8, function (x) {
      x.translate(4, 4);
      /* 山体岩壁 */
      var r = rnd(W * 31 + H * 17);
      var rg = x.createLinearGradient(0, 0, 0, H);
      rg.addColorStop(0, shade(pal.rock, 0.10));
      rg.addColorStop(1, shade(pal.rock, -0.34));
      x.fillStyle = rg;
      x.fillRect(0, 0, W, H);
      for (var i = 0; i < 26; i++) {
        x.fillStyle = alpha(r() > 0.5 ? shade(pal.rock, 0.14) : shade(pal.rock, -0.2), 0.35);
        blob(x, r() * W, r() * H, 2 + r() * 5, 0.8);
      }
      /* 洞口 */
      var cw = W - 18, ch = H - 8;
      var cx = W / 2, cy = H;
      x.fillStyle = '#0a0a0e';
      x.beginPath();
      x.moveTo(cx - cw / 2, cy);
      x.lineTo(cx - cw / 2, cy - ch * 0.55);
      x.quadraticCurveTo(cx, cy - ch * 1.35, cx + cw / 2, cy - ch * 0.55);
      x.lineTo(cx + cw / 2, cy);
      x.closePath();
      x.fill();
      /* 洞内渐隐 */
      var dg = x.createLinearGradient(0, cy - ch, 0, cy);
      dg.addColorStop(0, 'rgba(0,0,0,0)');
      dg.addColorStop(1, 'rgba(30,34,52,0.55)');
      x.fillStyle = dg;
      x.beginPath();
      x.moveTo(cx - cw / 2, cy);
      x.lineTo(cx - cw / 2, cy - ch * 0.55);
      x.quadraticCurveTo(cx, cy - ch * 1.35, cx + cw / 2, cy - ch * 0.55);
      x.lineTo(cx + cw / 2, cy);
      x.closePath();
      x.fill();
      /* 洞口石缘 */
      x.strokeStyle = shade(pal.rock, 0.22);
      x.lineWidth = 1.4;
      x.beginPath();
      x.moveTo(cx - cw / 2, cy);
      x.lineTo(cx - cw / 2, cy - ch * 0.55);
      x.quadraticCurveTo(cx, cy - ch * 1.35, cx + cw / 2, cy - ch * 0.55);
      x.lineTo(cx + cw / 2, cy);
      x.stroke();
      /* 顶部苔草 */
      x.fillStyle = alpha('#5f8f57', 0.5);
      for (var g = 0; g < 12; g++) {
        var gx = r() * W;
        x.fillRect(gx, 0.5 + r() * 2.5, 1.2, 1.6 + r() * 1.6);
      }
    });
    return { c: o.c, ox: ox, oy: oy, w: W + 8, h: H + 8 };
  };

  /* ============================================================
     五、装饰物（返回 {c, ox, oy, w, h}：ox/oy 相对格子左上角，w/h 为逻辑尺寸）
     ============================================================ */
  function decorCanvas(key, w, h, fn) {
    return cached(key, w, h, fn);
  }

  var DECOR_SIZE = {
    tree: [32, 48], rock: [32, 24], wallrock: [32, 32], fence: [32, 32],
    well: [32, 40], wall: [32, 22]
  };

  A.decor = function (t, pal, v) {
    v = (((v | 0) % 3) + 3) % 3;
    var sz = DECOR_SIZE[t] || [32, 32];
    var ox = -8, oy = 16 - sz[1];
    var hasVar = (t === 'tree' || t === 'rock' || t === 'wallrock');
    var im = hasVar ? G.Assets.img('decor.' + t + '.' + v) : null;
    if (!im) im = G.Assets.img('decor.' + t);
    if (im) return { c: im, ox: ox, oy: oy, w: sz[0], h: sz[1] };
    var art = A._decorProc(t, pal, v);
    if (!art) return null;
    return { c: art.c, ox: ox, oy: oy, w: sz[0], h: sz[1] };
  };

  /* 装饰物缩放：原来是 0.90~1.12 的连续随机缩放，两个问题 ——
     ① 每个装饰物每帧都过一次带滤波的缩放，野外一屏上百个，是帧耗大头；
     ② 非整数倍重采样会把像素画糊掉，和"画质要清"的目标正好相反。
     所以量化成 3 档并**按档位预烘**，绘制点就退化成 1:1 整数 blit。
     变体(3) × 档位(3) × 水平翻转(2) = 18 种组合，够打散复制感了。 */
  var DECOR_SCALES = [0.92, 1.0, 1.08];
  A.DECOR_SCALES = DECOR_SCALES;

  A.decorScaled = function (t, pal, v, si) {
    si = Math.max(0, Math.min(DECOR_SCALES.length - 1, si | 0));
    var sc = DECOR_SCALES[si];
    var base = A.decor(t, pal, v);
    if (!base) return null;
    if (sc === 1) return base;
    var w = Math.max(1, Math.round(base.w * sc));
    var h = Math.max(1, Math.round(base.h * sc));
    var key = 'decorScaled|' + t + '|' + v + '|' + si + '|' + (pal ? pal.robe : '');
    var o = cached(key, w, h, function (g) {
      g.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
      g.drawImage(base.c, 0, 0, w, h);
    });
    /* ox/oy 也按同档缩放，否则缩放后装饰物的底边与水平中心会偏掉 */
    return { c: o.c, ox: Math.round(base.ox * sc), oy: Math.round(base.oy * sc), w: w, h: h };
  };

  /* 树冠：暗底 → 主体 → 左上受光 → 叶片斑驳 → 下缘暗部 → 顶缘轮廓光
     纯色三层 blob 会读成扁平剪贴画，斑驳纹理与轮廓光才是"有体积"的关键。 */
  function canopy(x, cx, cy, rx, ry, base, hi, dark, seed) {
    var sq = ry / rx;
    /* 下缘体积（暗） */
    x.fillStyle = dark;
    blob(x, cx, cy + ry * 0.16, rx, sq);
    /* 主体 */
    x.fillStyle = base;
    blob(x, cx, cy, rx * 0.97, sq * 0.97);
    /* 左上受光 */
    x.fillStyle = hi;
    blob(x, cx - rx * 0.26, cy - ry * 0.34, rx * 0.58, sq * 0.90);

    /* 叶片斑驳：裁剪在树冠轮廓内，形成叶簇层次 */
    x.save();
    blobPath(x, cx, cy, rx * 0.97, sq * 0.97);
    x.clip();
    var r = rnd((seed || 1) * 7919 + 13);
    for (var i = 0; i < 11; i++) {
      var a = r() * 6.2832, d = Math.sqrt(r()) * 0.86;
      var px = cx + Math.cos(a) * rx * d, py = cy + Math.sin(a) * ry * d;
      var lit = py < cy - ry * 0.04;
      x.fillStyle = alpha(lit ? hi : dark, 0.15 + r() * 0.18);
      blob(x, px, py, rx * 0.13 + r() * rx * 0.13, 0.9);
    }
    /* 下缘环境光遮蔽 */
    var ao = x.createLinearGradient(0, cy + ry * 0.10, 0, cy + ry);
    ao.addColorStop(0, 'rgba(0,0,0,0)');
    ao.addColorStop(1, 'rgba(0,0,0,0.30)');
    x.fillStyle = ao;
    x.fillRect(cx - rx * 1.1, cy, rx * 2.2, ry * 1.3);
    x.restore();

    /* 顶缘轮廓光 */
    x.save();
    x.strokeStyle = alpha('#ffffff', 0.22);
    x.lineWidth = 0.75;
    x.beginPath();
    x.ellipse(cx - rx * 0.06, cy - ry * 0.30, rx * 0.80, ry * 0.62,
      0, Math.PI * 1.06, Math.PI * 1.94);
    x.stroke();
    x.restore();
  }

  function treeBody(x, pal, v) {
    var base = pal.grass, dark = shade(pal.grass, -0.42), hi = shade(pal.grass, 0.28);
    var mid = shade(pal.grass, -0.22), midHi = shade(pal.grass, 0.08);
    shadowEllipse(x, 16, 45, v === 1 ? 13.5 : 11.5, 4.2, 0.38);

    var tw = v === 2 ? 4.4 : 5.6;
    var tTop = v === 0 ? 28 : v === 1 ? 24 : 30;
    var x0 = 16 - tw / 2, x1 = 16 + tw / 2;

    /* 树干：左受光 → 右背光的柱面渐变 */
    var tg = x.createLinearGradient(x0, 0, x1, 0);
    tg.addColorStop(0, '#3d2c1e');
    tg.addColorStop(0.32, '#7a5c3c');
    tg.addColorStop(0.62, '#5e452c');
    tg.addColorStop(1, '#2f2317');
    x.fillStyle = tg;
    x.beginPath();
    x.moveTo(x0 - 1.5, 46.5);
    x.quadraticCurveTo(x0 - 0.2, 36, x0 - 0.7, tTop);
    x.lineTo(x1 + 0.7, tTop);
    x.quadraticCurveTo(x1 + 0.2, 36, x1 + 1.5, 46.5);
    x.closePath(); x.fill();

    /* 树皮纵纹 */
    x.strokeStyle = 'rgba(28,20,12,0.40)';
    x.lineWidth = 0.45;
    for (var b = 0; b < 3; b++) {
      var bx = x0 + 0.9 + b * (tw - 1.6) / 2.2;
      x.beginPath();
      x.moveTo(bx, tTop + 2.5);
      x.quadraticCurveTo(bx + (b - 1) * 0.5, 34, bx + (b - 1) * 0.7, 45);
      x.stroke();
    }
    /* 左缘高光 */
    x.strokeStyle = 'rgba(255,232,190,0.15)';
    x.lineWidth = 0.6;
    x.beginPath();
    x.moveTo(x0 - 0.1, tTop + 1.5);
    x.quadraticCurveTo(x0 - 0.4, 35, x0 - 1.0, 45);
    x.stroke();

    /* 板根（落地更稳，不再是"插在地上的棍子"） */
    x.fillStyle = '#3a2a1c';
    x.beginPath(); x.moveTo(x0 - 1.2, 44.2); x.lineTo(x0 - 3.4, 46.6); x.lineTo(x0 - 0.6, 46.6); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(x1 + 1.2, 44.2); x.lineTo(x1 + 3.4, 46.6); x.lineTo(x1 + 0.6, 46.6); x.closePath(); x.fill();

    /* 树冠：三套造型（每团给不同种子，斑驳纹理不重复） */
    if (v === 0) {
      canopy(x, 16, 26, 13, 12, mid, midHi, dark, 11);
      canopy(x, 9.5, 17, 8.5, 8, base, hi, dark, 23);
      canopy(x, 22, 18.5, 8, 7.5, base, hi, dark, 37);
      canopy(x, 16, 11, 9.5, 9, base, hi, dark, 53);
    } else if (v === 1) {
      canopy(x, 16, 24, 14.5, 10.5, mid, midHi, dark, 61);
      canopy(x, 7.5, 19, 8, 7.5, base, hi, dark, 71);
      canopy(x, 24.5, 19.5, 8, 7.5, base, hi, dark, 83);
      canopy(x, 11, 13, 8.5, 8, base, hi, dark, 97);
      canopy(x, 21.5, 13.5, 8, 7.5, base, hi, dark, 103);
    } else {
      canopy(x, 16, 28, 10, 9.5, mid, midHi, dark, 113);
      canopy(x, 16, 18, 11, 10.5, base, hi, dark, 127);
      canopy(x, 11, 12.5, 7, 6.5, base, hi, dark, 139);
      canopy(x, 21.5, 13, 6.5, 6, base, hi, dark, 151);
    }
  }

  function rockBody(x, pal, v, big) {
    var cy = big ? 22 : 16;
    var w = v === 1 ? 14 : v === 2 ? 8.5 : 12.5;
    var h = v === 1 ? 8.5 : v === 2 ? 14 : 13;
    shadowEllipse(x, 16, big ? 28 : 21, w * 0.96, 3.9, 0.44);
    var rg = x.createLinearGradient(0, cy - h, 0, cy + 6);
    rg.addColorStop(0, shade(pal.rock, 0.20));
    rg.addColorStop(0.55, pal.rock);
    rg.addColorStop(1, shade(pal.rock, -0.34));
    x.fillStyle = rg;
    x.beginPath();
    x.moveTo(16 - w, cy + 6);
    x.lineTo(16 - w * 0.9, cy - h * 0.4);
    x.lineTo(16 - w * 0.55, cy - h * 0.92);
    x.lineTo(16 + w * 0.15, cy - h);
    x.lineTo(16 + w * 0.8, cy - h * 0.45);
    x.lineTo(16 + w, cy + 6);
    x.closePath(); x.fill();
    /* 棱面 */
    x.fillStyle = alpha('#ffffff', 0.15);
    x.beginPath();
    x.moveTo(16 - w * 0.55, cy - h * 0.92);
    x.lineTo(16 + w * 0.15, cy - h);
    x.lineTo(16, cy - h * 0.3);
    x.lineTo(16 - w * 0.5, cy - h * 0.25);
    x.closePath(); x.fill();
    x.fillStyle = alpha('#000000', 0.20);
    x.beginPath();
    x.moveTo(16 + w * 0.55, cy + 6);
    x.lineTo(16 + w, cy + 6);
    x.lineTo(16 + w * 0.8, cy - h * 0.45);
    x.lineTo(16 + w * 0.3, cy - h * 0.15);
    x.closePath(); x.fill();
    /* 裂痕（让石面不再是光滑多边形） */
    x.strokeStyle = alpha('#000000', 0.26);
    x.lineWidth = 0.5;
    x.beginPath();
    x.moveTo(16 - w * 0.30, cy - h * 0.85);
    x.lineTo(16 - w * 0.05, cy - h * 0.42);
    x.lineTo(16 + w * 0.22, cy - h * 0.30);
    x.stroke();
    x.beginPath();
    x.moveTo(16 + w * 0.45, cy - h * 0.62);
    x.lineTo(16 + w * 0.28, cy - h * 0.18);
    x.stroke();
    /* 顶缘受光轮廓 */
    x.strokeStyle = alpha('#ffffff', 0.20);
    x.lineWidth = 0.55;
    x.beginPath();
    x.moveTo(16 - w * 0.55, cy - h * 0.92);
    x.lineTo(16 + w * 0.15, cy - h);
    x.stroke();
    /* 苔点 */
    x.fillStyle = alpha('#5f8f57', 0.34);
    blob(x, 16 - w * 0.45, cy - h * 0.55, 2.2, 0.7);
    blob(x, 16 + w * 0.35, cy - h * 0.1, 1.6, 0.7);
    x.fillStyle = alpha('#6f9f63', 0.26);
    blob(x, 16 - w * 0.15, cy + 4.2, 1.9, 0.6);
    /* 底部碎石（与地面衔接） */
    x.fillStyle = alpha(shade(pal.rock, -0.40), 0.55);
    blob(x, 16 - w * 0.85, cy + 5.6, 1.7, 0.75);
    blob(x, 16 + w * 0.78, cy + 5.9, 1.4, 0.75);
  }

  A._decorProc = function (t, pal, v) {
    v = v || 0;

    /* 室内墙：矮砖墙 + 木梁压顶。
       ⚠️ 高度与 DECOR_SIZE.wall 是**一对**：装饰物的锚点是 oy = 16 − h，
       也就是"底边贴本格下沿、向上长 (h−16) 像素"。h=44 时墙会向上长出 28px，
       正好盖到**上一行**角色的下半身（玩家截图反馈"围墙把角色挡住了"）。
       v0.11.4 砍到 22 → 只长出 6px，站位不再被切。改高度必须两处一起改。 */
    if (t === 'wall') {
      return decorCanvas('d|wall|' + v, 32, 22, function (x) {
        var W = 32, H = 22;
        /* 墙体 */
        x.fillStyle = '#4a4038';
        x.fillRect(0, 4, W, H - 4);
        /* 砖块：错缝排列（3 行，矮墙放得下） */
        var bw = 10, bh = 5;
        for (var row = 0; row < 3; row++) {
          var y0 = 5.5 + row * bh;
          var off = (row % 2) ? -bw / 2 : 0;
          for (var c = -1; c < 4; c++) {
            var bx = off + c * bw;
            var tone = ((row * 7 + c * 13 + v * 5) % 5) / 5 * 0.14 - 0.07;
            x.fillStyle = shade('#6b5f52', tone);
            x.fillRect(bx + 0.6, y0 + 0.6, bw - 1.2, bh - 1.2);
            x.fillStyle = alpha('#ffffff', 0.07);
            x.fillRect(bx + 0.6, y0 + 0.6, bw - 1.2, 0.6);
          }
        }
        /* 墙脚阴影 */
        var g = x.createLinearGradient(0, H - 7, 0, H);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.34)');
        x.fillStyle = g; x.fillRect(0, H - 7, W, 7);
        /* 木梁压顶 */
        x.fillStyle = '#5a4530';
        x.fillRect(-0.6, 0, W + 1.2, 5.5);
        x.fillStyle = alpha('#9c7648', 0.55);
        x.fillRect(-0.6, 0.6, W + 1.2, 1.2);
        x.fillStyle = alpha('#000000', 0.30);
        x.fillRect(-0.6, 4.8, W + 1.2, 0.8);
      });
    }

    if (t === 'tree') {
      return decorCanvas('d|tree|' + pal.ground + '|' + v, 32, 48, function (x) {
        treeBody(x, pal, v);
      });
    }

    if (t === 'rock' || t === 'wallrock') {
      var big = t === 'wallrock';
      return decorCanvas('d|' + t + '|' + pal.rock + '|' + v, 32, big ? 32 : 24, function (x) {
        rockBody(x, pal, v, big);
      });
    }

    if (t === 'fence') {
      var o3 = decorCanvas('d|fence', 32, 32, function (x) {
        shadowEllipse(x, 16, 30, 11, 3, 0.28);
        /* 横栏 2 道 */
        [13, 19].forEach(function (yy) {
          var g = x.createLinearGradient(0, yy, 0, yy + 3);
          g.addColorStop(0, '#a07a4e');
          g.addColorStop(1, '#6b4f34');
          x.fillStyle = g;
          x.fillRect(2, yy, 28, 3);
          x.fillStyle = alpha('#000000', 0.22);
          x.fillRect(2, yy + 2.6, 28, 0.6);
        });
        /* 立柱 */
        [6, 15.5, 25].forEach(function (px) {
          var g = x.createLinearGradient(px, 0, px + 3.4, 0);
          g.addColorStop(0, '#7d5c3c');
          g.addColorStop(0.4, '#a67c4e');
          g.addColorStop(1, '#5b432c');
          x.fillStyle = g;
          x.fillRect(px, 9, 3.4, 21);
          x.fillStyle = alpha('#000000', 0.28);
          x.fillRect(px, 29.2, 3.4, 1);
        });
      });
      return o3;
    }

    if (t === 'well') {
      var o4 = decorCanvas('d|well|' + pal.rock, 32, 40, function (x) {
        shadowEllipse(x, 16, 37, 12, 4, 0.34);
        /* 井身石圈 */
        var rg = x.createLinearGradient(0, 22, 0, 36);
        rg.addColorStop(0, '#9a968e');
        rg.addColorStop(1, '#5c5a56');
        x.fillStyle = rg;
        x.beginPath();
        x.ellipse(16, 29, 12, 8, 0, 0, 6.2832);
        x.fill();
        /* 石块缝 */
        x.strokeStyle = 'rgba(40,38,36,0.5)';
        x.lineWidth = 0.6;
        for (var i = 0; i < 8; i++) {
          var a = i / 8 * 6.2832;
          x.beginPath();
          x.moveTo(16 + Math.cos(a) * 12, 29 + Math.sin(a) * 8);
          x.lineTo(16 + Math.cos(a) * 8.5, 29 + Math.sin(a) * 5.2);
          x.stroke();
        }
        /* 井口 */
        x.fillStyle = '#12161f';
        x.beginPath(); x.ellipse(16, 27.5, 8.6, 5.2, 0, 0, 6.2832); x.fill();
        var wg = x.createRadialGradient(16, 28, 1, 16, 28, 8);
        wg.addColorStop(0, 'rgba(90,159,214,0.55)');
        wg.addColorStop(1, 'rgba(90,159,214,0)');
        x.fillStyle = wg;
        x.beginPath(); x.ellipse(16, 27.5, 8.6, 5.2, 0, 0, 6.2832); x.fill();
        x.fillStyle = alpha('#ffffff', 0.22);
        x.beginPath(); x.ellipse(13.5, 26, 2.6, 1.1, -0.3, 0, 6.2832); x.fill();
        /* 井架 */
        x.fillStyle = '#6b4f34';
        x.fillRect(4.5, 10, 2.6, 20);
        x.fillRect(24.9, 10, 2.6, 20);
        x.fillRect(4.5, 8, 23, 3);
        /* 顶棚 */
        x.fillStyle = '#4d4a46';
        x.beginPath();
        x.moveTo(0, 10); x.lineTo(32, 10); x.lineTo(27, 2); x.lineTo(5, 2);
        x.closePath(); x.fill();
        x.fillStyle = alpha('#ffffff', 0.12);
        x.fillRect(5, 2.6, 22, 1);
        /* 辘轳绳 */
        x.strokeStyle = 'rgba(200,190,160,0.6)';
        x.lineWidth = 0.6;
        x.beginPath(); x.moveTo(16, 11); x.lineTo(16, 20); x.stroke();
        x.fillStyle = '#8a6a44';
        x.fillRect(14, 20, 4, 4);
      });
      return o4;
    }

    return null;
  };

  /* ============================================================
     五之二、室内家具
     尺寸 = 格数 × 16，原点即家具左上角所在格子的左上角。
     返回 {c, w, h}：调用方按 tx*16 / ty*16 直接绘制。
     ============================================================ */
  var WOOD = { base: '#7a5a38', dark: '#4e3722', hi: '#9c7648', edge: '#33240f' };
  var CLOTH = { base: '#b04a44', dark: '#7c312d', hi: '#cf6f66' };

  var FURN_SIZE = {
    bed: [3, 2], table: [3, 2], cushion: [2, 2], shelf: [3, 1],
    counter: [5, 1], crate: [1, 1], jar: [1, 1], altar: [3, 2],
    lantern: [1, 2], screen: [4, 1], vessel: [2, 2]
  };
  var FURN_PROC = {};

  /* 家具通用：外描边 + 台面受光 + 接地投影 */
  function furnBox(x, X, Y, W, H, base, top, opt) {
    opt = opt || {};
    var e = opt.outline == null ? 0.9 : opt.outline;
    /* 接地投影 */
    x.fillStyle = 'rgba(0,0,0,0.28)';
    x.beginPath();
    x.ellipse(X + W / 2, Y + H - 1.2, W * 0.46, H * 0.13, 0, 0, 6.2832);
    x.fill();
    /* 描边层 */
    x.fillStyle = opt.edge || WOOD.edge;
    x.fillRect(X - e, Y - e, W + e * 2, H + e * 2);
    /* 主体 */
    x.fillStyle = base;
    x.fillRect(X, Y, W, H);
    /* 顶面 */
    if (top) {
      x.fillStyle = top;
      x.fillRect(X, Y, W, H * 0.34);
    }
    /* 右侧与下缘压暗，做出体积 */
    var g = x.createLinearGradient(X, Y, X, Y + H);
    g.addColorStop(0, 'rgba(255,246,224,0.10)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    x.fillStyle = g; x.fillRect(X, Y, W, H);
    var g2 = x.createLinearGradient(X, Y, X + W, Y);
    g2.addColorStop(0, 'rgba(255,246,224,0.07)');
    g2.addColorStop(0.55, 'rgba(0,0,0,0)');
    g2.addColorStop(1, 'rgba(0,0,0,0.20)');
    x.fillStyle = g2; x.fillRect(X, Y, W, H);
  }

  FURN_PROC.bed = function (x, pal, W, H) {
    /* 床架 */
    furnBox(x, 1, H * 0.30, W - 2, H * 0.68, WOOD.base, WOOD.hi);
    /* 床板（内侧） */
    x.fillStyle = shade(WOOD.base, -0.16);
    x.fillRect(3.4, H * 0.36, W - 6.8, H * 0.56);
    /* 被褥 */
    var bx = 4.2, by = H * 0.40, bw = W - 8.4, bh = H * 0.50;
    x.fillStyle = CLOTH.dark; x.fillRect(bx, by + 1.2, bw, bh);
    x.fillStyle = CLOTH.base; x.fillRect(bx, by, bw, bh);
    x.fillStyle = alpha(CLOTH.hi, 0.55);
    x.fillRect(bx + 1.2, by + 1.4, bw * 0.44, bh - 2.8);
    /* 被面褶皱 */
    x.strokeStyle = alpha(CLOTH.dark, 0.45);
    x.lineWidth = 0.6;
    for (var i = 1; i < 4; i++) {
      var ly = by + bh * i / 4;
      x.beginPath(); x.moveTo(bx + 1, ly); x.lineTo(bx + bw - 1, ly + 0.6); x.stroke();
    }
    /* 枕头 */
    x.fillStyle = '#e6ddc2';
    x.fillRect(W - 20, by + 2, 12, bh - 6);
    x.fillStyle = alpha('#ffffff', 0.45);
    x.fillRect(W - 19, by + 3, 10, 3.2);
    x.fillStyle = alpha('#8a7f66', 0.5);
    x.fillRect(W - 20, by + bh - 5, 12, 1.2);
    /* 床头立柱 */
    x.fillStyle = WOOD.dark;
    x.fillRect(0.6, H * 0.20, 3, H * 0.74);
    x.fillRect(W - 3.6, H * 0.20, 3, H * 0.74);
    x.fillStyle = alpha(WOOD.hi, 0.7);
    x.fillRect(0.6, H * 0.20, 3, 1.2);
    x.fillRect(W - 3.6, H * 0.20, 3, 1.2);
  };

  FURN_PROC.table = function (x, pal, W, H) {
    var ty = H * 0.42;
    /* 桌腿 */
    x.fillStyle = WOOD.dark;
    x.fillRect(4, ty + 6, 3.4, H - ty - 7);
    x.fillRect(W - 7.4, ty + 6, 3.4, H - ty - 7);
    x.fillStyle = alpha('#000000', 0.25);
    x.fillRect(W - 7.4, ty + 6, 1.4, H - ty - 7);
    /* 桌面 */
    furnBox(x, 1, ty, W - 2, 7.5, WOOD.base, WOOD.hi);
    /* 桌面木纹 */
    x.strokeStyle = alpha(WOOD.dark, 0.28);
    x.lineWidth = 0.5;
    for (var i = 0; i < 4; i++) {
      var yy = ty + 1.4 + i * 1.6;
      x.beginPath(); x.moveTo(2, yy); x.lineTo(W - 2, yy + 0.4); x.stroke();
    }
    /* 桌上茶具 */
    x.fillStyle = '#cfd8e0';
    x.beginPath(); x.ellipse(W * 0.34, ty - 2.4, 4.4, 2.6, 0, 0, 6.2832); x.fill();
    x.fillStyle = alpha('#ffffff', 0.5);
    x.beginPath(); x.ellipse(W * 0.34 - 1, ty - 3.2, 2.2, 1.2, 0, 0, 6.2832); x.fill();
    x.fillStyle = '#8a6a44';
    x.fillRect(W * 0.62, ty - 5.4, 3.4, 4.6);
    x.fillStyle = alpha('#ffffff', 0.28);
    x.fillRect(W * 0.62, ty - 5.4, 1.1, 4.6);
  };

  FURN_PROC.cushion = function (x, pal, W, H) {
    var cx = W / 2, cy = H * 0.62;
    x.fillStyle = 'rgba(0,0,0,0.26)';
    x.beginPath(); x.ellipse(cx, cy + H * 0.16, W * 0.40, H * 0.13, 0, 0, 6.2832); x.fill();
    /* 蒲团：草编圆垫，同心圈 + 放射纹 */
    x.fillStyle = '#a08a52';
    x.beginPath(); x.ellipse(cx, cy, W * 0.40, H * 0.30, 0, 0, 6.2832); x.fill();
    x.fillStyle = '#bda269';
    x.beginPath(); x.ellipse(cx, cy - H * 0.03, W * 0.35, H * 0.25, 0, 0, 6.2832); x.fill();
    x.strokeStyle = alpha('#6e5c34', 0.55);
    x.lineWidth = 0.7;
    for (var i = 1; i <= 3; i++) {
      x.beginPath();
      x.ellipse(cx, cy - H * 0.03, W * 0.35 * i / 3.6, H * 0.25 * i / 3.6, 0, 0, 6.2832);
      x.stroke();
    }
    x.strokeStyle = alpha('#6e5c34', 0.32);
    x.lineWidth = 0.6;
    for (var a = 0; a < 10; a++) {
      var an = a / 10 * 6.2832;
      x.beginPath();
      x.moveTo(cx + Math.cos(an) * W * 0.10, cy - H * 0.03 + Math.sin(an) * H * 0.08);
      x.lineTo(cx + Math.cos(an) * W * 0.35, cy - H * 0.03 + Math.sin(an) * H * 0.25);
      x.stroke();
    }
    /* 中心压痕 */
    x.fillStyle = alpha('#6e5c34', 0.30);
    x.beginPath(); x.ellipse(cx, cy + H * 0.02, W * 0.11, H * 0.08, 0, 0, 6.2832); x.fill();
  };

  FURN_PROC.shelf = function (x, pal, W, H) {
    furnBox(x, 1, 1, W - 2, H - 2, WOOD.base, WOOD.hi);
    /* 药柜格：3×2 抽屉阵 */
    var cols = 6, rows = 2;
    var gx = 3, gy = 4, gw = (W - 6) / cols, gh = (H - 7) / rows;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var dx = gx + c * gw, dy = gy + r * gh;
        x.fillStyle = shade(WOOD.base, r === 0 ? 0.06 : -0.10);
        x.fillRect(dx + 0.6, dy + 0.6, gw - 1.4, gh - 1.4);
        x.fillStyle = alpha('#ffffff', 0.10);
        x.fillRect(dx + 0.6, dy + 0.6, gw - 1.4, 0.8);
        /* 抽屉铜环 */
        x.fillStyle = '#c9a44e';
        x.beginPath();
        x.arc(dx + gw / 2, dy + gh / 2, Math.min(gw, gh) * 0.16, 0, 6.2832);
        x.fill();
        x.fillStyle = alpha('#000000', 0.30);
        x.beginPath();
        x.arc(dx + gw / 2, dy + gh / 2 + 0.5, Math.min(gw, gh) * 0.16, 0.2, 2.9);
        x.fill();
      }
    }
  };

  FURN_PROC.counter = function (x, pal, W, H) {
    furnBox(x, 1, H * 0.30, W - 2, H * 0.66, WOOD.base, WOOD.hi);
    /* 台面横纹 */
    x.strokeStyle = alpha(WOOD.dark, 0.30);
    x.lineWidth = 0.5;
    for (var i = 0; i < 3; i++) {
      var yy = H * 0.36 + i * 1.8;
      x.beginPath(); x.moveTo(2, yy); x.lineTo(W - 2, yy + 0.4); x.stroke();
    }
    /* 柜面分隔与铜环 */
    var n = 4, cw = (W - 8) / n;
    for (var c = 0; c < n; c++) {
      var dx = 4 + c * cw;
      x.fillStyle = alpha('#000000', 0.16);
      x.fillRect(dx, H * 0.52, cw - 1.6, H * 0.38);
      x.fillStyle = '#c9a44e';
      x.beginPath(); x.arc(dx + cw / 2 - 0.8, H * 0.68, 1.3, 0, 6.2832); x.fill();
    }
  };

  FURN_PROC.crate = function (x, pal, W, H) {
    furnBox(x, 1.5, 2, W - 3, H - 4, WOOD.base, WOOD.hi);
    /* 井字木条 */
    x.fillStyle = WOOD.dark;
    x.fillRect(1.5, H * 0.46, W - 3, 2);
    x.fillRect(W * 0.46, 2, 2, H - 4);
    x.fillStyle = alpha('#ffffff', 0.10);
    x.fillRect(1.5, H * 0.46, W - 3, 0.7);
    x.fillRect(W * 0.46, 2, 0.7, H - 4);
  };

  FURN_PROC.jar = function (x, pal, W, H) {
    var cx = W / 2, cy = H * 0.60, rw = W * 0.32, rh = H * 0.30;
    x.fillStyle = 'rgba(0,0,0,0.26)';
    x.beginPath(); x.ellipse(cx, H * 0.86, rw * 1.1, H * 0.08, 0, 0, 6.2832); x.fill();
    /* 陶瓮 */
    x.fillStyle = '#6d5340';
    x.beginPath(); x.ellipse(cx, cy, rw, rh, 0, 0, 6.2832); x.fill();
    x.fillStyle = '#8a6a4e';
    x.beginPath(); x.ellipse(cx - rw * 0.22, cy - rh * 0.22, rw * 0.62, rh * 0.66, 0, 0, 6.2832); x.fill();
    /* 口沿 */
    x.fillStyle = '#54402f';
    x.beginPath(); x.ellipse(cx, cy - rh * 0.92, rw * 0.52, rh * 0.20, 0, 0, 6.2832); x.fill();
    x.fillStyle = alpha('#000000', 0.45);
    x.beginPath(); x.ellipse(cx, cy - rh * 0.94, rw * 0.40, rh * 0.14, 0, 0, 6.2832); x.fill();
    /* 釉光 */
    x.fillStyle = alpha('#ffffff', 0.22);
    x.beginPath(); x.ellipse(cx - rw * 0.34, cy - rh * 0.10, rw * 0.16, rh * 0.30, -0.4, 0, 6.2832); x.fill();
  };

  FURN_PROC.altar = function (x, pal, W, H) {
    /* 台基 */
    furnBox(x, 1, H * 0.46, W - 2, H * 0.50, '#6a6156', '#857c6e');
    x.fillStyle = alpha('#000000', 0.20);
    x.fillRect(1, H * 0.78, W - 2, 2);
    /* 供桌 */
    furnBox(x, W * 0.16, H * 0.24, W * 0.68, H * 0.30, WOOD.base, WOOD.hi);
    /* 香炉 */
    x.fillStyle = '#5d564c';
    x.beginPath(); x.ellipse(W / 2, H * 0.22, 6.4, 3.4, 0, 0, 6.2832); x.fill();
    x.fillStyle = '#7c7466';
    x.beginPath(); x.ellipse(W / 2, H * 0.20, 5.2, 2.6, 0, 0, 6.2832); x.fill();
    /* 三炷香 + 烟 */
    x.strokeStyle = '#c8b48a';
    x.lineWidth = 0.7;
    for (var i = -1; i <= 1; i++) {
      x.beginPath();
      x.moveTo(W / 2 + i * 2.2, H * 0.19);
      x.lineTo(W / 2 + i * 2.2, H * 0.09);
      x.stroke();
    }
    x.strokeStyle = 'rgba(220,214,196,0.30)';
    x.lineWidth = 1.2;
    x.beginPath();
    x.moveTo(W / 2, H * 0.08);
    x.bezierCurveTo(W / 2 + 4, H * 0.02, W / 2 - 4, -2, W / 2 + 2, -6);
    x.stroke();
    /* 烛台 */
    [[-1, '#d8a44e'], [1, '#d8a44e']].forEach(function (c) {
      var cx = W / 2 + c[0] * W * 0.26;
      x.fillStyle = '#8a7f66'; x.fillRect(cx - 1, H * 0.14, 2, H * 0.10);
      x.fillStyle = '#e8d8a0'; x.fillRect(cx - 0.9, H * 0.08, 1.8, 6);
      x.fillStyle = '#ffcf6a';
      x.beginPath(); x.ellipse(cx, H * 0.06, 1.5, 2.6, 0, 0, 6.2832); x.fill();
    });
  };

  FURN_PROC.lantern = function (x, pal, W, H) {
    var cx = W / 2;
    /* 灯柱 */
    x.fillStyle = WOOD.edge;
    x.fillRect(cx - 2.6, 6, 5.2, H - 6);
    x.fillStyle = WOOD.base;
    x.fillRect(cx - 2, 6, 4, H - 7);
    x.fillStyle = alpha(WOOD.hi, 0.5);
    x.fillRect(cx - 2, 6, 1.2, H - 7);
    /* 底座 */
    x.fillStyle = '#4a4438';
    x.fillRect(cx - 5, H - 6, 10, 5);
    /* 灯笼 */
    var ly = 6;
    x.fillStyle = '#3a3226';
    x.fillRect(cx - 6, ly, 12, 2);
    x.fillStyle = '#e8c46a';
    x.beginPath(); x.ellipse(cx, ly + 9, 6, 7.4, 0, 0, 6.2832); x.fill();
    x.fillStyle = alpha('#fff3c8', 0.72);
    x.beginPath(); x.ellipse(cx - 1.4, ly + 8, 3.2, 4.6, 0, 0, 6.2832); x.fill();
    x.strokeStyle = alpha('#8a6a30', 0.55);
    x.lineWidth = 0.5;
    for (var i = -1; i <= 1; i++) {
      x.beginPath();
      x.moveTo(cx + i * 2.6, ly + 2);
      x.lineTo(cx + i * 3.2, ly + 16);
      x.stroke();
    }
    x.fillStyle = '#3a3226';
    x.fillRect(cx - 6, ly + 16, 12, 2);
    /* 灯穗 */
    x.strokeStyle = '#b0483c';
    x.lineWidth = 0.8;
    x.beginPath(); x.moveTo(cx, ly + 18); x.lineTo(cx, ly + 22); x.stroke();
  };

  FURN_PROC.screen = function (x, pal, W, H) {
    /* 四扇折屏：每扇略错开高度，读得出"折" */
    var n = 4, sw = W / n;
    for (var i = 0; i < n; i++) {
      var sx = i * sw + 1, sh = H - 3 + (i % 2 ? 1.4 : 0);
      furnBox(x, sx, H - sh - 1, sw - 2, sh, '#3f4c6d', '#5d6f94');
      /* 屏心 */
      x.fillStyle = '#e6ddc2';
      x.fillRect(sx + 2.4, H - sh + 2, sw - 6.8, sh - 5);
      x.fillStyle = alpha('#8fa0c4', 0.42);
      x.fillRect(sx + 2.4, H - sh + 2, sw - 6.8, (sh - 5) * 0.42);
      /* 远山水墨 */
      x.strokeStyle = alpha('#3f4c6d', 0.55);
      x.lineWidth = 0.6;
      x.beginPath();
      x.moveTo(sx + 3.4, H - 4);
      x.lineTo(sx + sw * 0.42, H - sh * 0.55);
      x.lineTo(sx + sw * 0.68, H - sh * 0.34);
      x.lineTo(sx + sw - 4.4, H - 4);
      x.stroke();
    }
  };

  FURN_PROC.vessel = function (x, pal, W, H) {
    var cx = W / 2, cy = H * 0.54;
    /* 石台 */
    furnBox(x, 2, H * 0.62, W - 4, H * 0.32, '#5a5650', '#79746a');
    /* 台面光晕 */
    var rg = x.createRadialGradient(cx, cy, 2, cx, cy, W * 0.52);
    rg.addColorStop(0, 'rgba(150,214,208,0.42)');
    rg.addColorStop(1, 'rgba(150,214,208,0)');
    x.fillStyle = rg;
    x.beginPath(); x.ellipse(cx, cy, W * 0.52, H * 0.36, 0, 0, 6.2832); x.fill();
    /* 悬浮的逆命珠 */
    x.fillStyle = 'rgba(120,196,190,0.30)';
    x.beginPath(); x.arc(cx, cy, 8.4, 0, 6.2832); x.fill();
    x.fillStyle = '#8fd8d0';
    x.beginPath(); x.arc(cx, cy, 5.6, 0, 6.2832); x.fill();
    x.fillStyle = '#e6fffb';
    x.beginPath(); x.arc(cx - 1.6, cy - 1.8, 2.6, 0, 6.2832); x.fill();
    /* 珠上缠的血丝 */
    x.strokeStyle = alpha('#c0392b', 0.62);
    x.lineWidth = 0.8;
    x.beginPath();
    x.moveTo(cx - 5.2, cy + 1.4);
    x.bezierCurveTo(cx - 1, cy - 4.6, cx + 2, cy + 4.6, cx + 5.4, cy - 1.2);
    x.stroke();
  };

  A.furn = function (kind, pal) {
    var sz = FURN_SIZE[kind] || [1, 1];
    var w = sz[0] * 16, h = sz[1] * 16;
    var im = G.Assets.img('furn.' + kind);
    if (im) return { c: im, w: w, h: h };
    var fn = FURN_PROC[kind];
    if (!fn) return null;
    var o = cached('fu|' + kind + '|' + w + 'x' + h, w, h, function (x) { fn(x, pal, w, h); });
    return { c: o.c, w: w, h: h };
  };
  A.FURN_SIZE = FURN_SIZE;

  /* 宝箱 */
  A.chest = function (opened) {
    var im = G.Assets.img(opened ? 'obj.chest.open' : 'obj.chest');
    if (im) return { c: im, ox: -8, oy: -16, w: 32, h: 32 };
    var o = decorCanvas('d|chest|' + (opened ? 1 : 0), 32, 32, function (x) {
      shadowEllipse(x, 16, 29, 10, 3, 0.34);
      var body = opened ? '#5a4632' : '#7a5533';
      /* 箱体 */
      var bg = x.createLinearGradient(0, 14, 0, 28);
      bg.addColorStop(0, shade(body, 0.16));
      bg.addColorStop(1, shade(body, -0.24));
      x.fillStyle = bg;
      x.fillRect(6, 14, 20, 13);
      /* 木纹 */
      x.strokeStyle = alpha('#000000', 0.2);
      x.lineWidth = 0.5;
      for (var i = 17; i < 27; i += 3) {
        x.beginPath(); x.moveTo(6, i); x.lineTo(26, i); x.stroke();
      }
      /* 铁箍 */
      x.fillStyle = '#6f6a60';
      x.fillRect(8.5, 14, 2, 13);
      x.fillRect(21.5, 14, 2, 13);
      /* 箱盖 */
      var lidY = opened ? 5 : 8;
      x.fillStyle = opened ? '#4a3a28' : '#8c6238';
      x.beginPath();
      if (opened) {
        /* 开盖：向后仰 */
        x.moveTo(6, 14);
        x.lineTo(8, 5);
        x.lineTo(26, 3);
        x.lineTo(26, 14);
      } else {
        x.moveTo(6, 14);
        x.quadraticCurveTo(16, 5.5, 26, 14);
      }
      x.closePath(); x.fill();
      x.fillStyle = alpha('#ffffff', 0.12);
      x.fillRect(8, opened ? 6 : 9, 16, 1);
      /* 锁扣 */
      if (!opened) {
        x.fillStyle = '#d8b768';
        x.fillRect(14.6, 12.5, 3, 4);
        x.fillStyle = '#a8843f';
        x.fillRect(15.4, 13.6, 1.4, 2);
      } else {
        /* 宝光 */
        var gg = x.createRadialGradient(16, 12, 1, 16, 12, 11);
        gg.addColorStop(0, 'rgba(255,230,150,0.55)');
        gg.addColorStop(1, 'rgba(255,230,150,0)');
        x.fillStyle = gg;
        x.beginPath(); x.arc(16, 12, 11, 0, 6.2832); x.fill();
      }
    });
    return { c: o.c, ox: -8, oy: -16, w: 32, h: 32 };
  };

  /* ===== 区域物件：秘境裂隙 / 界门 =====
     《四界区域与副本落位设计 v1.1》§2.2 / §2.3。这两个 kind 由 `map.md.special` 承载、
     `explore._drawSpecial` 消费。**必须画出来**：只登记不绘制时地图上什么都没有，
     玩家唯一能看到的线索是"走到某处正面冒出一个小三角" —— 等于藏起了副本入口。
     素材键 `obj.rift` / `obj.worldgate` 未登记（全程序化），登记后自动优先用素材。 */

  /* 秘境裂隙（区域副本入口）：紫黑裂口 + 内芯幽光 + 逸散碎屑 */
  A.rift = function () {
    var im = G.Assets.img('obj.rift');
    if (im) return { c: im, ox: -8, oy: -16, w: 32, h: 32 };
    var o = decorCanvas('d|rift', 32, 32, function (x) {
      shadowEllipse(x, 16, 28, 12, 4.5, 0.42);
      /* 外圈紫雾 */
      var g = x.createRadialGradient(16, 19, 2, 16, 19, 15);
      g.addColorStop(0, 'rgba(178,132,236,0.50)');
      g.addColorStop(0.55, 'rgba(108,72,168,0.26)');
      g.addColorStop(1, 'rgba(60,40,100,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(16, 19, 15, 0, 6.2832); x.fill();
      /* 裂口本体（锯齿状的不规则裂） */
      x.beginPath();
      x.moveTo(9, 27); x.lineTo(12, 17); x.lineTo(10, 11); x.lineTo(15, 6);
      x.lineTo(19, 10); x.lineTo(23, 16); x.lineTo(21, 27);
      x.closePath();
      var lg = x.createLinearGradient(0, 6, 0, 28);
      lg.addColorStop(0, '#2b1c48');
      lg.addColorStop(0.45, '#4c3080');
      lg.addColorStop(1, '#140c24');
      x.fillStyle = lg; x.fill();
      x.strokeStyle = 'rgba(198,160,248,0.62)';
      x.lineWidth = 0.8; x.stroke();
      /* 内芯幽光 */
      var cg = x.createRadialGradient(16, 17, 0.5, 16, 17, 6.5);
      cg.addColorStop(0, 'rgba(238,216,255,0.95)');
      cg.addColorStop(0.5, 'rgba(172,124,242,0.55)');
      cg.addColorStop(1, 'rgba(120,80,200,0)');
      x.fillStyle = cg;
      x.beginPath(); x.arc(16, 17, 6.5, 0, 6.2832); x.fill();
      /* 逸散碎屑 */
      x.fillStyle = 'rgba(184,152,232,0.55)';
      x.fillRect(6.5, 23, 1.4, 1.4); x.fillRect(24, 21, 1.2, 1.2);
      x.fillRect(11, 9, 1.2, 1.2); x.fillRect(22.5, 26, 1.4, 1.4);
    });
    return { c: o.c, ox: -8, oy: -16, w: 32, h: 32 };
  };

  /* 界门（四界往返）：石拱 + 光幕 + 门楣金符。高 40，锚在门格底沿 */
  A.worldgate = function () {
    var im = G.Assets.img('obj.worldgate');
    if (im) return { c: im, ox: -8, oy: -28, w: 32, h: 40 };
    var o = decorCanvas('d|worldgate', 32, 40, function (x) {
      shadowEllipse(x, 16, 37, 12, 3.6, 0.40);
      /* 光幕（拱形内芯，裁剪在拱内） */
      x.save();
      x.beginPath();
      x.moveTo(9.5, 35); x.lineTo(9.5, 17);
      x.quadraticCurveTo(16, 8, 22.5, 17); x.lineTo(22.5, 35);
      x.closePath();
      x.clip();
      var sg = x.createLinearGradient(0, 9, 0, 35);
      sg.addColorStop(0, 'rgba(168,212,255,0.62)');
      sg.addColorStop(0.55, 'rgba(126,176,244,0.42)');
      sg.addColorStop(1, 'rgba(88,132,212,0.22)');
      x.fillStyle = sg; x.fillRect(8, 8, 16, 28);
      x.fillStyle = 'rgba(226,240,255,0.22)';
      x.fillRect(12, 12, 1.2, 22); x.fillRect(18.6, 15, 1.2, 19);
      x.restore();
      /* 石拱框 */
      x.strokeStyle = '#6f6858'; x.lineWidth = 2.6; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(8.6, 36); x.lineTo(8.6, 17);
      x.quadraticCurveTo(16, 4.6, 23.4, 17); x.lineTo(23.4, 36);
      x.stroke();
      x.strokeStyle = 'rgba(216,183,104,0.55)'; x.lineWidth = 0.9;
      x.beginPath();
      x.moveTo(10.2, 36); x.lineTo(10.2, 17.4);
      x.quadraticCurveTo(16, 6.8, 21.8, 17.4); x.lineTo(21.8, 36);
      x.stroke();
      /* 门楣金符 + 基座 */
      x.fillStyle = 'rgba(236,206,116,0.92)';
      x.fillRect(15.2, 7.6, 1.6, 1.6);
      x.fillStyle = '#5b5546';
      x.fillRect(5.5, 35, 6.5, 2.6); x.fillRect(20, 35, 6.5, 2.6);
    });
    return { c: o.c, ox: -8, oy: -28, w: 32, h: 40 };
  };

  /* Boss 巢穴 */
  A.boss = function (pal) {
    var im = G.Assets.img('obj.boss');
    if (im) return { c: im, ox: -8, oy: -16 };
    var o = decorCanvas('d|boss|' + pal.ground, 32, 32, function (x) {
      shadowEllipse(x, 16, 29, 12, 4, 0.42);
      /* 岩台 */
      var rg = x.createLinearGradient(0, 16, 0, 30);
      rg.addColorStop(0, '#3a3038');
      rg.addColorStop(1, '#1c1820');
      x.fillStyle = rg;
      x.beginPath();
      x.ellipse(16, 24, 13, 7.5, 0, 0, 6.2832);
      x.fill();
      /* 骨堆 */
      x.strokeStyle = '#cfc6b0';
      x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(8, 22); x.lineTo(13, 18); x.stroke();
      x.beginPath(); x.moveTo(24, 22); x.lineTo(19, 18.5); x.stroke();
      x.fillStyle = '#e0d8c2';
      x.beginPath(); x.arc(16, 19.5, 2.6, 0, 6.2832); x.fill();
      x.fillStyle = '#2a2028';
      x.fillRect(14.8, 18.6, 1, 1.2);
      x.fillRect(16.4, 18.6, 1, 1.2);
      /* 凶煞红光 */
      var gg = x.createRadialGradient(16, 20, 1, 16, 20, 14);
      gg.addColorStop(0, 'rgba(224,74,60,0.42)');
      gg.addColorStop(1, 'rgba(224,74,60,0)');
      x.fillStyle = gg;
      x.beginPath(); x.arc(16, 20, 14, 0, 6.2832); x.fill();
    });
    return { c: o.c, ox: -8, oy: -16, w: 32, h: 32 };
  };

  /* ============================================================
     五b、人物立绘（半身像）
     逻辑尺寸就是覆盖层立绘框的 74×74 —— 1:1 绘制，不缩放、不裁切。
     装了 portrait.<key> 素材就整张替换（等比"内含"缩放居中），否则按参数表程序化画。
     key 取美术 v0.2 §3 的 M0 七位（陆尘/沈伯/重伤老者/尘逆残影/杀手/刘掌柜/狼王）
     外加泛用的 villager。狼王只作敌人，立绘走 battle.enemy.wolfking，不在此表。
     ============================================================ */
  var PORTRAIT_LW = 74, PORTRAIT_LH = 74;
  /* 素材立绘按内容裁完后的"呼吸位"系数（见 A.portrait） */
  var PORTRAIT_FIT = 0.92;

  var PORTRAIT_P = {
    luchen: { hair: '#2b2833', skin: '#efc49c', robe: '#3f6f8c', robe2: '#2d5470',
      collar: '#e8e2d0', eye: '#241f2b', brow: '#2b2833' },
    shenbo: { hair: '#8d8b86', skin: '#e8bd94', robe: '#5f7261', robe2: '#47574a',
      collar: '#e6ddc2', eye: '#2a2530', brow: '#6e6c68', beard: '#cfccc0' },
    elder: { hair: '#d8d5cc', skin: '#dcae86', robe: '#6b6257', robe2: '#4e4740',
      collar: '#ddd4bd', eye: '#2a2530', brow: '#cfccc0', beard: '#efeee8' },
    keeper: { hair: '#332f3a', skin: '#e8b890', robe: '#7a6a52', robe2: '#5a4d3a',
      collar: '#e6ddc2', eye: '#241f2b', brow: '#332f3a',
      hat: '#3a3f52', hat2: '#525870', stache: '#332f3a' },
    killer: { hair: '#1c1a22', skin: '#c9a184', robe: '#3a2730', robe2: '#26181f',
      collar: '#5a2b2f', eye: '#c8543f', brow: '#1c1a22',
      hood: '#2a1e26', mask: '#15121a', glow: true },
    demon: { hair: '#171520', skin: '#8e8798', robe: '#241a2e', robe2: '#170f20',
      collar: '#4a2a52', eye: '#ff7a4a', brow: '#171520',
      hood: '#1b1424', glow: true },
    /* 血煞教探子（M1 §4）：化名"行脚商"，所以**不给兜帽**（那等于直接贴标签），
       只用压暗红的袍子 + 一点血色眼 —— 玩家该觉得"这人不对劲"，但不该一眼看穿。 */
    cultist: { hair: '#231d24', skin: '#d8ac86', robe: '#7a343d', robe2: '#3d171c',
      collar: '#c9a2a6', eye: '#b8483a', brow: '#231d24' },
    aran: { hair: '#2f2a34', skin: '#f2c9a4', robe: '#b06a72', robe2: '#8d4f58',
      collar: '#f0e6d4', eye: '#2b2530', brow: '#2f2a34' },
    villager: { hair: '#3a3440', skin: '#e6b98e', robe: '#8a8a92', robe2: '#66666e',
      collar: '#e6ddc2', eye: '#241f2b', brow: '#3a3440' }
  };

  function portraitDraw(x, P) {
    var W = PORTRAIT_LW, H = PORTRAIT_LH;
    var cx = W / 2, hy = 27, hr = 16;         /* 头心与头半径 */

    /* 底：四角压暗的暗角 —— 立绘框落在深色面板里，没有暗角时半身像会"浮"在底色上 */
    var vg = x.createRadialGradient(cx, hy + 6, 18, cx, hy + 10, 50);
    vg.addColorStop(0, 'rgba(6,8,14,0)');
    vg.addColorStop(1, 'rgba(6,8,14,0.46)');
    x.fillStyle = vg;
    x.fillRect(0, 0, W, H);

    /* 头后紧光晕（不能大：和袍子同色的大光晕会把肩膀吃掉，轮廓就散了） */
    var rg = x.createRadialGradient(cx, hy + 2, 2, cx, hy + 2, 30);
    rg.addColorStop(0, alpha(P.robe, 0.28));
    rg.addColorStop(1, alpha(P.robe, 0));
    x.fillStyle = rg;
    x.fillRect(0, 0, W, H);

    /* 兜帽先铺在头后，脸再压上去 */
    if (P.hood) {
      x.beginPath();
      x.ellipse(cx, hy - 2, hr * 1.30, hr * 1.38, 0, 0, 6.2832);
      x.fillStyle = P.hood; x.fill();
    }

    /* 肩与身 */
    x.beginPath();
    x.moveTo(cx - 33, H);
    x.quadraticCurveTo(cx - 29, 54, cx - 13, 47);
    x.lineTo(cx + 13, 47);
    x.quadraticCurveTo(cx + 29, 54, cx + 33, H);
    x.closePath();
    x.fillStyle = P.robe; x.fill();
    /* 轮廓描边：亮地面/暗底都要能读出人形 */
    x.lineWidth = 1;
    x.strokeStyle = 'rgba(0,0,0,0.38)';
    x.stroke();
    /* 左肩受光 + 下摆压暗，避免读成一块平色 */
    x.fillStyle = alpha('#ffffff', 0.13);
    x.beginPath();
    x.moveTo(cx - 31, 58); x.quadraticCurveTo(cx - 25, 50, cx - 11, 48);
    x.lineTo(cx - 3, 48); x.lineTo(cx - 7, 58); x.closePath(); x.fill();
    x.fillStyle = alpha(P.robe2, 0.85);
    x.fillRect(cx - 33, 66, 66, H - 66);

    /* 交领 */
    x.beginPath();
    x.moveTo(cx - 9, 47); x.lineTo(cx, 64); x.lineTo(cx + 9, 47);
    x.closePath(); x.fillStyle = P.collar; x.fill();
    x.beginPath();
    x.moveTo(cx - 9, 47); x.lineTo(cx - 1.5, 57); x.lineTo(cx - 4, 47);
    x.closePath(); x.fillStyle = alpha('#000000', 0.16); x.fill();

    /* 颈 */
    x.fillStyle = shade(P.skin, -0.16);
    x.fillRect(cx - 6.5, 36, 13, 12);

    /* 头发底 → 脸（脸略小略下，自然留出发际线）。
       先垫一圈暗描边：沈伯/重伤老者是浅发色，没有它会在光晕里糊成一团。 */
    x.beginPath();
    x.ellipse(cx, hy - 0.5, hr * 1.02, hr * 1.09, 0, 0, 6.2832);
    x.fillStyle = 'rgba(0,0,0,0.32)'; x.fill();
    x.beginPath();
    x.ellipse(cx, hy - 1.5, hr * 0.96, hr * 1.03, 0, 0, 6.2832);
    x.fillStyle = P.hair; x.fill();
    x.beginPath();
    x.ellipse(cx, hy + 1.8, hr * 0.86, hr * 0.95, 0, 0, 6.2832);
    x.fillStyle = P.skin; x.fill();

    /* 耳 */
    [-1, 1].forEach(function (s) {
      x.beginPath();
      x.ellipse(cx + s * hr * 0.88, hy + 3.4, 2.6, 4.0, 0, 0, 6.2832);
      x.fillStyle = shade(P.skin, -0.10); x.fill();
    });

    /* 右颊与下颌的侧影 */
    x.beginPath();
    x.ellipse(cx + hr * 0.50, hy + 4, hr * 0.36, hr * 0.60, 0, 0, 6.2832);
    x.fillStyle = alpha('#3a2418', 0.14); x.fill();

    /* 眉 + 眼 */
    [-1, 1].forEach(function (s) {
      var ex = cx + s * 5.4;
      x.fillStyle = P.brow;
      x.fillRect(ex - 2.6, hy - 5.2, 5.2, 1.3);
      x.beginPath(); x.ellipse(ex, hy + 0.6, 2.2, 1.6, 0, 0, 6.2832);
      x.fillStyle = '#f2ece0'; x.fill();
      x.beginPath(); x.arc(ex, hy + 0.6, 1.25, 0, 6.2832);
      x.fillStyle = P.eye; x.fill();
      /* 上眼睑：压住眼球上缘，眼睛才不"瞪" */
      x.fillStyle = alpha('#2a1f28', 0.55);
      x.fillRect(ex - 2.2, hy - 1.1, 4.4, 0.9);
    });

    /* 鼻 */
    x.fillStyle = alpha('#6b3f2a', 0.32);
    x.fillRect(cx - 0.7, hy + 3.4, 1.4, 4.6);
    x.beginPath(); x.ellipse(cx, hy + 8.2, 2.0, 1.0, 0, 0, 6.2832); x.fill();

    /* 嘴 */
    x.fillStyle = alpha('#7a3a3a', 0.62);
    x.fillRect(cx - 3.2, hy + 11.6, 6.4, 1.3);

    /* 髭须 / 络腮胡 */
    if (P.stache) {
      x.fillStyle = P.stache;
      x.fillRect(cx - 5.6, hy + 9.4, 4.6, 1.8);
      x.fillRect(cx + 1.0, hy + 9.4, 4.6, 1.8);
    }
    if (P.beard) {
      x.beginPath();
      x.moveTo(cx - 8.4, hy + 8.6);
      x.quadraticCurveTo(cx - 9.6, hy + 20, cx - 3.0, hy + 23.5);
      x.quadraticCurveTo(cx, hy + 25, cx + 3.0, hy + 23.5);
      x.quadraticCurveTo(cx + 9.6, hy + 20, cx + 8.4, hy + 8.6);
      x.quadraticCurveTo(cx, hy + 15.5, cx - 8.4, hy + 8.6);
      x.closePath();
      x.fillStyle = P.beard; x.fill();
      x.fillStyle = alpha('#ffffff', 0.26);
      x.beginPath();
      x.ellipse(cx - 3.4, hy + 12.8, 2.8, 4.4, 0, 0, 6.2832); x.fill();
    }

    /* 面罩（杀手） */
    if (P.mask) {
      x.beginPath();
      x.moveTo(cx - 12.2, hy + 5.2);
      x.quadraticCurveTo(cx, hy + 9.4, cx + 12.2, hy + 5.2);
      x.lineTo(cx + 10.4, hy + 15.5);
      x.quadraticCurveTo(cx, hy + 19.5, cx - 10.4, hy + 15.5);
      x.closePath();
      x.fillStyle = P.mask; x.fill();
    }

    /* 发髻与鬓发（戴帽/戴兜帽时不画，免得从帽檐下钻出来） */
    if (!P.hood && !P.hat) {
      x.fillStyle = P.hair;
      x.beginPath(); x.ellipse(cx, hy - hr * 0.98, 5.2, 4.2, 0, 0, 6.2832); x.fill();
      [-1, 1].forEach(function (s) {
        x.beginPath();
        x.ellipse(cx + s * hr * 0.80, hy + 6.5, 2.8, 7.0, 0, 0, 6.2832);
        x.fill();
      });
    }

    /* 头巾/帽（掌柜） */
    if (P.hat) {
      x.beginPath();
      x.ellipse(cx, hy - 5.2, hr * 0.92, hr * 0.74, 0, Math.PI, 6.2832);
      x.closePath(); x.fillStyle = P.hat; x.fill();
      x.fillStyle = P.hat2 || P.hat;
      x.fillRect(cx - hr * 0.98, hy - 6.8, hr * 1.96, 2.6);
      x.beginPath(); x.ellipse(cx, hy - hr * 1.04, 4.4, 3.4, 0, 0, 6.2832);
      x.fillStyle = P.hat2 || P.hat; x.fill();
    }

    /* 兜帽内圈：只在脸的外缘留一圈帽檐（内孔与脸同形，绝不切到脸） */
    if (P.hood) {
      x.beginPath();
      x.ellipse(cx, hy - 2, hr * 1.30, hr * 1.38, 0, 0, 6.2832);
      x.ellipse(cx, hy + 1.8, hr * 0.88, hr * 0.97, 0, 6.2832, 0, true);
      x.fillStyle = P.hood; x.fill();
    }

    /* 目露凶光（杀手 / 心魔） */
    if (P.glow) {
      x.save();
      x.globalCompositeOperation = 'lighter';
      [-1, 1].forEach(function (s) {
        var ex = cx + s * 5.4;
        var gg = x.createRadialGradient(ex, hy + 0.6, 0.4, ex, hy + 0.6, 5.2);
        gg.addColorStop(0, alpha(P.eye, 0.95));
        gg.addColorStop(1, alpha(P.eye, 0));
        x.fillStyle = gg;
        x.fillRect(ex - 6, hy - 5.5, 12, 12);
      });
      x.restore();
    }
  }

  /* 立绘的"素材兜底链"：这些角色本来就有 AI 生成的战斗立绘，
     立绘优先用它 —— 否则角色面板里的脸跟地图上走着的人对不上（用户报过）。
     顺序：portrait.<key> 专属立绘 > 下表里的战斗立绘 > 程序化半身像。 */
  var PORTRAIT_ART = {
    luchen: 'battle.hero',
    killer: 'battle.enemy.killer',
    demon: 'battle.enemy.heartDemon'
  };

  /* 量一张素材"不透明像素"的包围盒。
     为什么要这一步：AI 出的立绘四周留白**不对称**（战斗立绘的刀往左伸、
     头发往右飘），直接按整图"内含"缩放居中，可见内容就会整体偏出画框中心 ——
     角色面板里看着就是"人没站在框中间"。按内容居中才稳。
     量不到（桩环境 getImageData 只给 4 字节 / 整图全透明）就返回 null，退回整图。 */
  function contentBox(im, iw, ih) {
    try {
      var t = document.createElement('canvas');
      t.width = iw; t.height = ih;
      var tx = t.getContext('2d');
      tx.drawImage(im, 0, 0);
      var d = tx.getImageData(0, 0, iw, ih).data;
      var x0 = iw, y0 = ih, x1 = -1, y1 = -1;
      for (var y = 0; y < ih; y++) {
        for (var x = 0; x < iw; x++) {
          if (d[(y * iw + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < x0 || y1 < y0) return null;
      return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
    } catch (e) { return null; }
  }

  /* 立绘：返回 {c, ox, oy, w, h}。素材走"内含"缩放居中，绝不裁切。
     立绘不吃调色板（程序化配色写在 PORTRAIT_P 里），所以缓存键只带 key。
     注意：素材到货后必须让缓存失效 —— game.js 的素材回调会调 G.Art.clear()。 */
  A.portrait = function (key) {
    key = key || 'villager';
    var o = cached('portrait|' + key, PORTRAIT_LW, PORTRAIT_LH, function (x) {
      var im = G.Assets && G.Assets.img ? G.Assets.img('portrait.' + key) : null;
      if (!im && PORTRAIT_ART[key] && G.Assets && G.Assets.img) {
        im = G.Assets.img(PORTRAIT_ART[key]);
      }
      if (im) {
        var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
        var cb = contentBox(im, iw, ih);
        var sx = cb ? cb[0] : 0, sy = cb ? cb[1] : 0;
        var sw = cb ? cb[2] : iw, sh = cb ? cb[3] : ih;
        /* 按内容裁完还要留一点呼吸位：贴着框边看着像被切了（头顶留白 0.7px 就是这问题）。
           PORTRAIT_FIT 是"内容最多占框的多少"，0.92 大约上下各留 3px。 */
        var s = Math.min(PORTRAIT_LW / sw, PORTRAIT_LH / sh) * PORTRAIT_FIT;
        var dw = sw * s, dh = sh * s;
        x.drawImage(im, sx, sy, sw, sh,
          (PORTRAIT_LW - dw) / 2, (PORTRAIT_LH - dh) / 2, dw, dh);
        return;
      }
      portraitDraw(x, PORTRAIT_P[key] || PORTRAIT_P.villager);
    });
    return { c: o.c, ox: 0, oy: 0, w: PORTRAIT_LW, h: PORTRAIT_LH };
  };
  A.PORTRAIT_SIZE = [PORTRAIT_LW, PORTRAIT_LH];
  A.PORTRAIT_KEYS = Object.keys(PORTRAIT_P);
  A.PORTRAIT_ART = PORTRAIT_ART;

  /* HUD 圆形头像专用素材（`avatar.<key>`）。
     为什么单开一张：圆形头像只取"脸"那一小块，拿**全身立绘**裁头要放大 4 倍
     （源 9 逻辑 px → 目标 36 逻辑 px），圆里糊成一团、看不出是谁。
     专用胸像的面部像素密度够，1 倍出头就够用。
     没登记的角色照旧走 portrait.<key>，行为完全不变。 */
  var AVATAR_ART = { luchen: 'avatar.luchen' };
  A.AVATAR_ART = AVATAR_ART;

  /* 头像取景源：返回 74×74 逻辑框内的画布（与 A.portrait 同尺寸，可直接 blit）。
     有 avatar.<key> 用它；否则直接退回 A.portrait（含 battle.hero 兜底链）。 */
  A.avatar = function (key) {
    key = key || 'villager';
    var ak = AVATAR_ART[key];
    var im = (ak && G.Assets && G.Assets.img) ? G.Assets.img(ak) : null;
    if (!im) return A.portrait(key);
    var o = cached('avatar|' + key, PORTRAIT_LW, PORTRAIT_LH, function (x) {
      var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      var cb = contentBox(im, iw, ih);
      var sx = cb ? cb[0] : 0, sy = cb ? cb[1] : 0;
      var sw = cb ? cb[2] : iw, sh = cb ? cb[3] : ih;
      var s = Math.min(PORTRAIT_LW / sw, PORTRAIT_LH / sh) * PORTRAIT_FIT;
      var dw = sw * s, dh = sh * s;
      x.drawImage(im, sx, sy, sw, sh,
        (PORTRAIT_LW - dw) / 2, (PORTRAIT_LH - dh) / 2, dw, dh);
    });
    return { c: o.c, ox: 0, oy: 0, w: PORTRAIT_LW, h: PORTRAIT_LH };
  };

  /* 头像取景：立绘里「脸」的位置 —— [cx, cy, 源正方形边长]，逻辑坐标，相对 74×74 立绘框。
     为什么要一张表：立绘有两种版式，取景必须分开写
       · 全身站姿（battle.hero）：发髻在 y=3、下巴在 y=17，头只占框高的 20%；
       · 半身像（程序化 portraitDraw）：头心 y=27、头半径 16，头占框高的 43%。
     为什么不用自动检测：实测 battle.hero 的逐行 alpha 宽度是
       3:w3 → 10:w17 → 17:w11 → 24:w18 → 45:w25 → 56:w32
     —— 肩颈是**平滑过渡**，没有"脖子塌陷"这个断点，任何"宽度突变就停"的
     启发式都会一路扫到腰。所以改成显式表：换素材时改这里一行，比修启发式靠谱。 */
  var AVATAR_HEAD = {
    luchen: [36, 12, 20],              /* 兜底：portrait.luchen 全身正面立绘 */
    'avatar.luchen': [36, 34, 44]      /* 专用正面胸像：脸心略偏上、含肩 */
  };
  /* 兜底 = 程序化半身像的几何：头心 (37,27)、头半径 16 → 边长 16*2/0.72 ≈ 44 */
  var AVATAR_HEAD_DEF = [PORTRAIT_LW / 2, 27, 44];
  /* 取景表按**实际用的那张图**查：有 avatar.<key> 就查它，否则查立绘键。
     两张图的版式不同（全身 vs 胸像），混用会把脸裁到肩膀上去。 */
  A.headBox = function (key) {
    var ak = AVATAR_ART[key];
    if (ak && G.Assets && G.Assets.img && G.Assets.img(ak)) {
      return AVATAR_HEAD[ak] || AVATAR_HEAD_DEF;
    }
    return AVATAR_HEAD[key] || AVATAR_HEAD_DEF;
  };

  /* ============================================================
     六、氛围 / 特效
     ============================================================ */
  /* 洞窟光晕：以玩家为中心的暗幕 */
  A.caveVeil = function (w, h) {
    var key = 'veil|' + w + 'x' + h;
    return cached(key, w, h, function (x) {
      x.fillStyle = 'rgba(4,5,10,0.80)';
      x.fillRect(0, 0, w, h);
    }).c;
  };

  /* 战斗地面台座 */
  A.arena = function (w, h) {
    return cached('arena|' + w + 'x' + h, w, h, function (x) {
      var g = x.createRadialGradient(w / 2, h, 4, w / 2, h, w * 0.62);
      g.addColorStop(0, 'rgba(120,132,170,0.30)');
      g.addColorStop(0.55, 'rgba(80,92,128,0.12)');
      g.addColorStop(1, 'rgba(80,92,128,0)');
      x.fillStyle = g;
      x.beginPath(); x.ellipse(w / 2, h, w * 0.62, h * 0.86, 0, 0, 6.2832); x.fill();
    }).c;
  };

  /* ============================================================
     导出
     ============================================================ */
  A.K = K;
  A.hx = hx; A.rgb = rgb; A.shade = shade; A.mix = mix; A.alpha = alpha; A.rnd = rnd;
  G.Art = A;
})();
