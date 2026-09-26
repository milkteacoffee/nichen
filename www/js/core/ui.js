/* UI 套件 v2 —— 仙穹云海 + 青玉辉光 + 描金
   ─ 面板/按钮/条框全部预渲染缓存（3 倍超采样），运行时只 drawImage，零性能负担。
   ─ 风格基调：修仙界的「腾云驾雾」—— 深青紫底 + 流云纹理 + 青玉/月白辉光 + 云纹角饰。
     （v0.13.0 初版做过一版「宣纸水墨」，与世界观不符已废弃：这是仙侠世界，
      不是凡俗纸墨 —— 面板要像**悬在云海里的玉牌**，不是摊在桌上的纸。） */
(function () {
  var A = G.Art;

  /* ---------- 调色板（保留旧键名，向后兼容） ----------
     v0.13.0 起分**两套材质**：
       · 墨夜（默认值，就是下面这份）：HUD 顶栏、底栏、场景内小浮层 —— 近黑蓝灰 + 暖金；
       · 云海：六面板、对话框、抉择卡、关于页、**所有 `UI.frame` 主面板** ——
         深青紫 + 流云 + 月白/青玉辉光（见 `UI.mist`）。
     语义色（text / textDim / line / gold / goldHi / jade / jadeHi / panel / panelDark /
     frameFill / frameBorder / rule / ruleHi / barBg / barBgDeep / barLine）在进入云海
     作用域时会被**就地改写**，退出时还原 —— 见 `UI.mist`。
     这样全项目 100+ 处 `C.textDim` / `C.gold` 这类引用**一行都不用动**。
     ⚠️ 铁律：作用域内不得把 `C.xxx` 缓存进变量再带出作用域（目前全项目无此写法，
        加新的请就地取、就地用）。 */
  var C = {
    ink: '#0b0d14',
    night: '#101423',
    panel: '#1a1f2e', panelDark: '#12151f',
    line: '#3d465e', lineSoft: '#262c40',
    gold: '#d8b768', goldHi: '#f5e3a8', goldDeep: '#a8843f',
    text: '#eae6da', textDim: '#8f95a6',
    danger: '#c75450', charge: '#e0603c',
    hp: '#c75450', mp: '#5b86b8', qi: '#6fae8f',
    /* 新增 */
    jade: '#6fae8f', jadeHi: '#a8dcc4',
    seal: '#9c3a32', sealHi: '#c2504a',
    /* 面板框与装饰线（原先散在调用点硬编码，收进来才翻得动） */
    frameFill: '#161b28', frameBorder: 'rgba(216,183,104,0.7)',
    rule: 'rgba(216,183,104,0.18)', ruleHi: 'rgba(216,183,104,0.45)',
    barBg: '#0a0c14', barBgDeep: '#05070c', barLine: 'rgba(216,183,104,0.34)'
  };

  /* 云海版本的**语义色**（键与 C 同名；只列需要翻转的那些）。
     取值原则：云海面板是**深青紫**，比墨夜更蓝、更透、更「仙」——
     正文提亮成月白（冷白），金换成更透的青金，绿换成青玉。
     ⚠️ 不要把这里改成浅底：曾经做过一版米黄宣纸（浅底深字），与修仙世界观不符。 */
  var MIST_C = {
    text: '#e4eefb', textDim: '#93a8c8',
    line: '#3f5a80',
    panel: '#1c2949', panelDark: '#121a30',
    frameFill: '#1a2644', frameBorder: 'rgba(158,206,246,0.52)',
    gold: '#e6cb8b', goldHi: '#fdf2d2', goldDeep: '#a8873f',
    jade: '#7fdcc4', jadeHi: '#bdf3e4',
    rule: 'rgba(158,206,246,0.20)', ruleHi: 'rgba(158,206,246,0.48)',
    barBg: '#0c1425', barBgDeep: '#070d19', barLine: 'rgba(158,206,246,0.32)'
  };
  /* 墨夜原值快照：还原时照抄回去（别用"反向再算一遍"，两套值必须可逆） */
  var DARK_C = {};
  Object.keys(MIST_C).forEach(function (k) { DARK_C[k] = C[k]; });

  var mistDepth = 0;
  function setMistColors(on) {
    Object.keys(MIST_C).forEach(function (k) { C[k] = on ? MIST_C[k] : DARK_C[k]; });
  }
  /* ⚠️ 只在**最外层**进出时改写色表。
     曾经写成"每次调用都 set + depth±1"，于是嵌套作用域出内层时会把色表**提前还原**
     （`UI.frame` 现在自己也会进一层 → 外层对话框套内层面板立刻踩到）：
     表现为"内层面板是云海、外层文字却是墨夜色"，且只在截图里看得出来。 */
  function applyMist(on) {
    if (on) {
      mistDepth += 1;
      if (mistDepth === 1) setMistColors(true);
    } else {
      mistDepth -= 1;
      if (mistDepth <= 0) { mistDepth = 0; setMistColors(false); }
    }
  }
  /* 当前是否处于云海作用域 —— **缓存键必须带上它**：
     barFrame 之类的缓存只按尺寸做键，两套材质共用一张就会串色（第一次生成的赢）。 */
  function isMist() { return mistDepth > 0; }

  function F(size, pixel) {
    if (pixel) return 'bold ' + size + 'px "Ark Pixel", "Courier New", monospace';
    return size + 'px "LXGW WenKai", "KaiTi", "Microsoft YaHei", serif';
  }

  /* 图标绘制本体（坐标以 0,0 为中心，s 为半尺寸）。
     抽成独立函数是为了让 UI.icon 能把它预烘成小画布再 blit。 */
  function drawIcon(x, kind, s) {
    if (kind === 'stone') {           /* 灵石：菱形宝石 */
      var g = x.createLinearGradient(-s, -s, s, s);
      g.addColorStop(0, '#cfe8ff');
      g.addColorStop(0.5, '#7fb6e6');
      g.addColorStop(1, '#3d6fa8');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(0, -s * 0.95); x.lineTo(s * 0.78, 0);
      x.lineTo(0, s * 0.95); x.lineTo(-s * 0.78, 0);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(230,245,255,0.8)'; x.lineWidth = 0.7; x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.55)';
      x.beginPath(); x.moveTo(-s * 0.3, -s * 0.4); x.lineTo(0, -s * 0.6);
      x.lineTo(s * 0.1, -s * 0.1); x.closePath(); x.fill();
    } else if (kind === 'qi') {        /* 灵气：云气旋 */
      x.strokeStyle = '#8fe0c4';
      x.lineWidth = Math.max(1, s * 0.2);
      x.lineCap = 'round';
      for (var i = 0; i < 2; i++) {
        x.beginPath();
        x.arc(0, 0, s * (0.42 + i * 0.4), 0.5 + i * 1.2, 3.4 + i * 1.2);
        x.stroke();
      }
      x.fillStyle = '#d8fff0';
      x.beginPath(); x.arc(0, 0, s * 0.17, 0, 6.2832); x.fill();
    } else if (kind === 'po') {        /* 力：拳 */
      x.fillStyle = '#e0a060';
      x.beginPath();
      x.moveTo(-s * 0.7, s * 0.75);
      x.lineTo(-s * 0.62, -s * 0.3);
      x.quadraticCurveTo(0, -s * 0.95, s * 0.62, -s * 0.3);
      x.lineTo(s * 0.7, s * 0.75);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(80,40,10,0.55)'; x.lineWidth = 0.7;
      x.beginPath(); x.moveTo(-s * 0.3, -s * 0.5); x.lineTo(-s * 0.3, s * 0.5);
      x.moveTo(0, -s * 0.65); x.lineTo(0, s * 0.6);
      x.moveTo(s * 0.3, -s * 0.5); x.lineTo(s * 0.3, s * 0.5);
      x.stroke();
    } else if (kind === 'crystal') {   /* 仙晶：双柱棱晶（与"灵石"的菱形明确区分开） */
      x.fillStyle = '#c9a8f0';
      x.beginPath();
      x.moveTo(-s * 0.72, s * 0.78);
      x.lineTo(-s * 0.5, -s * 0.55);
      x.lineTo(-s * 0.08, -s * 0.9);
      x.lineTo(-s * 0.08, s * 0.78);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(60,30,90,0.6)'; x.lineWidth = 0.6; x.stroke();
      x.fillStyle = '#e8d8ff';
      x.beginPath();
      x.moveTo(s * 0.08, s * 0.78);
      x.lineTo(s * 0.3, -s * 0.35);
      x.lineTo(s * 0.66, -s * 0.72);
      x.lineTo(s * 0.66, s * 0.78);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(60,30,90,0.5)'; x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.75)';
      x.beginPath();
      x.moveTo(s * 0.34, -s * 0.3); x.lineTo(s * 0.5, -s * 0.6);
      x.lineTo(s * 0.56, -s * 0.2); x.closePath(); x.fill();
    } else if (kind === 'hp') {
      x.fillStyle = '#d9534f';
      x.beginPath();
      x.moveTo(0, s * 0.8);
      x.bezierCurveTo(-s * 1.3, -s * 0.1, -s * 0.5, -s * 1.1, 0, -s * 0.35);
      x.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.3, -s * 0.1, 0, s * 0.8);
      x.fill();
    } else if (kind === 'atk') {
      x.strokeStyle = '#d8dde8'; x.lineWidth = Math.max(1, s * 0.24);
      x.beginPath(); x.moveTo(-s * 0.5, s * 0.7); x.lineTo(s * 0.6, -s * 0.6); x.stroke();
      x.strokeStyle = '#c8a24e'; x.lineWidth = Math.max(1, s * 0.22);
      x.beginPath(); x.moveTo(-s * 0.75, s * 0.35); x.lineTo(-s * 0.35, s * 0.8); x.stroke();
    } else if (kind === 'def') {
      x.fillStyle = '#8fa8c8';
      x.beginPath();
      x.moveTo(0, -s * 0.85);
      x.lineTo(s * 0.75, -s * 0.5);
      x.lineTo(s * 0.62, s * 0.35);
      x.lineTo(0, s * 0.9);
      x.lineTo(-s * 0.62, s * 0.35);
      x.lineTo(-s * 0.75, -s * 0.5);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 0.7; x.stroke();
    } else if (kind === 'spd') {
      x.strokeStyle = '#a8e0f0'; x.lineWidth = Math.max(1, s * 0.2);
      x.lineCap = 'round';
      [-0.45, 0, 0.45].forEach(function (dy, i) {
        x.beginPath();
        x.moveTo(-s * 0.8 + i * 0.1, dy * s);
        x.lineTo(s * 0.7 - i * s * 0.1, dy * s);
        x.stroke();
      });
    }
  }

  function rr(x, s, r) {
    r = r == null ? 3 : r;
    x.beginPath();
    x.moveTo(s.x + r, s.y);
    x.arcTo(s.x + s.w, s.y, s.x + s.w, s.y + s.h, r);
    x.arcTo(s.x + s.w, s.y + s.h, s.x, s.y + s.h, r);
    x.arcTo(s.x, s.y + s.h, s.x, s.y, r);
    x.arcTo(s.x, s.y, s.x + s.w, s.y, r);
    x.closePath();
  }

  /* ---------- 缓存 ---------- */
  var cache = {};
  function cachedCanvas(key, w, h, fn) {
    if (cache[key]) return cache[key];
    var o = A.cv(w, h);
    fn(o.x);
    cache[key] = o.c;
    return o.c;
  }
  function clearCache() { cache = {}; }

  /* ---------- 云纹角饰（v0.13.0） ----------
     替代原来的「回纹直角」：每角两段同心圆弧，朝面板内侧卷 —— 云头卷。
     云纹是修仙题材最省笔墨的「仙气」符号，且同样只有 0.9px 线宽，
     不会像当年的回纹那样一屏几十个面板叠出一张铁丝网。
     （历史：v0.8.0 删掉内折小钩、v0.11.x 删掉按钮上的角饰，都是同一个教训 ——
       装饰件的成本要按「一屏出现多少次」算，不是按单件好不好看。） */
  function cloudCurls(x, s, col, r) {
    r = r || 5;
    x.strokeStyle = col;
    x.lineWidth = 0.9;
    x.lineCap = 'round';
    var o = 3.2;                        /* 角点内缩 */
    /* 每角：圆弧圆心 + 起止角（朝面板内侧卷） */
    var corners = [
      [s.x + o + r, s.y + o + r, Math.PI, Math.PI * 1.5],
      [s.x + s.w - o - r, s.y + o + r, Math.PI * 1.5, Math.PI * 2],
      [s.x + s.w - o - r, s.y + s.h - o - r, 0, Math.PI * 0.5],
      [s.x + o + r, s.y + s.h - o - r, Math.PI * 0.5, Math.PI]
    ];
    corners.forEach(function (c) {
      for (var i = 0; i < 2; i++) {
        x.beginPath();
        x.arc(c[0], c[1], r * (0.52 + i * 0.48), c[2], c[3]);
        x.stroke();
      }
    });
  }

  /* ---------- 面板 ---------- */
  function panelCanvas(w, h, fill, border, r, opt) {
    opt = opt || { tex: true };
    /* ⚠️ 缓存键**必须带材质标记**：外框/角饰的默认色随作用域翻转，
       只按尺寸与显式色做键会让"第一次生成的赢"，云海面板沿用墨夜那张（或反过来）—— 静默串色。 */
    var key = 'p|' + (isMist() ? 'm' : 'd') + '|' + w + 'x' + h + '|' + fill + '|' + border + '|' + r
      + '|' + (opt.corners ? 1 : 0) + '|' + (opt.tex ? 1 : 0) + '|' + (opt.shadow === false ? 0 : 1);
    var pad = opt.shadow === false ? 0 : 4;
    return cachedCanvas(key, w + pad * 2, h + pad * 2, function (x) {
      x.translate(pad, pad);
      var s = { x: 0, y: 0, w: w, h: h };

      /* 投影：偏青的柔光，不用纯黑（纯黑会把云海面板压成"贴上去的硬块"） */
      if (opt.shadow !== false) {
        x.save();
        x.shadowColor = 'rgba(4,10,26,0.62)';
        x.shadowBlur = 7;
        x.shadowOffsetY = 2.2;
        rr(x, s, r);
        x.fillStyle = 'rgba(8,14,30,0.92)';
        x.fill();
        x.restore();
      }

      /* 底：青紫渐变（顶部天光略亮，底部沉下去） */
      var g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, A.shade(fill, 0.13));
      g.addColorStop(0.55, fill);
      g.addColorStop(1, A.shade(fill, -0.18));
      rr(x, s, r);
      x.fillStyle = g;
      x.fill();

      /* 流云纹理（`tex`）—— 面板的「仙气」全在这一层：
         若干条横向云带（两端淡出的椭圆）+ 顶部天光。
         云带用**固定种子**（由 w/h 派生）保证同尺寸每次生成一致，不会闪。
         ⚠️ 别改成"随机噪点"：那是旧纸/宣纸的质感，与云海是两回事。 */
      if (opt.tex) {
        x.save();
        rr(x, s, r); x.clip();
        var rnd = A.rnd(w * 71 + h * 13);
        var bands = Math.max(3, Math.round(h / 13));
        for (var i = 0; i < bands; i++) {
          var by = h * (0.10 + 0.86 * (i / bands)) + (rnd() - 0.5) * h * 0.10;
          var bw = w * (0.42 + rnd() * 0.62);
          var bx = -w * 0.10 + rnd() * (w * 1.05);
          var bh = 3.4 + rnd() * (h * 0.055);
          var ba = 0.040 + rnd() * 0.070;
          var cg = x.createLinearGradient(bx, 0, bx + bw, 0);
          cg.addColorStop(0, 'rgba(214,236,255,0)');
          cg.addColorStop(0.5, 'rgba(214,236,255,' + ba.toFixed(3) + ')');
          cg.addColorStop(1, 'rgba(214,236,255,0)');
          x.fillStyle = cg;
          x.beginPath();
          x.ellipse(bx + bw / 2, by, bw / 2, bh, 0, 0, 6.2832);
          x.fill();
        }
        /* 顶部天光：云海之上透下来的一道光 */
        var tg = x.createLinearGradient(0, 0, 0, h * 0.40);
        tg.addColorStop(0, 'rgba(196,226,255,0.090)');
        tg.addColorStop(1, 'rgba(196,226,255,0)');
        x.fillStyle = tg; x.fillRect(0, 0, w, h * 0.40);
        x.restore();
      }

      /* 内缘辉光：贴着内边一圈冷光，做出"玉牌边缘在发光"的观感。
         只在 tex 面板上画 —— 小浮层（tex:false）本来就是要"沉下去"的。 */
      if (opt.tex) {
        rr(x, { x: 1.6, y: 1.6, w: w - 3.2, h: h - 3.2 }, Math.max(1, r - 1));
        x.strokeStyle = 'rgba(176,216,255,0.16)';
        x.lineWidth = 1.4;
        x.stroke();
      }

      /* 外框（唯一的一层硬描边） */
      rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, r);
      x.strokeStyle = border || C.line;
      x.lineWidth = 1;
      x.stroke();

      if (opt.corners) cloudCurls(x, s, C.ruleHi, Math.min(6.5, w * 0.11));
    });
  }

  /* ---------- 条框 ---------- */
  function barFrame(w, h) {
    /* ⚠️ 缓存键**必须带材质标记**：槽底/描边色随作用域翻转，只按尺寸做键
       会让"第一次生成的赢"，云海面板里的进度条沿用墨夜那张（或反过来）—— 静默串色。 */
    return cachedCanvas('bf|' + (isMist() ? 'm' : 'd') + '|' + w + 'x' + h, w, h, function (x) {
      var s = { x: 0, y: 0, w: w, h: h };
      rr(x, s, Math.min(2.5, h / 2));
      x.fillStyle = C.barBg;
      x.fill();
      /* 内凹 */
      rr(x, { x: 0.9, y: 0.9, w: w - 1.8, h: h - 1.8 }, Math.min(2, h / 2));
      x.fillStyle = C.barBgDeep;
      x.fill();
      /* 外框：细一档，进度条本来就有高光带，描边再重就糊成一条白边 */
      rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, Math.min(2.5, h / 2));
      x.strokeStyle = C.barLine;
      x.lineWidth = 0.8;
      x.stroke();
    });
  }

  var UI = {
    C: C, F: F, rr: rr, clearCache: clearCache,

    /* 云海作用域（v0.13.0）：`G.UI.mist(fn)` 内所有语义色自动切到云海版本。
       用法见 panels.js / overlays.js 的渲染入口 —— **必须在真正开始画之前进入**，
       且用 try/finally 保证异常路径也能还原（否则一次异常会把全局色表永久改掉，
       后面所有界面都变青紫 —— 这种"脏状态"在截图里才看得出来）。 */
    mist: function (fn) {
      applyMist(true);
      try { return fn(); } finally { applyMist(false); }
    },
    isMist: isMist,

    text: function (x, s, str, size, color, align, pixel) {
      x.font = F(size, pixel);
      x.fillStyle = color || C.text;
      x.textAlign = align || 'left';
      x.textBaseline = 'top';
      x.fillText(str, s.x, s.y);
    },

    /* 带描边文字（标题/数字用，暗底上也清晰） */
    textOut: function (x, s, str, size, color, align, outCol, outW) {
      x.font = F(size);
      x.textAlign = align || 'left';
      x.textBaseline = 'top';
      x.lineJoin = 'round';
      x.lineWidth = outW || 2.6;
      x.strokeStyle = outCol || 'rgba(6,8,14,0.85)';
      x.strokeText(str, s.x, s.y);
      x.fillStyle = color || C.text;
      x.fillText(str, s.x, s.y);
    },

    /* 中文折行：① 不能把标点丢到行首（「险恶。」的句号单独占一行）；
       ② 不能把开引号/开括号留在行末。
       做法是先把"基字 + 紧随其后的禁则字符"打包成不可拆的簇，再按簇折行 ——
       否则「。」被强行留在上一行后，紧跟的「”」会孤零零掉到下一行。 */
    wrap: function (x, str, size, maxW) {
      x.font = F(size);
      var noHead = '，。、；：？！）】」》”’…·';
      var noTail = '“（【「《‘';
      var cl = [];
      for (var i = 0; i < str.length; i++) {
        var ch = str[i];
        if (cl.length && noHead.indexOf(ch) >= 0) cl[cl.length - 1] += ch;
        else cl.push(ch);
      }
      var lines = [], cur = '', w = 0;
      for (var j = 0; j < cl.length; j++) {
        var c = cl[j], cw = x.measureText(c).width;
        if (w + cw > maxW && cur) {
          var tail = cur[cur.length - 1];
          if (noTail.indexOf(tail) >= 0) {
            cur = cur.slice(0, -1);
            if (cur) lines.push(cur);
            cur = tail; w = x.measureText(tail).width;
          } else { lines.push(cur); cur = ''; w = 0; }
        }
        cur += c; w += cw;
      }
      if (cur) lines.push(cur);
      return lines;
    },

    panel: function (x, s, fill, border, r, opt) {
      opt = opt || {};
      if (opt.tex === undefined) opt.tex = true;
      var c = panelCanvas(s.w, s.h, fill || C.panel, border, r == null ? 4 : r, opt);
      var pad = (opt && opt.shadow === false) ? 0 : 4;
      x.drawImage(c, Math.round(s.x) - pad, Math.round(s.y) - pad, s.w + pad * 2, s.h + pad * 2);
    },

    /* 主面板（云海玉牌：流云底 + 冷光边 + 云纹角 + 发丝内圈）—— 覆盖层通用。
       所有 `UI.frame` 一律走云海材质，这是"仙气"的主入口；
       嵌套安全（applyMist 只在最外层改写色表），所以外层已进作用域时调用它也不会串色。
       标题两侧只留一条退让的细线（v0.8.0 删掉了云纹短线与菱形端点：一页出现四五次太吵）。 */
    frame: function (x, s, title, opt) {
      opt = opt || {};
      return UI.mist(function () {
        UI.panel(x, s, opt.fill || C.frameFill, opt.border || C.frameBorder, 5,
          { corners: true, tex: opt.tex !== false, gold: true });
        if (title) {
          UI.textOut(x, { x: s.x + s.w / 2, y: s.y + 11 }, title, 16, C.goldHi, 'center');
          x.font = F(16);
          var tw = x.measureText(title).width;
          var cx = s.x + s.w / 2;
          x.strokeStyle = C.ruleHi;
          x.lineWidth = 0.8;
          x.beginPath();
          x.moveTo(s.x + 14, s.y + 21);
          x.lineTo(cx - tw / 2 - 12, s.y + 21);
          x.moveTo(cx + tw / 2 + 12, s.y + 21);
          x.lineTo(s.x + s.w - 14, s.y + 21);
          x.stroke();
        }
        return s;
      });
    },

    bar: function (x, s, ratio, color, bg) {
      x.drawImage(barFrame(s.w, s.h), Math.round(s.x), Math.round(s.y), s.w, s.h);
      var w = Math.max(0, Math.min(1, ratio)) * (s.w - 4);
      if (w > 0.6) {
        x.save();
        rr(x, { x: s.x + 2, y: s.y + 2, w: s.w - 4, h: s.h - 4 }, Math.min(2, s.h / 2));
        x.clip();
        var g = x.createLinearGradient(0, s.y + 2, 0, s.y + s.h - 2);
        g.addColorStop(0, A.shade(color, 0.30));
        g.addColorStop(0.45, color);
        g.addColorStop(1, A.shade(color, -0.28));
        x.fillStyle = g;
        x.fillRect(s.x + 2, s.y + 2, w, s.h - 4);
        /* 高光 */
        x.fillStyle = 'rgba(255,255,255,0.26)';
        x.fillRect(s.x + 2, s.y + 2.4, w, Math.max(1, (s.h - 4) * 0.34));
        x.restore();
      }
    },

    /* 印章徽记 */
    seal: function (x, cx, cy, r, ch, col) {
      var key = 'seal|' + Math.round(r) + '|' + ch + '|' + (col || C.seal);
      var c = cachedCanvas(key, r * 2, r * 2, function (xx) {
        var g = xx.createRadialGradient(r * 0.7, r * 0.7, r * 0.2, r, r, r);
        g.addColorStop(0, A.shade(col || C.seal, 0.22));
        g.addColorStop(1, col || C.seal);
        xx.fillStyle = g;
        xx.beginPath(); xx.arc(r, r, r - 0.6, 0, 6.2832); xx.fill();
        xx.strokeStyle = 'rgba(255,240,210,0.55)';
        xx.lineWidth = 1.1;
        xx.beginPath(); xx.arc(r, r, r - 2.2, 0, 6.2832); xx.stroke();
      });
      x.drawImage(c, Math.round(cx - r), Math.round(cy - r), r * 2, r * 2);
      x.font = F(r * 1.15);
      x.fillStyle = '#f6ecd8';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(ch, cx, cy + r * 0.06);
    },

    /* 圆形头像（HUD 左上角）：把立绘按「头部优先」裁进圆里，外套金环。
       两个坑：
       ① 立绘缓存画布是 K 倍超采样，源矩形必须乘 K —— 直接拿逻辑坐标当源，
          取到的是放大 K 倍后画布左上角那一小块，等于随机截一块出来；
       ② 缓存键必须带 K：窗口缩放会改倍率，不带 K 的旧圆会残留错误倍率。
       头的位置不写死 —— 立绘既有全身站姿（头只占顶端一小块）又有半身像，
       写死头心必然有一边裁到腰带。走 A.headBox 按 alpha 轮廓现量（见 art.js）。 */
    avatar: function (x, cx, cy, r, key, opt) {
      opt = opt || {};
      var K = A.K, pad = 3;
      var c = cachedCanvas('av|' + (key || 'villager') + '|' + r + '|' + K,
        r * 2 + pad * 2, r * 2 + pad * 2, function (xx) {
          var cc = r + pad;
          /* 外圈墨晕 */
          var og = xx.createRadialGradient(cc, cc, r * 0.86, cc, cc, r + pad);
          og.addColorStop(0, 'rgba(0,0,0,0.42)');
          og.addColorStop(1, 'rgba(0,0,0,0)');
          xx.fillStyle = og;
          xx.beginPath(); xx.arc(cc, cc, r + pad, 0, 6.2832); xx.fill();

          xx.save();
          xx.beginPath(); xx.arc(cc, cc, r, 0, 6.2832); xx.clip();
          xx.fillStyle = '#0d1018';
          xx.fillRect(cc - r, cc - r, r * 2, r * 2);
          var art = A.avatar(key);
          if (art) {
            var hb = A.headBox(key);
            var sw = hb[2];
            xx.drawImage(art.c, (hb[0] - sw / 2) * K, (hb[1] - sw / 2) * K, sw * K, sw * K,
              cc - r, cc - r, r * 2, r * 2);
          }
          /* 内暗角：贴边压暗，头像不会「顶」到金环上 */
          var vg = xx.createRadialGradient(cc, cc, r * 0.52, cc, cc, r);
          vg.addColorStop(0, 'rgba(6,8,14,0)');
          vg.addColorStop(1, 'rgba(6,8,14,0.58)');
          xx.fillStyle = vg;
          xx.fillRect(cc - r, cc - r, r * 2, r * 2);
          xx.restore();

          /* 金环 + 内细环 + 左上高光弧 */
          xx.strokeStyle = 'rgba(216,183,104,0.95)';
          xx.lineWidth = 1.5;
          xx.beginPath(); xx.arc(cc, cc, r - 0.8, 0, 6.2832); xx.stroke();
          xx.strokeStyle = 'rgba(216,183,104,0.32)';
          xx.lineWidth = 0.8;
          xx.beginPath(); xx.arc(cc, cc, r + 1.6, 0, 6.2832); xx.stroke();
          xx.strokeStyle = 'rgba(255,248,225,0.50)';
          xx.lineWidth = 1.2;
          xx.beginPath(); xx.arc(cc, cc, r - 2.8, Math.PI * 1.12, Math.PI * 1.62); xx.stroke();
        });
      x.drawImage(c, Math.round(cx - r - pad), Math.round(cy - r - pad),
        r * 2 + pad * 2, r * 2 + pad * 2);
    },

    /* 五行/资源图标
       预烘成小画布再 blit：图标是**每帧都画**的（HUD 三格资源 + 角色面板属性行），
       而 stone 每次都要现建线性渐变、qi/po 要现描路径。HUD 是常驻层，
       这些"每帧重建的渐变"直接吃掉整帧的 1/3。颜色全是写死的，缓存安全。 */
    icon: function (x, kind, cx, cy, s) {
      s = s || 8;
      var box = s * 2.4;
      var c = cachedCanvas('ic|' + kind + '|' + s, box, box, function (xx) {
        xx.translate(box / 2, box / 2);
        drawIcon(xx, kind, s);
      });
      x.drawImage(c, Math.round(cx - box / 2), Math.round(cy - box / 2), box, box);
    },


    /* 回纹分隔线：v0.8.0 减负 —— 线细一档、中间菱形缩到 2.4 且压暗，
       面板里一页常有四五条分隔线，原来每条都挂一个亮菱形，很吵。 */
    divider: function (x, cx, y, w, col) {
      col = col || 'rgba(216,183,104,0.32)';
      x.strokeStyle = col;
      x.lineWidth = 0.7;
      x.beginPath();
      x.moveTo(cx - w / 2, y);
      x.lineTo(cx - 5, y);
      x.moveTo(cx + 5, y);
      x.lineTo(cx + w / 2, y);
      x.stroke();
      x.fillStyle = col;
      x.save();
      x.translate(cx, y);
      x.beginPath();
      x.moveTo(0, -2.4); x.lineTo(2.4, 0); x.lineTo(0, 2.4); x.lineTo(-2.4, 0);
      x.closePath(); x.fill();
      x.restore();
    },

    /* 圆形摇杆（虚拟方向键） */
    joystick: function (x, cx, cy, r, dir, t) {
      var bg = cachedCanvas('joy|' + r, r * 2 + 8, r * 2 + 8, function (xx) {
        var c = r + 4;
        var g = xx.createRadialGradient(c, c - r * 0.3, r * 0.15, c, c, r);
        g.addColorStop(0, 'rgba(28,34,52,0.60)');
        g.addColorStop(0.72, 'rgba(14,18,30,0.58)');
        g.addColorStop(1, 'rgba(8,10,18,0.30)');
        xx.fillStyle = g;
        xx.beginPath(); xx.arc(c, c, r, 0, 6.2832); xx.fill();
        xx.strokeStyle = 'rgba(216,183,104,0.50)';
        xx.lineWidth = 1.2;
        xx.beginPath(); xx.arc(c, c, r - 0.8, 0, 6.2832); xx.stroke();
        xx.strokeStyle = 'rgba(216,183,104,0.20)';
        xx.lineWidth = 0.8;
        xx.beginPath(); xx.arc(c, c, r - 4.2, 0, 6.2832); xx.stroke();
        /* 四向刻度 */
        xx.strokeStyle = 'rgba(200,210,235,0.18)';
        xx.lineWidth = 0.7;
        for (var i = 0; i < 4; i++) {
          var a = i * Math.PI / 2 + Math.PI / 4;
          xx.beginPath();
          xx.moveTo(c + Math.cos(a) * (r - 8), c + Math.sin(a) * (r - 8));
          xx.lineTo(c + Math.cos(a) * (r - 4), c + Math.sin(a) * (r - 4));
          xx.stroke();
        }
      });
      x.drawImage(bg, Math.round(cx - r - 4), Math.round(cy - r - 4), r * 2 + 8, r * 2 + 8);

      /* 方向箭头（激活高亮） */
      var arrows = [
        ['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]
      ];
      arrows.forEach(function (a) {
        var act = dir === a[0];
        var ax = cx + a[1] * r * 0.58;
        var ay = cy + a[2] * r * 0.58;
        x.save();
        x.translate(ax, ay);
        var ang = a[0] === 'up' ? -Math.PI / 2 : a[0] === 'down' ? Math.PI / 2
          : a[0] === 'left' ? Math.PI : 0;
        x.rotate(ang);
        var sz = act ? 5.6 : 4.4;
        var grad = x.createLinearGradient(-sz, 0, sz, 0);
        if (act) { grad.addColorStop(0, '#f5e3a8'); grad.addColorStop(1, '#d8b768'); }
        else { grad.addColorStop(0, 'rgba(215,222,240,0.62)'); grad.addColorStop(1, 'rgba(160,170,196,0.5)'); }
        x.fillStyle = grad;
        x.beginPath();
        x.moveTo(sz, 0);
        x.lineTo(-sz * 0.7, -sz * 0.82);
        x.lineTo(-sz * 0.36, 0);
        x.lineTo(-sz * 0.7, sz * 0.82);
        x.closePath(); x.fill();
        x.restore();
      });

      /* 中心轴 */
      var knobR = r * 0.30;
      var kx = cx + (dir === 'left' ? -r * 0.22 : dir === 'right' ? r * 0.22 : 0);
      var ky = cy + (dir === 'up' ? -r * 0.22 : dir === 'down' ? r * 0.22 : 0);
      var kg = x.createRadialGradient(kx - knobR * 0.4, ky - knobR * 0.5, knobR * 0.1, kx, ky, knobR);
      kg.addColorStop(0, 'rgba(216,190,120,0.85)');
      kg.addColorStop(0.6, 'rgba(140,116,70,0.62)');
      kg.addColorStop(1, 'rgba(60,52,36,0.45)');
      x.fillStyle = kg;
      x.beginPath(); x.arc(kx, ky, knobR, 0, 6.2832); x.fill();
      x.strokeStyle = 'rgba(240,220,160,0.55)';
      x.lineWidth = 0.9;
      x.beginPath(); x.arc(kx, ky, knobR, 0, 6.2832); x.stroke();
    },

    /* 圆形动作键 */
    actionBtn: function (x, cx, cy, r, label, pressed) {
      var key = 'ab|' + r + '|' + (pressed ? 1 : 0);
      var c = cachedCanvas(key, r * 2 + 6, r * 2 + 6, function (xx) {
        var cc = r + 3;
        /* 外圈墨晕 */
        var og = xx.createRadialGradient(cc, cc, r * 0.8, cc, cc, r + 2.4);
        og.addColorStop(0, 'rgba(0,0,0,0.32)');
        og.addColorStop(1, 'rgba(0,0,0,0)');
        xx.fillStyle = og;
        xx.beginPath(); xx.arc(cc, cc, r + 2.4, 0, 6.2832); xx.fill();
        /* 金面 */
        var g = xx.createLinearGradient(cc, cc - r, cc, cc + r);
        if (pressed) {
          g.addColorStop(0, '#a8843f'); g.addColorStop(0.5, '#8f6f34'); g.addColorStop(1, '#6d5326');
        } else {
          g.addColorStop(0, '#f7e6b0'); g.addColorStop(0.42, '#d8b768'); g.addColorStop(1, '#a8843f');
        }
        xx.fillStyle = g;
        xx.beginPath(); xx.arc(cc, cc, r, 0, 6.2832); xx.fill();
        /* 内环 */
        xx.strokeStyle = pressed ? 'rgba(255,240,190,0.45)' : 'rgba(90,66,26,0.45)';
        xx.lineWidth = 1;
        xx.beginPath(); xx.arc(cc, cc, r - 2.6, 0, 6.2832); xx.stroke();
        /* 外描边 */
        xx.strokeStyle = pressed ? '#e0c070' : '#f4e2a8';
        xx.lineWidth = 1.2;
        xx.beginPath(); xx.arc(cc, cc, r, 0, 6.2832); xx.stroke();
        /* 顶部高光 */
        if (!pressed) {
          xx.strokeStyle = 'rgba(255,255,255,0.5)';
          xx.lineWidth = 1.4;
          xx.beginPath(); xx.arc(cc, cc, r - 1.6, Math.PI * 1.15, Math.PI * 1.85); xx.stroke();
        }
      });
      x.drawImage(c, Math.round(cx - r - 3), Math.round(cy - r - 3), r * 2 + 6, r * 2 + 6);
      x.font = F(r * 1.05);
      x.fillStyle = pressed ? '#f6ecd8' : '#241a06';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(label, cx, cy + r * 0.04);
    },

    Typewriter: null   /* 下方赋值 */
  };

  /* ---------- 按钮 ----------
     v0.8.0 减负：**所有变体都不再画回纹角**，双层描边收成一层。
     一屏可能有三十几个按钮，每个四角描线 + 内外两圈框，整幅画面就只剩线条了。 */
  function btnCanvas(w, h, variant, pressed, r) {
    var key = 'b|' + w + 'x' + h + '|' + variant + '|' + (pressed ? 1 : 0);
    var pad = 3;
    return cachedCanvas(key, w + pad * 2, h + pad * 2, function (x) {
      x.translate(pad, pad);
      var s = { x: 0, y: 0, w: w, h: h };

      /* plain：**只提供命中区、不画任何像素**。
         用途是"外观我自己画、点击我要接"的控件（目前只有任务追踪栏的左缘竖标）——
         竖标是竖向文字，而 Btn 只会横排一行字，塞进 20px 宽的竖条必然溢出。
         ⚠️ 必须在**落影之前**返回：落影是画给 default 的，plain 连它都不能有。 */
      if (variant === 'plain') return;

      /* 落影（default 变体保留；battle/ghost/tab/subtab/frost/frostGold 不想要投影，画面会变铁丝网） */
      if (variant !== 'battle' && variant !== 'ghost' && variant !== 'tab'
        && variant !== 'subtab' && variant !== 'frost' && variant !== 'frostGold') {
        x.save();
        x.shadowColor = 'rgba(0,0,0,0.45)';
        x.shadowBlur = 3;
        x.shadowOffsetY = 1.6;
        rr(x, s, r);
        x.fillStyle = 'rgba(8,10,16,0.9)';
        x.fill();
        x.restore();
      }

      if (variant === 'gold') {
        var g = x.createLinearGradient(0, 0, 0, h);
        if (pressed) {
          g.addColorStop(0, '#8f6f34'); g.addColorStop(0.5, '#7a5c28'); g.addColorStop(1, '#5f4620');
        } else {
          g.addColorStop(0, '#f7e6b0'); g.addColorStop(0.42, '#dcbb6d');
          g.addColorStop(0.72, '#c8a355'); g.addColorStop(1, '#a8843f');
        }
        rr(x, s, r); x.fillStyle = g; x.fill();
        /* 单层描边（原先是"内亮线 + 外描边"两层） */
        rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, r);
        x.strokeStyle = pressed ? '#6d5326' : '#8a6a2c'; x.lineWidth = 1; x.stroke();
        /* 顶部高光带 */
        if (!pressed) {
          x.fillStyle = 'rgba(255,255,255,0.34)';
          x.fillRect(3, 1.6, w - 6, 1.1);
        }

      } else if (variant === 'ghost') {
        rr(x, s, r);
        var gg = x.createLinearGradient(0, 0, 0, h);
        gg.addColorStop(0, pressed ? 'rgba(30,36,54,0.9)' : 'rgba(16,20,32,0.62)');
        gg.addColorStop(1, pressed ? 'rgba(20,24,38,0.9)' : 'rgba(10,13,22,0.62)');
        x.fillStyle = gg; x.fill();
        rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, r);
        x.strokeStyle = pressed ? 'rgba(245,227,168,0.85)' : 'rgba(216,183,104,0.34)';
        x.lineWidth = 0.9; x.stroke();

      } else if (variant === 'tab') {
        /* 底栏页签：无描边、无角饰 —— 常驻六个，再描边就把底栏压成一条黑框。
           选中态由 Btn.render 在底部画一条亮线表达（见下）。 */
        rr(x, s, r);
        var tg = x.createLinearGradient(0, 0, 0, h);
        tg.addColorStop(0, pressed ? 'rgba(40,48,72,0.95)' : 'rgba(22,27,41,0.95)');
        tg.addColorStop(1, pressed ? 'rgba(28,34,52,0.95)' : 'rgba(14,18,28,0.95)');
        x.fillStyle = tg; x.fill();

      } else if (variant === 'subtab') {
        /* 面板**内部**的子页签（角色面板的 总览/灵根/属性/境界）。
           与底栏 tab 分开一个变体，两个理由：
             ① 视觉层级不同 —— 它在面板里，要有细描边才看得出是"页签"而不是底栏；
             ② panels.contract 用 `variant === 'tab'` 认底栏页签，
                子页签若也叫 tab，会把"再点当前页签应收起"那条断言带歪。 */
        rr(x, s, r);
        x.fillStyle = pressed ? 'rgba(34,41,60,0.95)' : 'rgba(18,22,34,0.88)';
        x.fill();
        rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, r);
        x.strokeStyle = 'rgba(216,183,104,0.26)';
        x.lineWidth = 0.9; x.stroke();

      } else if (variant === 'danger') {
        var dg = x.createLinearGradient(0, 0, 0, h);
        dg.addColorStop(0, pressed ? '#8f2f2c' : '#b8443f');
        dg.addColorStop(1, pressed ? '#631e1c' : '#8a2c28');
        rr(x, s, r); x.fillStyle = dg; x.fill();
        rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, r);
        x.strokeStyle = '#e0a89a'; x.lineWidth = 1; x.stroke();
        if (!pressed) {
          x.fillStyle = 'rgba(255,255,255,0.22)';
          x.fillRect(3, 1.6, w - 6, 1.1);
        }

      } else if (variant === 'battle') {
        /* 战斗指令按钮（v0.11.2）：墨玉底 + **无投影** + 0.9px 细描边 + 顶部细高光。
           default 变体的阴影 blur=3 + 1px 描边 + 顶部 1.1px 高光叠在一起 → 整屏按钮看着像一张铁丝网，
           砍掉投影、收细描边，整体"线框感"立刻降一半。颜色由调用方用 `color` 字段注入（默认中性）。 */
        rr(x, s, r);
        var bg = x.createLinearGradient(0, 0, 0, h);
        if (pressed) {
          bg.addColorStop(0, 'rgba(20,26,42,0.96)');
          bg.addColorStop(1, 'rgba(14,18,30,0.96)');
        } else {
          bg.addColorStop(0, 'rgba(28,36,56,0.82)');
          bg.addColorStop(1, 'rgba(18,24,38,0.82)');
        }
        x.fillStyle = bg; x.fill();
        rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, r);
        x.strokeStyle = pressed ? 'rgba(168,180,210,0.55)' : 'rgba(168,180,210,0.32)';
        x.lineWidth = 0.9; x.stroke();
        if (!pressed) {
          x.fillStyle = 'rgba(255,255,255,0.08)';
          x.fillRect(3, 1.4, w - 6, 0.9);
        }
      } else if (variant === 'frost' || variant === 'frostGold') {
        /* 云雾玉牌（v0.13.0）：给**深色云海底图**上的菜单用 —— 半透明青玉玻璃 + 冷光细边。
           v0.12.0 曾做过浅色「宣纸牌匾」，与修仙世界观不符（凡俗纸墨），已废弃。
           `frostGold` = 同一块牌换金边金字，做云海上的**主操作**（次要动作用 `frost`）。
           内圈发丝线是"玉牌"质感的关键 —— 只有一圈外框会读成"贴上去的方块"。 */
        var gold = variant === 'frostGold';
        rr(x, s, r);
        var ig = x.createLinearGradient(0, 0, 0, h);
        if (pressed) {
          ig.addColorStop(0, gold ? 'rgba(78,63,32,0.94)' : 'rgba(30,42,68,0.94)');
          ig.addColorStop(1, gold ? 'rgba(56,45,22,0.94)' : 'rgba(20,28,48,0.94)');
        } else {
          ig.addColorStop(0, gold ? 'rgba(68,55,28,0.90)' : 'rgba(42,58,92,0.86)');
          ig.addColorStop(1, gold ? 'rgba(46,37,18,0.90)' : 'rgba(24,34,58,0.86)');
        }
        x.fillStyle = ig; x.fill();
        /* 顶部一层冷光：玉牌"透光"的观感（压在底渐变之上、描边之下） */
        if (!pressed) {
          var hg = x.createLinearGradient(0, 0, 0, h * 0.58);
          hg.addColorStop(0, gold ? 'rgba(255,236,186,0.15)' : 'rgba(196,226,255,0.13)');
          hg.addColorStop(1, 'rgba(196,226,255,0)');
          rr(x, s, r); x.fillStyle = hg; x.fill();
        }
        /* 外框：冷青（主操作换金），主操作线更粗一档让它"亮"出来 */
        rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, r);
        x.strokeStyle = gold
          ? (pressed ? 'rgba(214,178,96,0.88)' : 'rgba(232,198,120,0.74)')
          : (pressed ? 'rgba(178,212,246,0.68)' : 'rgba(158,200,240,0.50)');
        x.lineWidth = gold ? 1.3 : 1; x.stroke();
        /* 内圈发丝线 */
        rr(x, { x: 2.5, y: 2.5, w: w - 5, h: h - 5 }, Math.max(1, r - 1));
        x.strokeStyle = gold ? 'rgba(226,196,124,0.30)' : 'rgba(158,200,240,0.20)';
        x.lineWidth = 0.7; x.stroke();
        /* 左缘一道竖线：次要牌用青玉线，主操作牌用金线 */
        x.fillStyle = gold
          ? (pressed ? 'rgba(206,168,88,0.92)' : 'rgba(226,190,108,0.86)')
          : (pressed ? 'rgba(110,196,176,0.72)' : 'rgba(126,214,192,0.62)');
        x.fillRect(gold ? 3 : 3.5, 5, gold ? 2.4 : 1.6, h - 10);
        if (!pressed) {
          x.fillStyle = gold ? 'rgba(255,240,200,0.30)' : 'rgba(210,234,255,0.24)';
          x.fillRect(4, 1.6, w - 8, 1);
        }

      } else {  /* default：墨玉 */
        var g2 = x.createLinearGradient(0, 0, 0, h);
        if (pressed) {
          g2.addColorStop(0, '#1a2030'); g2.addColorStop(1, '#141926');
        } else {
          g2.addColorStop(0, '#333c58'); g2.addColorStop(0.5, '#272e45'); g2.addColorStop(1, '#1c2233');
        }
        rr(x, s, r); x.fillStyle = g2; x.fill();
        rr(x, { x: 0.5, y: 0.5, w: w - 1, h: h - 1 }, r);
        x.strokeStyle = pressed ? '#4a5578' : '#46527a';
        x.lineWidth = 1; x.stroke();
        if (!pressed) {
          x.fillStyle = 'rgba(255,255,255,0.11)';
          x.fillRect(3, 1.6, w - 6, 1.1);
        }
      }
    });
  }

  function Btn(o) {
    this.x = o.x; this.y = o.y; this.w = o.w; this.h = o.h;
    this.label = o.label; this.onClick = o.onClick;
    this.disabled = !!o.disabled; this.small = o.small;
    this.variant = o.variant || 'default';
    this.tier = o.tier;
    this.active = !!o.active;      /* 底栏页签的选中态 */
    /* glyph：用**矢量**画的图标钮（目前只有 'close'）。
       ⚠️ 不要改成画 '×' / '✕' 字符：工程没有 @font-face，字体是系统回退，
       缺字会渲染成空心方框（豆腐块）且换机器表现不一致 —— 同 panels.js 的 mark()。 */
    this.glyph = o.glyph || null;
    /* passive：**不可点但外观正常**（储物格子）。直接 disabled 会把整页格子压成灰块、
       看起来像坏了 —— 所以单开一个开关：只吞点击，不改外观。 */
    this.passive = !!o.passive;
    /* fs / sub / subFs / subColor：格子类按钮要在一格里放"名称 + 数量"两行。
       ⚠️ 这四个字段必须在这里**显式拷贝** —— render 里读的是 this.xxx，
       漏拷不报错，只会静默不画副行（首版就踩过：格子全是空的）。 */
    this.fs = o.fs;
    this.sub = o.sub;
    this.subFs = o.subFs;
    this.subColor = o.subColor;
    this._p = 0;
  }
  Btn.prototype.hit = function (p) {
    return p.x >= this.x && p.x <= this.x + this.w && p.y >= this.y && p.y <= this.y + this.h;
  };
  Btn.prototype.tick = function (dt) { if (this._p > 0) this._p -= dt; };
  Btn.prototype.render = function (x) {
    var down = this._p > 0;
    var dy = down ? 1 : 0;
    var w = this.w, h = this.h;

    /* plain：**只登记命中、不画任何像素**（v0.11.6）。
       用途是"外观由场景自绘、但需要接点击"的控件 —— 目前只有探索场景左缘的
       任务追踪竖标：它是一根 20×76 的竖条，字是**竖排**的，而 Btn 只会横排一行
       label 并居中。若只让 btnCanvas 早退、不在这里也早退，label 仍会横着画出来，
       直接把竖条撑破。 */
    if (this.variant === 'plain') return;

    /* passive：**不可点但正常外观**。用于"储物格子"这类——
       格子要能承接悬浮说明、也要看起来是正常内容，但点下去没有动作。
       直接 disabled 会把整页格子压成灰块（像坏了），所以单独一个开关。 */
    if (this.disabled && !this.passive) {
      x.save();
      x.globalAlpha = 0.45;
      rr(x, { x: this.x, y: this.y, w: w, h: h }, 3);
      x.fillStyle = '#1a1e2c'; x.fill();
      x.strokeStyle = C.lineSoft; x.lineWidth = 1; x.stroke();
      x.restore();
    } else {
      var c = btnCanvas(w, h, this.variant, down, 3);
      x.drawImage(c, Math.round(this.x) - 3, Math.round(this.y + dy) - 3, w + 6, h + 6);
      /* 页签选中：底部一条亮线（不用描边框，省得底栏变重）；子页签同款 */
      if ((this.variant === 'tab' || this.variant === 'subtab') && this.active) {
        x.fillStyle = C.goldHi;
        x.fillRect(this.x + 6, this.y + h - 2, w - 12, 1.5);
      }
    }

    var col;
    if (this.disabled && !this.passive) col = '#5c6072';
    else if (this.variant === 'gold') col = down ? '#f6ecd8' : '#241a06';
    else if (this.variant === 'ghost') col = C.goldHi;
    else if (this.variant === 'tab') col = this.active ? C.goldHi : 'rgba(206,196,172,0.82)';
    else if (this.variant === 'subtab') col = this.active ? C.goldHi : 'rgba(206,196,172,0.78)';
    /* 云雾玉牌：**浅字**（深色青玉玻璃底必须配浅字，否则整块牌读不出字） */
    else if (this.variant === 'frost') col = down ? '#cfe0f5' : '#e4eefb';
    else if (this.variant === 'frostGold') col = down ? '#f0dca6' : '#fdf2d2';
    else if (this.variant === 'danger') col = '#ffe4dc';
    else { col = C.text; if (this.tier === '仙') col = C.goldHi; }

    if (this.glyph === 'close') {
      var gcx = this.x + w / 2, gcy = this.y + h / 2 + dy;
      var gs = Math.min(w, h) * 0.24;
      x.save();
      x.strokeStyle = col; x.lineWidth = 1.7; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(gcx - gs, gcy - gs); x.lineTo(gcx + gs, gcy + gs);
      x.moveTo(gcx + gs, gcy - gs); x.lineTo(gcx - gs, gcy + gs);
      x.stroke();
      x.restore();
      return;
    }

    x.font = F(this.fs || (this.small ? 12 : 14));
    x.fillStyle = col;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    /* 副行（sub）：格子类按钮要在一格里同时放"名称 + 数量/等级"。
       为什么不让面板体自己画这两行：`panels.bounds.contract` 会判"文字压在按钮上"，
       而格子**必须**是可点的按钮（点格子即用）—— 面板体再往上画字就必然报。
       让按钮自己画（按钮的 label 不经过 textSpy，见 renderPanel 不渲染 buttons）即可。 */
    var cy = this.y + h / 2 + 1 + dy;
    if (this.sub) cy -= 5.5;
    /* 只有"格子类按钮"（带 sub）才自动缩放 / 截断名称；普通按钮的 label 宽度是设计好的 */
    x.fillText(this.sub ? fitCell(x, this.label, this.fs || (this.small ? 12 : 14), w - 7)
      : this.label, this.x + w / 2, cy);
    if (this.sub) {
      x.font = F(this.subFs || 9.5);
      x.fillStyle = (this.disabled && !this.passive) ? '#5c6072' : (this.subColor || C.textDim);
      x.fillText(this.sub, this.x + w / 2, cy + 12.5);
    }
  };

  /* 格子里的文字必须**装得进格子**：储物格只有 46px 宽，「淬体突破丹」五个字
     按 10.5px 排出来 52px，会直接顶到邻格的边框上（截图反馈实测）。
     先自动缩字号（下限 8.5），仍放不下才截断加省略号。
     ⚠️ 只给带 sub 的"格子类按钮"用 —— 普通按钮的 label 宽度是设计好的，
     全局自动缩放会让既有一批截图无故变样。 */
  function fitCell(x, str, size, maxW) {
    var fs = size;
    while (fs > 8.5 && x.measureText(str).width > maxW) {
      fs -= 0.5; x.font = F(fs);
    }
    if (x.measureText(str).width <= maxW) return str;
    var out = str;
    while (out.length > 1 && x.measureText(out + '…').width > maxW) out = out.slice(0, -1);
    return out + '…';
  }
  UI.Btn = Btn;

  /* ---------- 打字机 ---------- */
  function Typewriter(text, cps) {
    this.text = text; this.cps = cps || 30;
    this.n = 0; this.done = false;
  }
  Typewriter.prototype.update = function (dt) {
    if (this.done) return;
    this.n += this.cps * dt;
    if (this.n >= this.text.length) { this.n = this.text.length; this.done = true; }
  };
  Typewriter.prototype.show = function () { this.n = this.text.length; this.done = true; };
  Typewriter.prototype.part = function () { return this.text.slice(0, Math.floor(this.n)); };
  UI.Typewriter = Typewriter;

  /* ---------- 悬浮说明（tooltip） ----------
     项目原先没有任何 hover 机制。做法是"每帧登记候选区、帧末统一画"：
     调用方画自己的时候顺带 `G.UI.hover(rect, {title, text})`，
     由 game.js 在**所有东西画完之后**调 `G.UI.drawHover(x)`。

     ─ 为什么要延后：提示条是"覆盖层之上的覆盖层"，随手画会被后画的面板/按钮盖住。
     ─ 为什么取**最后**一个而不是第一个：后画的在上层，命中判断必须与视觉层级一致
       （面板里的格子注册得比底下的 HUD 晚 → 面板优先）。
     ─ 触屏：`G.Input.mouse` 恒为 null → 整个机制自动静默，不会在手机上挂一块膏药。 */
  var hoverList = [];
  var HOVER_MAXW = 210;             /* 正文自动折行的最大宽度 */

  UI.hoverReset = function () { hoverList.length = 0; };

  UI.hover = function (rect, info) {
    var m = G.Input && G.Input.mouse;
    if (!m || !info) return false;
    if (m.x < rect.x || m.x > rect.x + rect.w) return false;
    if (m.y < rect.y || m.y > rect.y + rect.h) return false;
    hoverList.push({ rect: rect, info: info });
    return true;
  };

  /* 按最大宽度折行；显式 '\n' 强制断行 */
  function wrapLines(x, text, maxw) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      if (!para) { out.push(''); return; }
      var line = '';
      for (var i = 0; i < para.length; i++) {
        var t = line + para[i];
        if (x.measureText(t).width > maxw && line) { out.push(line); line = para[i]; }
        else line = t;
      }
      if (line) out.push(line);
    });
    return out;
  }

  UI.drawHover = function (x) {
    if (!hoverList.length) return;
    var m = G.Input && G.Input.mouse;
    if (!m) return;
    var info = hoverList[hoverList.length - 1].info;
    if (typeof info === 'string') info = { text: info };

    var pad = 6, lh = 14;
    x.font = F(11.5);
    var titleLines = info.title ? wrapLines(x, info.title, HOVER_MAXW) : [];
    x.font = F(10.5);
    var bodyLines = info.text ? wrapLines(x, info.text, HOVER_MAXW) : [];
    var lines = titleLines.length + bodyLines.length;
    if (!lines) return;

    var w = 0;
    x.font = F(11.5);
    titleLines.forEach(function (l) { w = Math.max(w, x.measureText(l).width); });
    x.font = F(10.5);
    bodyLines.forEach(function (l) { w = Math.max(w, x.measureText(l).width); });
    w = Math.min(HOVER_MAXW, w) + pad * 2;
    var h = pad * 2 + lh * lines + (titleLines.length && bodyLines.length ? 2 : 0);

    /* 默认贴在被指物件的**下方**；越出下沿就翻到上方；左右再夹进画布 */
    var r = hoverList[hoverList.length - 1].rect;
    var bx = Math.max(4, Math.min(480 - w - 4, r.x));
    var by = r.y + r.h + 4;
    if (by + h > 272 - 4) by = Math.max(4, r.y - h - 4);

    x.save();
    x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 6; x.shadowOffsetY = 2;
    rr(x, { x: bx, y: by, w: w, h: h }, 4);
    x.fillStyle = 'rgba(10,13,22,0.96)'; x.fill();
    x.restore();
    rr(x, { x: bx + 0.5, y: by + 0.5, w: w - 1, h: h - 1 }, 4);
    x.strokeStyle = 'rgba(216,183,104,0.5)'; x.lineWidth = 1; x.stroke();

    var ty = by + pad;
    x.textAlign = 'left'; x.textBaseline = 'top';
    x.font = F(11.5); x.fillStyle = C.goldHi;
    titleLines.forEach(function (l) { x.fillText(l, bx + pad, ty); ty += lh; });
    if (titleLines.length && bodyLines.length) ty += 2;
    x.font = F(10.5); x.fillStyle = C.text;
    bodyLines.forEach(function (l) { x.fillText(l, bx + pad, ty); ty += lh; });
  };

  G.UI = UI;
})();
