/* 角色与妖兽精灵 v2 —— 统一走"轮廓线 + 分层明暗 + 体积光"管线
   地图角色 16×24 逻辑、战斗立绘 40×40 逻辑；超采样倍率跟随 Art.K（与画布倍率一致）。 */
(function () {
  var A = G.Art;

  /* ---------- 基础管线 ---------- */
  /* 部件列表 → 画布：先铺一圈描边，再上色，最后叠体积光 */
  function bake(P, w, h, outline, opt) {
    opt = opt || {};
    var sc = opt.scale || 1;
    var o = A.cv(w * sc, h * sc);
    var x = o.x;
    x.scale(sc, sc);
    var e = opt.outlineW == null ? 0.8 : opt.outlineW;

    if (!opt.noOutline) {
      x.fillStyle = outline || 'rgba(16,14,22,0.92)';
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        if (p.noOutline) continue;
        if (p.path) {
          /* 有机形状：直接沿路径描边当轮廓，比外扩矩形贴合得多 */
          x.strokeStyle = outline || 'rgba(16,14,22,0.92)';
          x.lineWidth = e * 2;
          x.lineJoin = 'round';
          x.lineCap = 'round';
          p.path(x); x.stroke();
          continue;
        }
        x.fillRect(p.x - e, p.y - e, p.w + e * 2, p.h + e * 2);
      }
    }
    for (var j = 0; j < P.length; j++) {
      var q = P[j];
      if (q.alpha != null) { x.globalAlpha = q.alpha; }
      /* clip：把后续绘制裁剪在该形状内（用来给衣袍内部铺渐变/褶皱） */
      if (q.clip) { x.save(); q.clip(x); x.clip(); }
      if (q.path) {
        x.fillStyle = q.c;
        q.path(x); x.fill();
      } else if (q.round) {
        x.fillStyle = q.c;
        A.blob(x, q.x + q.w / 2, q.y + q.h / 2, Math.max(q.w, q.h) / 2, q.h / q.w);
      } else if (!q.paint) {
        x.fillStyle = q.c;
        x.fillRect(q.x, q.y, q.w, q.h);
      }
      if (q.paint) q.paint(x);
      if (q.clip) x.restore();
      x.globalAlpha = 1;
    }
    if (!opt.noVolume) {
      x.globalCompositeOperation = 'source-atop';
      /* 纵向：下暗上亮 */
      var g = x.createLinearGradient(0, h * 0.40, 0, h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.28)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      var g2 = x.createLinearGradient(0, 0, 0, h * 0.34);
      g2.addColorStop(0, 'rgba(255,255,255,0.17)');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g2; x.fillRect(0, 0, w, h);
      /* 横向：左受光 / 右背光——只有纵向渐变时立绘会读成扁平色块 */
      var g3 = x.createLinearGradient(0, 0, w, 0);
      g3.addColorStop(0, 'rgba(255,246,224,0.15)');
      g3.addColorStop(0.40, 'rgba(255,255,255,0)');
      g3.addColorStop(1, 'rgba(0,0,0,0.22)');
      x.fillStyle = g3; x.fillRect(0, 0, w, h);
      /* 接地暗部 */
      var g4 = x.createLinearGradient(0, h * 0.86, 0, h);
      g4.addColorStop(0, 'rgba(0,0,0,0)');
      g4.addColorStop(1, 'rgba(0,0,0,0.20)');
      x.fillStyle = g4; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = 'source-over';
    }
    return o.c;
  }

  function mirror(src) {
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    var x = c.getContext('2d');
    x.translate(src.width, 0); x.scale(-1, 1);
    x.drawImage(src, 0, 0);
    return c;
  }

  /* ---------- 主角 ---------- */
  var HERO = {
    hair: '#2b2833', hairHi: '#4a4459',
    skin: '#e8b890', skinSh: '#c99870', skinHi: '#f6d4b0',
    robe: '#5d6f94', robeDark: '#3f4c6d', robeHi: '#7e91b8',
    collar: '#e6ddc2', belt: '#7a5438', beltHi: '#a87a4e',
    shoe: '#2c2a30', eye: '#201d28', sash: '#c2b48c'
  };

  function heroParts(dir, step, pal) {
    var P = [];
    function add(x, y, w, h, c, extra) {
      var o = { x: x, y: y, w: w, h: h, c: c };
      if (extra) for (var k in extra) o[k] = extra[k];
      P.push(o);
    }
    var bob = step === 0 ? 0 : -0.35;
    var armSwing = step === 1 ? -0.7 : step === 2 ? 0.7 : 0;
    var back = dir === 'up';

    /* ---- 头 ---- */
    if (back) {
      add(3.2, 1.2, 9.6, 7.6, pal.hair);
      add(3.8, 1.2, 8.4, 2.2, pal.hairHi);
      add(6.6, 7.2, 2.8, 2.4, pal.hair);
    } else {
      add(4.0, 2.6 + bob, 8.0, 6.4, pal.skin);
      add(4.0, 2.6 + bob, 8.0, 1.4, pal.skinHi);
      add(3.2, 1.0 + bob, 9.6, 3.4, pal.hair);
      add(4.0, 1.0 + bob, 8.0, 1.3, pal.hairHi);
      add(3.2, 3.4 + bob, 1.7, 3.6, pal.hair);
      add(11.1, 3.4 + bob, 1.7, 3.6, pal.hair);
      add(4.4, 3.6 + bob, 7.2, 1.2, pal.hair);      /* 刘海 */
      add(4.0, 7.4 + bob, 8.0, 1.6, pal.skinSh);    /* 下颌阴影 */
      if (dir === 'down') {
        add(5.9, 5.6 + bob, 1.2, 1.4, pal.eye);
        add(9.0, 5.6 + bob, 1.2, 1.4, pal.eye);
        add(5.9, 5.5 + bob, 1.2, 0.5, 'rgba(255,255,255,0.5)');
        add(9.0, 5.5 + bob, 1.2, 0.5, 'rgba(255,255,255,0.5)');
      } else {
        add(4.3, 5.5 + bob, 1.2, 1.4, pal.eye);
        add(6.2, 5.9 + bob, 1.0, 0.9, pal.skinSh);  /* 鼻影 */
      }
    }

    /* ---- 身 ---- */
    var y0 = 9.4 + bob;
    add(7.0, y0 - 0.8, 2.2, 1.4, pal.skinSh);                 /* 颈 */
    add(4.6, y0, 6.8, 1.9, pal.collar);                       /* 领 */
    add(3.1, y0 + 0.9, 9.8, 6.2, pal.robe);                   /* 袍身 */
    add(3.5, y0 + 0.9, 1.2, 6.0, pal.robeHi);                 /* 左高光 */
    add(11.3, y0 + 0.9, 1.5, 6.0, pal.robeDark);              /* 右暗面 */
    if (!back) {
      add(6.4, y0 + 0.4, 1.7, 2.6, pal.robeHi);               /* 交领右片 */
      add(8.3, y0 + 0.4, 1.7, 2.6, pal.robe);
      add(6.4, y0 + 2.6, 3.6, 0.5, 'rgba(0,0,0,0.20)');
    }
    /* 腰带 */
    add(3.1, y0 + 5.0, 9.8, 1.9, pal.belt);
    add(3.1, y0 + 5.0, 9.8, 0.6, pal.beltHi);
    add(7.2, y0 + 5.1, 1.5, 1.6, '#d8b768');
    /* 袍摆 */
    add(3.6, y0 + 6.9, 8.8, 3.4, pal.robeDark);
    add(3.6, y0 + 6.9, 8.8, 0.8, pal.robe);
    /* 飘带 */
    add(3.1, y0 + 7.4, 1.1, 3.4, pal.sash, { alpha: 0.9 });
    add(11.8, y0 + 7.4, 1.1, 3.4, pal.sash, { alpha: 0.9 });

    /* ---- 臂 ---- */
    var ax = 2.0, bx = 12.4;
    add(ax, y0 + 1.0 + armSwing, 1.9, 5.0, pal.robe);
    add(ax, y0 + 5.8 + armSwing, 1.6, 1.7, pal.skin);
    add(bx - 0.1, y0 + 1.0 - armSwing, 1.9, 5.0, pal.robeDark);
    add(bx, y0 + 5.8 - armSwing, 1.6, 1.7, pal.skin);

    /* ---- 足 ---- */
    var ly = 21.2 + bob, ry = 21.2 + bob;
    if (step === 1) { ly = 21.9 + bob; ry = 20.8 + bob; }
    else if (step === 2) { ly = 20.8 + bob; ry = 21.9 + bob; }
    add(4.4, ly, 3.1, 2.0, pal.shoe);
    add(8.6, ry, 3.1, 2.0, pal.shoe);
    add(4.4, ly, 3.1, 0.5, 'rgba(255,255,255,0.12)');
    add(8.6, ry, 3.1, 0.5, 'rgba(255,255,255,0.12)');

    return P;
  }

  /* 地图角色渲染倍率：16×24 逻辑稿 → 实际占位 28×42（约 1.75 格宽）。
     太小会"看不清人物形状"，太大又挡住格子；1.75 是能认清五官又不挤压走位的平衡点。 */
  var MAP_SCALE = 1.75;
  var HERO_LW = 16 * MAP_SCALE;      /* 28 */
  var HERO_LH = 24 * MAP_SCALE;      /* 42 */
  var HERO_SRC_H = 252;              /* 地图角色素材规格（tools/assets-build.py: SIZES 写死 168×252） */

  /* ====== 四向对齐（v0.11.2）======
     AI 出的左右侧身素材头顶起得更高（hair flying up），均匀缩到 28×42 后，
     侧身图角色比前后图角色高出 5 逻辑像素（实测 content_top：down/up=69、left/right=40；
     缩放后 head 落点 down 11.5 vs left 6.67，feet 都落 40.33）。
     把所有方向的素材**头部顶端**统一钉到 dest y=11.5（用 9-arg drawImage + crop + 非均匀缩放）：
     - head 对齐，前后左右看上去一样高
     - feet 同时落到画布底边（dest y=42）
     - 副作用：每个方向会被非均匀纵缩 5–10%，可接受（视觉高度一致优先于原始比例） */
  function _heroContentTop(im) {
    if (!im) return -1;
    try {
      if (typeof document === 'undefined') return -1;
      var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      var t = document.createElement('canvas');
      t.width = iw; t.height = ih;
      var tx = t.getContext('2d');
      tx.drawImage(im, 0, 0);
      var d = tx.getImageData(0, 0, iw, ih).data;
      for (var y = 0; y < ih; y++) {
        for (var x = 0; x < iw; x++) {
          if (d[(y * iw + x) * 4 + 3] > 8) return y;
        }
      }
    } catch (e) { return -1; }
    return -1;
  }
  /* 全局头线：取所有有素材的方向里 content_top 最大的那个作为基线（最稳的视觉锚）。 */
  var _heroHeadTop = -1;
  function _ensureHeroHeadTop() {
    if (_heroHeadTop >= 0) return;
    var max = -1;
    ['down', 'up', 'left', 'right'].forEach(function (d) {
      var im = G.Assets && G.Assets.img ? G.Assets.img('char.hero.' + d + '.0') : null;
      var t = _heroContentTop(im);
      if (t > max) max = t;
    });
    /* 至少有一个方向的素材能识别；否则保持 -1，调用方会走 fallback（旧行为） */
    _heroHeadTop = max;
  }

  var heroCache = {};
  function heroSprite(dir, step, pal) {
    pal = pal || HERO;
    var key = 'hero|' + dir + '|' + step + '|' + pal.robe;
    if (heroCache[key]) return heroCache[key];
    /* 素材层优先：manifest 里登记 char.hero.<dir>.<step> 就整张替换（建议出图 168×252） */
    var im = G.Assets && G.Assets.img ? G.Assets.img('char.hero.' + dir + '.' + step) : null;
    var c;
    if (im) {
      var o = A.cv(HERO_LW, HERO_LH);
      o.x.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in o.x) o.x.imageSmoothingQuality = 'high';
      var stepY = step === 1 ? -1 : 0;
      _ensureHeroHeadTop();
      var top = _heroContentTop(im);
      var ih = im.naturalHeight || im.height;
      if (top >= 0 && _heroHeadTop >= 0 && top <= ih - 1) {
        /* 把 content_top 钉到 _heroHeadTop 对应的 dest y，feet 钉到 HERO_LH。
           9-arg drawImage：crop src 顶 top px 丢掉，把剩余塞进 dest 矩形。 */
        var headDst = _heroHeadTop * HERO_LH / HERO_SRC_H;
        var dstH = HERO_LH - headDst;
        var srcH = ih - top;
        o.x.drawImage(im, 0, top, im.naturalWidth || im.width, srcH,
                       0, headDst + stepY, HERO_LW, dstH);
      } else {
        /* Fallback：无法识别内容盒（无 DOM 或素材未就绪），沿用旧均匀缩放 */
        o.x.drawImage(im, 0, stepY, HERO_LW, HERO_LH);
      }
      c = o.c;
    } else {
      c = bake(heroParts(dir, step, pal), 16, 24, null, { scale: MAP_SCALE });
      if (dir === 'right') c = mirror(c);
    }
    heroCache[key] = c;
    return c;
  }

  function makeHero(pal) {
    var out = {};
    ['down', 'left', 'right', 'up'].forEach(function (d) {
      out[d] = [heroSprite(d, 0, pal), heroSprite(d, 1, pal), heroSprite(d, 2, pal)];
    });
    return out;
  }

  /* ---------- NPC ---------- */
  function npcParts(kind, pal) {
    var P = [];
    function add(x, y, w, h, c, extra) {
      var o = { x: x, y: y, w: w, h: h, c: c };
      if (extra) for (var k in extra) o[k] = extra[k];
      P.push(o);
    }
    var hat = kind === 'keeper';
    var beard = kind === 'elder';

    add(4.0, 2.6, 8.0, 6.4, pal.skin);
    add(3.2, 1.0, 9.6, 3.4, pal.hair);
    add(3.2, 3.4, 1.7, 3.8, pal.hair);
    add(11.1, 3.4, 1.7, 3.8, pal.hair);
    add(4.0, 7.4, 8.0, 1.6, pal.skinSh);
    add(5.9, 5.6, 1.2, 1.3, '#201d28');
    add(9.0, 5.6, 1.2, 1.3, '#201d28');
    /* 眉 */
    add(5.7, 4.9, 1.6, 0.6, pal.hair);
    add(8.8, 4.9, 1.6, 0.6, pal.hair);

    if (beard) {
      add(5.4, 7.2, 5.2, 1.0, '#e8e4da');
      add(6.2, 8.0, 3.6, 3.2, '#e8e4da');
      add(7.0, 10.6, 2.0, 2.4, '#e8e4da');
      add(6.4, 8.2, 3.2, 0.7, '#ffffff', { alpha: 0.6 });
    }
    if (hat) {
      add(2.6, 0.6, 10.8, 2.2, '#3a3f52');
      add(2.6, 0.6, 10.8, 0.7, '#525870');
      add(3.4, -0.8, 9.2, 1.8, '#2e3244');
    }

    add(7.0, 8.6, 2.2, 1.3, pal.skinSh);
    add(4.6, 9.4, 6.8, 1.9, pal.collar);
    add(3.1, 10.3, 9.8, 6.2, pal.robe);
    add(3.5, 10.3, 1.2, 6.0, A.shade(pal.robe, 0.14));
    add(11.3, 10.3, 1.5, 6.0, pal.robeDark);
    add(6.4, 9.8, 1.7, 2.6, A.shade(pal.robe, 0.10));
    add(8.3, 9.8, 1.7, 2.6, pal.robe);
    add(3.1, 14.4, 9.8, 1.9, pal.belt);
    add(3.1, 14.4, 9.8, 0.6, A.shade(pal.belt, 0.22));
    add(3.6, 16.3, 8.8, 3.4, pal.robeDark);
    add(3.6, 16.3, 8.8, 0.8, pal.robe);
    add(2.0, 11.3, 1.9, 5.0, pal.robe);
    add(2.0, 16.1, 1.6, 1.7, pal.skin);
    add(12.3, 11.3, 1.9, 5.0, pal.robeDark);
    add(12.4, 16.1, 1.6, 1.7, pal.skin);
    add(4.4, 21.2, 3.1, 2.0, pal.shoe);
    add(8.6, 21.2, 3.1, 2.0, pal.shoe);
    return P;
  }

  var npcCache = {};
  function npcSprite(kind) {
    if (npcCache[kind]) return npcCache[kind];
    /* cultist = 血煞教探子（M1 §4）。他化名"行脚商"，但袍色压暗红 ——
       玩家得认得出"这人不对劲"，否则 m1-2 的目标是隐形的。 */
    var cult = kind === 'cultist';
    var pal = {
      hair: kind === 'elder' ? '#cfccc0' : (cult ? '#231d24' : '#2b2833'),
      skin: '#e8b890',
      /* 主色与暗部**必须拉开明度**：只差一点点的话，程序化立绘会糊成一块红方块
         （第一版 6d3038 / 4a1f27 就是这样，远看像邮筒）。 */
      robe: kind === 'elder' ? '#6b7a68' : kind === 'keeper' ? '#7a6a52' : (cult ? '#7a343d' : '#8a8a92'),
      robeDark: kind === 'elder' ? '#4c5949' : kind === 'keeper' ? '#5a4d3a' : (cult ? '#3d171c' : '#66666e'),
      collar: cult ? '#c9a2a6' : '#e6ddc2', belt: '#5a4632', shoe: '#2c2a30'
    };
    /* 素材层优先：登记 char.npc.<kind> 就整张替换 */
    var im = G.Assets && G.Assets.img ? G.Assets.img('char.npc.' + kind) : null;
    var c;
    if (im) {
      var o = A.cv(HERO_LW, HERO_LH);
      o.x.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in o.x) o.x.imageSmoothingQuality = 'high';
      o.x.drawImage(im, 0, 0, HERO_LW, HERO_LH);
      c = o.c;
    } else {
      c = bake(npcParts(kind, pal), 16, 24, null, { scale: MAP_SCALE });
    }
    npcCache[kind] = c;
    return c;
  }

  /* ---------- 战斗立绘（40×40 逻辑，敌方朝左） ---------- */
  var BEAST_LW = 40, BEAST_LH = 40;
  var beastCache = {};
  function beastSprite(kind) {
    if (beastCache[kind]) return beastCache[kind];
    /* 素材层优先：主角查 battle.hero，其余查 battle.enemy.<kind> */
    var key = kind === 'hero' ? 'battle.hero' : 'battle.enemy.' + kind;
    var im = G.Assets && G.Assets.img ? G.Assets.img(key) : null;
    var c;
    if (im) {
      var o = A.cv(BEAST_LW, BEAST_LH);
      o.x.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in o.x) o.x.imageSmoothingQuality = 'high';
      o.x.drawImage(im, 0, 0, BEAST_LW, BEAST_LH);
      c = o.c;
    } else {
      c = BAKE[kind] ? BAKE[kind]() : BAKE.snake();
    }
    beastCache[kind] = c;
    return c;
  }

  /* 未来 Boss 素材解析：先查 manifest「battle.enemy.<artKey>」，缺图时退回程序化
     底怪 fallback（如 b1big 缺图 → killer）。后期出图登记后自动替换，无需改逻辑。 */
  function beastResolve(artKey, fallback) {
    var ck = artKey + '|' + fallback;
    if (beastCache[ck]) return beastCache[ck];
    var im = (artKey && G.Assets && G.Assets.img) ? G.Assets.img('battle.enemy.' + artKey) : null;
    var c;
    if (im) {
      var o = A.cv(BEAST_LW, BEAST_LH);
      o.x.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in o.x) o.x.imageSmoothingQuality = 'high';
      o.x.drawImage(im, 0, 0, BEAST_LW, BEAST_LH);
      c = o.c;
    } else {
      c = beastSprite(fallback || 'snake');
    }
    beastCache[ck] = c;
    return c;
  }

  function body(x, P, cx, cy, rx, ry, base, hi, dark, r) {
    x.fillStyle = dark; A.blob(x, cx, cy + ry * 0.10, rx, ry / rx);
    x.fillStyle = base; A.blob(x, cx, cy, rx * 0.97, ry / rx * 0.97);
    x.fillStyle = hi; A.blob(x, cx - rx * 0.26, cy - ry * 0.34, rx * 0.52, (ry / rx) * 0.9);
  }

  var BAKE = {
    /* 青纹蛇 */
    snake: function () {
      var o = A.cv(40, 40), x = o.x;
      A.shadowEllipse(x, 20, 37, 15, 4.5, 0.4);
      var base = '#3f7a4e', hi = '#6fbf7a', dark = '#26512f';
      /* 盘身 */
      x.strokeStyle = dark; x.lineWidth = 8; x.lineCap = 'round';
      x.beginPath(); x.arc(20, 30, 11, 3.4, 0.6); x.stroke();
      x.strokeStyle = base; x.lineWidth = 6;
      x.beginPath(); x.arc(20, 30, 11, 3.4, 0.6); x.stroke();
      /* 立起上身 */
      x.strokeStyle = dark; x.lineWidth = 8;
      x.beginPath(); x.moveTo(11, 31); x.quadraticCurveTo(9, 18, 15, 11); x.stroke();
      x.strokeStyle = base; x.lineWidth = 6;
      x.beginPath(); x.moveTo(11, 31); x.quadraticCurveTo(9, 18, 15, 11); x.stroke();
      /* 头 */
      body(x, null, 15.5, 9, 6.4, 4.6, base, hi, dark);
      /* 花纹 */
      x.fillStyle = 'rgba(230,240,190,0.55)';
      for (var i = 0; i < 4; i++) {
        x.fillRect(9 + i * 1.6, 26 - i * 3.4, 1.4, 1.4);
      }
      /* 眼 */
      x.fillStyle = '#f6d34a';
      x.beginPath(); x.arc(12.4, 7.4, 1.5, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(17.4, 7.0, 1.5, 0, 6.2832); x.fill();
      x.fillStyle = '#1a1a22';
      x.fillRect(12.0, 7.0, 0.9, 2.4);
      x.fillRect(17.0, 6.6, 0.9, 2.4);
      /* 信子 */
      x.strokeStyle = '#d94a5a'; x.lineWidth = 0.8;
      x.beginPath(); x.moveTo(15.5, 11.4); x.lineTo(15.5, 14);
      x.moveTo(15.5, 14); x.lineTo(13.8, 15.4);
      x.moveTo(15.5, 14); x.lineTo(17.2, 15.4);
      x.stroke();
      return o.c;
    },

    /* 赤炎狼 */
    wolf: function () {
      var o = A.cv(40, 40), x = o.x;
      A.shadowEllipse(x, 21, 36, 16, 4.6, 0.44);
      var base = '#b8542f', hi = '#e8813f', dark = '#6d2c18', deep = '#3d170c';
      /* 后腿（暗，退到后面） */
      x.strokeStyle = dark; x.lineWidth = 3.8; x.lineCap = 'round';
      [[12, 26], [17, 28]].forEach(function (p) {
        x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(p[0] - 1, 33.4); x.stroke();
      });
      /* 前腿（亮，靠近观者） */
      x.strokeStyle = A.shade(base, -0.05); x.lineWidth = 3.8;
      [[26, 26], [30, 28]].forEach(function (p) {
        x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(p[0] - 1, 33.4); x.stroke();
      });
      /* 爪 */
      x.fillStyle = deep;
      [[10.6, 34.2], [15.6, 34.2], [24.6, 34.2], [28.6, 34.2]].forEach(function (p) {
        A.blob(x, p[0], p[1], 2.2, 0.68);
      });

      /* 躯干 */
      body(x, null, 21, 24, 12, 7.4, base, hi, dark);
      /* 腹部暗面（把圆柱体积压出来） */
      x.fillStyle = A.alpha(dark, 0.42);
      A.blob(x, 21, 28.9, 10.4, 0.40);
      /* 背脊高光 */
      x.strokeStyle = A.alpha('#ffd9a8', 0.42); x.lineWidth = 1.3;
      x.beginPath(); x.moveTo(13.5, 19.6); x.quadraticCurveTo(22, 16.4, 31.5, 20.0); x.stroke();
      /* 毛发走向 */
      x.strokeStyle = A.alpha(dark, 0.32); x.lineWidth = 0.55;
      for (var i = 0; i < 7; i++) {
        var fx = 14 + i * 2.6;
        x.beginPath();
        x.moveTo(fx, 20.2 + Math.sin(i) * 0.6);
        x.quadraticCurveTo(fx + 0.6, 23.5, fx - 0.4, 26.4);
        x.stroke();
      }

      /* 尾（火焰）：暗描边 → 主色 → 内焰 → 焰心 */
      x.strokeStyle = dark; x.lineWidth = 4.8; x.lineCap = 'round';
      x.beginPath(); x.moveTo(31.5, 22); x.quadraticCurveTo(38.4, 18.4, 35.4, 10.6); x.stroke();
      x.strokeStyle = '#e0603c'; x.lineWidth = 3.2;
      x.beginPath(); x.moveTo(31.5, 22); x.quadraticCurveTo(38.4, 18.4, 35.4, 10.6); x.stroke();
      x.strokeStyle = A.alpha('#ffc27a', 0.85); x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(32.4, 21.4); x.quadraticCurveTo(37.6, 18.2, 35.2, 12.2); x.stroke();
      x.fillStyle = 'rgba(255,190,110,0.85)';
      A.blob(x, 35.2, 10.2, 3.2, 1.5);
      x.fillStyle = A.alpha('#fff0c8', 0.70);
      A.blob(x, 34.6, 9.4, 1.5, 1.4);

      /* 头 */
      body(x, null, 11, 18, 7.6, 6.2, base, hi, dark);
      /* 耳 */
      x.fillStyle = dark;
      x.beginPath(); x.moveTo(6.6, 13.2); x.lineTo(8.8, 5.6); x.lineTo(12.2, 11.8); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(12.8, 11.8); x.lineTo(15.8, 5.6); x.lineTo(17.6, 12.4); x.closePath(); x.fill();
      x.fillStyle = '#e8a08a';
      x.beginPath(); x.moveTo(8.4, 12.2); x.lineTo(9.5, 8.0); x.lineTo(11.0, 12.0); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(14.2, 12.0); x.lineTo(15.2, 8.2); x.lineTo(16.2, 12.2); x.closePath(); x.fill();
      /* 吻 */
      x.fillStyle = hi;
      A.blob(x, 6.4, 20.4, 3.5, 0.78);
      x.fillStyle = A.alpha(hi, 0.55);
      A.blob(x, 5.8, 19.4, 2.2, 0.70);
      x.fillStyle = '#3a1c12';
      A.blob(x, 4.4, 19.6, 1.5, 0.9);
      /* 眼 */
      x.fillStyle = '#ffd45a';
      x.beginPath(); x.arc(9.4, 16.6, 1.7, 0, 6.2832); x.fill();
      x.fillStyle = '#241018';
      x.fillRect(9.0, 16.2, 0.9, 2.7);
      x.fillStyle = A.alpha('#ffffff', 0.65);
      x.fillRect(9.2, 16.0, 0.7, 0.7);
      /* 焰纹 */
      x.fillStyle = 'rgba(255,196,110,0.52)';
      A.blob(x, 20, 21, 4.4, 0.45);
      x.fillStyle = 'rgba(255,220,150,0.42)';
      A.blob(x, 24.5, 18.5, 2.6, 0.50);
      return o.c;
    },

    /* 树精 */
    tree: function () {
      var o = A.cv(40, 40), x = o.x;
      A.shadowEllipse(x, 20, 36, 15, 4.5, 0.4);
      var base = '#6b5138', hi = '#8f6f4c', dark = '#402f20';
      /* 根足 */
      x.fillStyle = dark;
      x.beginPath(); x.moveTo(12, 28); x.lineTo(8, 35); x.lineTo(16, 32); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(28, 28); x.lineTo(32, 35); x.lineTo(24, 32); x.closePath(); x.fill();
      /* 主干 */
      var g = x.createLinearGradient(14, 0, 28, 0);
      g.addColorStop(0, dark); g.addColorStop(0.42, hi); g.addColorStop(1, dark);
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(13, 33); x.lineTo(15, 12); x.lineTo(26, 12); x.lineTo(28, 33);
      x.closePath(); x.fill();
      /* 树皮纹 */
      x.strokeStyle = 'rgba(30,22,14,0.5)'; x.lineWidth = 0.7;
      for (var i = 0; i < 4; i++) {
        x.beginPath();
        x.moveTo(16 + i * 3, 14);
        x.quadraticCurveTo(15 + i * 3, 23, 17 + i * 3, 32);
        x.stroke();
      }
      /* 枝臂 */
      x.strokeStyle = dark; x.lineWidth = 3.4; x.lineCap = 'round';
      x.beginPath(); x.moveTo(15, 18); x.quadraticCurveTo(6, 15, 4, 8); x.stroke();
      x.beginPath(); x.moveTo(26, 17); x.quadraticCurveTo(34, 14, 36, 7); x.stroke();
      /* 树冠 */
      body(x, null, 20, 9, 13, 8.4, '#3f7a4e', '#6fbf7a', '#26512f');
      body(x, null, 9, 10, 6, 5, '#3f7a4e', '#6fbf7a', '#26512f');
      body(x, null, 31, 10, 6, 5, '#3f7a4e', '#6fbf7a', '#26512f');
      /* 脸 */
      x.fillStyle = '#ffd45a';
      A.blob(x, 17, 21, 2.4, 1);
      A.blob(x, 24, 21, 2.4, 1);
      x.fillStyle = '#241c10';
      A.blob(x, 17, 21.4, 1.1, 1);
      A.blob(x, 24, 21.4, 1.1, 1);
      x.strokeStyle = 'rgba(30,22,14,0.8)'; x.lineWidth = 1;
      x.beginPath(); x.arc(20.5, 25, 3, 0.2, 2.94); x.stroke();
      return o.c;
    },

    /* 赤炎狼王 */
    wolfking: function () {
      var o = A.cv(40, 40), x = o.x;
      A.shadowEllipse(x, 21, 37, 17, 5, 0.46);
      /* 煞气 */
      var gg = x.createRadialGradient(18, 22, 3, 18, 22, 20);
      gg.addColorStop(0, 'rgba(224,74,60,0.30)');
      gg.addColorStop(1, 'rgba(224,74,60,0)');
      x.fillStyle = gg;
      x.beginPath(); x.arc(18, 22, 20, 0, 6.2832); x.fill();
      var base = '#8f2f22', hi = '#e0603c', dark = '#4a1410', deep = '#280805';
      /* 腿 */
      x.strokeStyle = deep; x.lineWidth = 4.4; x.lineCap = 'round';
      [[11, 25], [16, 27]].forEach(function (p) {
        x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(p[0] - 1.5, 33.6); x.stroke();
      });
      x.strokeStyle = A.shade(base, -0.06); x.lineWidth = 4.4;
      [[26, 25], [31, 27]].forEach(function (p) {
        x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(p[0] - 1.5, 33.6); x.stroke();
      });
      /* 利爪 */
      x.fillStyle = '#e8dcc0';
      [[9.4, 34.6], [14.4, 34.6], [24.4, 34.6], [29.4, 34.6]].forEach(function (p) {
        x.beginPath(); x.moveTo(p[0] - 1.4, 33.6); x.lineTo(p[0], 36.2); x.lineTo(p[0] + 1.4, 33.6);
        x.closePath(); x.fill();
      });

      /* 躯干 */
      body(x, null, 21, 23, 13, 8, base, hi, dark);
      /* 腹部暗面 */
      x.fillStyle = A.alpha(deep, 0.46);
      A.blob(x, 21, 28.6, 11.2, 0.42);
      /* 背脊高光 */
      x.strokeStyle = A.alpha('#ffbe86', 0.44); x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(12.5, 18.2); x.quadraticCurveTo(22, 14.6, 32.5, 18.8); x.stroke();
      /* 肌肉/毛发走向 */
      x.strokeStyle = A.alpha(deep, 0.34); x.lineWidth = 0.6;
      for (var i = 0; i < 8; i++) {
        var fx = 13 + i * 2.5;
        x.beginPath();
        x.moveTo(fx, 18.8 + Math.sin(i) * 0.7);
        x.quadraticCurveTo(fx + 0.7, 22.6, fx - 0.5, 25.8);
        x.stroke();
      }

      /* 焰尾 */
      x.strokeStyle = deep; x.lineWidth = 6.0; x.lineCap = 'round';
      x.beginPath(); x.moveTo(33, 21); x.quadraticCurveTo(39, 16, 36, 8); x.stroke();
      x.strokeStyle = '#ff7a3c'; x.lineWidth = 4.4;
      x.beginPath(); x.moveTo(33, 21); x.quadraticCurveTo(39, 16, 36, 8); x.stroke();
      x.strokeStyle = A.alpha('#ffd08a', 0.85); x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(33.8, 20.4); x.quadraticCurveTo(38.2, 16, 36.0, 9.6); x.stroke();
      x.fillStyle = 'rgba(255,200,110,0.80)';
      A.blob(x, 36, 8, 3.6, 1.5);
      x.fillStyle = A.alpha('#fff2d0', 0.70);
      A.blob(x, 35.4, 7.2, 1.7, 1.4);

      /* 头 */
      body(x, null, 10, 17, 8.4, 6.8, base, hi, dark);
      /* 角（带受光面） */
      x.fillStyle = '#d8cbb0';
      x.beginPath(); x.moveTo(7, 12); x.lineTo(4, 3); x.lineTo(10, 11); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(13, 11); x.lineTo(16, 3); x.lineTo(17, 12); x.closePath(); x.fill();
      x.fillStyle = A.alpha('#fff8e0', 0.55);
      x.beginPath(); x.moveTo(7, 11.6); x.lineTo(4.8, 4.4); x.lineTo(6.4, 4.6); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(13.2, 10.8); x.lineTo(15.6, 4.4); x.lineTo(16.4, 4.8); x.closePath(); x.fill();
      /* 耳 */
      x.fillStyle = dark;
      x.beginPath(); x.moveTo(4, 14); x.lineTo(1, 8); x.lineTo(8, 13); x.closePath(); x.fill();
      /* 吻部：必须突出到头部轮廓之外才读得出"狼"。
         只在头内部画个浅色斑，放大后还是一团圆。 */
      x.fillStyle = base;
      x.beginPath();
      x.moveTo(7.0, 15.4);
      x.quadraticCurveTo(1.6, 17.2, 0.7, 20.4);
      x.quadraticCurveTo(2.8, 22.5, 7.2, 22.3);
      x.closePath(); x.fill();
      x.fillStyle = A.alpha(hi, 0.72);
      x.beginPath();
      x.moveTo(6.4, 16.9);
      x.quadraticCurveTo(2.4, 18.4, 1.6, 20.5);
      x.quadraticCurveTo(3.4, 21.7, 6.6, 21.5);
      x.closePath(); x.fill();
      x.fillStyle = '#2a0e0a'; A.blob(x, 1.5, 19.5, 1.7, 1.0);
      x.strokeStyle = A.alpha(deep, 0.85); x.lineWidth = 0.6;
      x.beginPath(); x.moveTo(2.2, 21.2); x.quadraticCurveTo(4.8, 21.9, 6.8, 21.4); x.stroke();
      /* 眼（带辉光） */
      x.fillStyle = 'rgba(255,226,122,0.30)';
      A.blob(x, 8.4, 15.6, 3.4, 1);
      x.fillStyle = '#ffe27a';
      A.blob(x, 8.4, 15.6, 2.1, 1);
      x.fillStyle = '#2a0e0a';
      A.blob(x, 8.0, 15.8, 1, 1.5);
      x.fillStyle = A.alpha('#ffffff', 0.7);
      A.blob(x, 8.9, 14.9, 0.7, 1);
      /* 鬃焰：拉高收窄 + 拉出火苗尖端。
         等大的圆球排一排会读成背上的骨板，而不是燃烧的鬃毛。 */
      for (var m = 0; m < 5; m++) {
        var mx = 18 + m * 3.0, my = 14.6 - Math.sin(m * 1.1) * 1.5;
        x.fillStyle = 'rgba(255,120,50,0.42)';
        A.blob(x, mx, my + 0.4, 2.5, 1.85);
        x.fillStyle = 'rgba(255,176,96,0.62)';
        A.blob(x, mx, my - 1.0, 1.8, 1.85);
        x.fillStyle = A.alpha('#fff0c8', 0.52);
        A.blob(x, mx - 0.3, my - 2.1, 0.95, 1.6);
        x.fillStyle = 'rgba(255,224,158,0.42)';
        x.beginPath();
        x.moveTo(mx - 0.8, my - 2.3);
        x.lineTo(mx + (m % 2 ? 0.9 : -0.9), my - 4.3);
        x.lineTo(mx + 0.9, my - 2.1);
        x.closePath(); x.fill();
      }
      return o.c;
    },

    /* 血煞教杀手：与主角同一套有机路径管线，只是配色更暗、蒙面持刀 */
    killer: function () {
      var o = A.cv(40, 40), x = o.x;
      A.shadowEllipse(x, 20, 37, 13.5, 4.6, 0.46);
      var P = [];
      function add(a, b, w, h, c, extra) {
        var q = { x: a, y: b, w: w, h: h, c: c };
        if (extra) for (var k in extra) q[k] = extra[k];
        P.push(q);
      }
      function path(fn, c, extra) {
        var q = { path: fn, c: c };
        if (extra) for (var k in extra) q[k] = extra[k];
        P.push(q);
      }
      /* 袍与头巾拉开明度差：原来两处同色，放大后整个剪影糊成一团黑 */
      var robe = '#2b3145', robeHi = '#4c5470', robeDark = '#171a26', sash = '#8a2427';
      var hood = '#3a4258';

      function robePath(xx) {
        xx.beginPath();
        xx.moveTo(12.6, 16.4);
        xx.quadraticCurveTo(20, 13.9, 27.4, 16.4);
        xx.quadraticCurveTo(29.0, 21.4, 29.6, 27.4);
        xx.quadraticCurveTo(25.4, 29.4, 20, 29.4);
        xx.quadraticCurveTo(14.6, 29.4, 10.4, 27.4);
        xx.quadraticCurveTo(11.0, 21.4, 12.6, 16.4);
        xx.closePath();
      }
      function shoulderL(xx) {
        xx.beginPath();
        xx.moveTo(12.8, 15.4);
        xx.quadraticCurveTo(8.6, 14.8, 8.4, 18.8);
        xx.quadraticCurveTo(9.8, 21.4, 12.4, 21.2);
        xx.quadraticCurveTo(13.4, 18.2, 12.8, 15.4);
        xx.closePath();
      }
      function shoulderR(xx) {
        xx.beginPath();
        xx.moveTo(27.2, 15.4);
        xx.quadraticCurveTo(31.4, 14.8, 31.6, 18.8);
        xx.quadraticCurveTo(30.2, 21.4, 27.6, 21.2);
        xx.quadraticCurveTo(26.6, 18.2, 27.2, 15.4);
        xx.closePath();
      }
      function sleeveL(xx) {
        xx.beginPath();
        xx.moveTo(13.6, 16.6);
        xx.quadraticCurveTo(10.0, 17.4, 9.4, 21.0);
        xx.quadraticCurveTo(9.0, 24.4, 11.1, 25.7);
        xx.quadraticCurveTo(13.7, 24.9, 14.1, 21.2);
        xx.closePath();
      }
      function sleeveR(xx) {
        xx.beginPath();
        xx.moveTo(26.4, 16.6);
        xx.quadraticCurveTo(30.0, 17.4, 30.6, 21.0);
        xx.quadraticCurveTo(31.0, 24.4, 28.9, 25.7);
        xx.quadraticCurveTo(26.3, 24.9, 25.9, 21.2);
        xx.closePath();
      }
      function headPath(xx) {
        xx.beginPath();
        xx.moveTo(14.6, 5.6);
        xx.quadraticCurveTo(20, 3.6, 25.4, 5.6);
        xx.quadraticCurveTo(26.2, 9.6, 25.2, 12.6);
        xx.quadraticCurveTo(20, 15.5, 14.8, 12.6);
        xx.quadraticCurveTo(13.8, 9.6, 14.6, 5.6);
        xx.closePath();
      }
      function hoodPath(xx) {
        xx.beginPath();
        xx.moveTo(13.4, 8.8);
        xx.quadraticCurveTo(12.6, 2.4, 20, 2.2);
        xx.quadraticCurveTo(27.4, 2.4, 26.6, 8.8);
        xx.quadraticCurveTo(25.6, 6.4, 24.4, 5.8);
        xx.quadraticCurveTo(20, 8.1, 15.6, 5.8);
        xx.quadraticCurveTo(14.4, 6.4, 13.4, 8.8);
        xx.closePath();
      }
      function maskPath(xx) {
        xx.beginPath();
        xx.moveTo(14.1, 8.6);
        xx.quadraticCurveTo(20, 10.6, 25.9, 8.6);
        xx.quadraticCurveTo(26.3, 12.4, 25.2, 13.7);
        xx.quadraticCurveTo(20, 16.1, 14.8, 13.7);
        xx.quadraticCurveTo(13.7, 12.4, 14.1, 8.6);
        xx.closePath();
      }
      function beltPath(xx) {
        xx.beginPath();
        xx.moveTo(11.1, 20.9);
        xx.quadraticCurveTo(20, 19.7, 28.9, 20.9);
        xx.lineTo(29.1, 23.4);
        xx.quadraticCurveTo(20, 24.7, 10.9, 23.4);
        xx.closePath();
      }
      /* ---- 刀身几何：刀柄落在左手上，刀尖斜指左上 ----
         旧版把刀画成"身侧一根竖直长条 + 底下一个方块"，
         没有握持关系，读起来就是根立着的棍子。 */
      var HX = 12.0, HY = 26.6, TX = 3.4, TY = 5.2;
      var ddx = TX - HX, ddy = TY - HY, LL = Math.sqrt(ddx * ddx + ddy * ddy);
      var ux = ddx / LL, uy = ddy / LL, nx = -uy, ny = ux;
      function bp(t, off) {
        return [HX + ux * LL * t + nx * off, HY + uy * LL * t + ny * off];
      }
      function bladePath(xx) {
        var A1 = bp(0, 1.15), B1 = bp(0.86, 0.70), C1 = bp(1, 0), D1 = bp(0.86, -0.70), E1 = bp(0, -1.15);
        xx.beginPath();
        xx.moveTo(A1[0], A1[1]);
        xx.lineTo(B1[0], B1[1]);
        xx.lineTo(C1[0], C1[1]);
        xx.lineTo(D1[0], D1[1]);
        xx.lineTo(E1[0], E1[1]);
        xx.closePath();
      }
      function bladeShine(xx) {
        var p1 = bp(0.03, 0.92), p2 = bp(0.93, 0.50);
        xx.strokeStyle = 'rgba(234,242,255,0.88)';
        xx.lineWidth = 0.5;
        xx.beginPath(); xx.moveTo(p1[0], p1[1]); xx.lineTo(p2[0], p2[1]); xx.stroke();
        var q1 = bp(0.03, -0.82), q2 = bp(0.90, -0.44);
        xx.strokeStyle = 'rgba(0,0,0,0.32)';
        xx.beginPath(); xx.moveTo(q1[0], q1[1]); xx.lineTo(q2[0], q2[1]); xx.stroke();
      }
      function guardDraw(xx) {
        var g1 = bp(0, 2.0), g2 = bp(0, -2.0);
        xx.strokeStyle = '#3a2c1e'; xx.lineWidth = 1.7; xx.lineCap = 'round';
        xx.beginPath(); xx.moveTo(g1[0], g1[1]); xx.lineTo(g2[0], g2[1]); xx.stroke();
        xx.strokeStyle = 'rgba(198,166,102,0.70)'; xx.lineWidth = 0.6;
        xx.beginPath(); xx.moveTo(g1[0], g1[1]); xx.lineTo(g2[0], g2[1]); xx.stroke();
      }
      function gripDraw(xx) {
        var r1 = bp(0, 0), r2 = bp(-0.16, 0);
        xx.strokeStyle = '#241c14'; xx.lineWidth = 2.0; xx.lineCap = 'round';
        xx.beginPath(); xx.moveTo(r1[0], r1[1]); xx.lineTo(r2[0], r2[1]); xx.stroke();
        xx.fillStyle = '#8d7a4e';
        xx.beginPath(); xx.arc(r2[0], r2[1], 1.2, 0, 6.2832); xx.fill();
      }

      /* ---- 腿脚 ---- */
      add(15.2, 26.4, 3.8, 8.4, robeDark);
      add(21.0, 26.4, 3.8, 8.4, '#0e1018');
      add(14.7, 33.6, 4.8, 2.7, '#1a1a20');
      add(20.6, 33.6, 4.8, 2.7, '#1a1a20');

      /* ---- 袖（左手留在最后画，好压住刀柄） ---- */
      path(sleeveL, robe);
      path(sleeveR, robeDark);
      add(26.6, 25.0, 3.3, 2.9, '#b8907e', { round: true });

      /* ---- 袍身 ---- */
      P.push({
        clip: robePath, path: robePath, c: robe,
        paint: function (xx) {
          var g = xx.createLinearGradient(10, 0, 30, 0);
          g.addColorStop(0, A.alpha(robeHi, 0.50));
          g.addColorStop(0.42, 'rgba(255,255,255,0)');
          g.addColorStop(1, 'rgba(0,0,0,0.42)');
          xx.fillStyle = g; xx.fillRect(9, 13, 22, 17);
          xx.strokeStyle = 'rgba(0,0,0,0.26)';
          xx.lineWidth = 0.6;
          [[16.6, 17.4, 15.6, 28.8], [23.4, 17.4, 24.4, 28.8], [20, 23.4, 20, 29]]
            .forEach(function (l) {
              xx.beginPath();
              xx.moveTo(l[0], l[1]);
              xx.quadraticCurveTo(l[0] + (l[2] - l[0]) * 0.35, 23.4, l[2], l[3]);
              xx.stroke();
            });
        }
      });

      /* ---- 腰带（血色） ---- */
      path(beltPath, sash);
      P.push({
        clip: beltPath, c: '#a83236',
        paint: function (xx) { xx.fillStyle = 'rgba(168,50,54,0.85)'; xx.fillRect(10, 20.6, 20, 0.9); }
      });
      add(19.0, 21.4, 2.2, 1.8, '#c9a24a', { round: true });
      add(12.2, 23.5, 15.6, 0.9, 'rgba(0,0,0,0.26)');

      /* ---- 肩甲 ---- */
      path(shoulderL, '#232838');
      path(shoulderR, '#1b1f2c');
      path(shoulderL, 'rgba(255,255,255,0.13)', { alpha: 0.9 });

      /* ---- 刀：画在袍身之上，刀柄落到左手位置 ---- */
      path(bladePath, '#8d97ab');
      P.push({ clip: bladePath, noOutline: true, paint: bladeShine });
      P.push({ noOutline: true, paint: guardDraw });
      P.push({ noOutline: true, paint: gripDraw });
      /* 握刀的手：压在刀柄上，握持关系才成立 */
      add(10.3, 25.1, 3.5, 3.1, '#d8b0a0', { round: true });
      add(10.6, 25.3, 2.9, 1.0, 'rgba(255,236,222,0.28)');

      /* ---- 头 ---- */
      path(headPath, '#c99a80');
      add(15.6, 5.8, 8.8, 1.4, 'rgba(255,225,200,0.45)');
      /* 蒙面布（压暗，让露出的皮肤与眼成为视觉焦点） */
      path(maskPath, '#12141c');
      /* 头巾 */
      path(hoodPath, hood);
      add(15.6, 3.2, 8.8, 1.0, A.alpha('#7d879f', 0.55));
      add(13.4, 5.0, 13.2, 1.1, 'rgba(0,0,0,0.42)');
      /* 眼（血红，露在蒙面布上沿） */
      add(16.4, 7.2, 2.2, 1.7, '#e8e2d0');
      add(21.4, 7.2, 2.2, 1.7, '#e8e2d0');
      add(16.8, 7.4, 1.4, 1.5, '#c0202a');
      add(21.8, 7.4, 1.4, 1.5, '#c0202a');
      return bake(P, 40, 40);
    },

    /* 主角战斗形象：改用有机路径而非一堆矩形，
       矩形拼接的"方块人"在放大后一眼就能看出是色块。 */
    hero: function () {
      var o = A.cv(40, 40), x = o.x;
      A.shadowEllipse(x, 20, 37, 13.5, 4.6, 0.44);
      var P = [];
      function add(a, b, w, h, c, extra) {
        var q = { x: a, y: b, w: w, h: h, c: c };
        if (extra) for (var k in extra) q[k] = extra[k];
        P.push(q);
      }
      function path(fn, c, extra) {
        var q = { path: fn, c: c };
        if (extra) for (var k in extra) q[k] = extra[k];
        P.push(q);
      }
      var pal = HERO;

      /* ---- 轮廓路径 ---- */
      function robePath(xx) {
        xx.beginPath();
        xx.moveTo(12.6, 17.2);
        xx.quadraticCurveTo(20, 14.5, 27.4, 17.2);
        xx.quadraticCurveTo(28.6, 21.6, 28.8, 27.0);
        xx.quadraticCurveTo(25.2, 29.0, 20, 29.0);
        xx.quadraticCurveTo(14.8, 29.0, 11.2, 27.0);
        xx.quadraticCurveTo(11.4, 21.6, 12.6, 17.2);
        xx.closePath();
      }
      function sleeveL(xx) {
        xx.beginPath();
        xx.moveTo(13.4, 16.6);
        xx.quadraticCurveTo(9.2, 17.4, 8.6, 21.0);
        xx.quadraticCurveTo(8.2, 24.6, 10.5, 26.0);
        xx.quadraticCurveTo(13.3, 25.2, 13.7, 21.2);
        xx.closePath();
      }
      function sleeveR(xx) {
        xx.beginPath();
        xx.moveTo(26.6, 16.6);
        xx.quadraticCurveTo(30.8, 17.4, 31.4, 21.0);
        xx.quadraticCurveTo(31.8, 24.6, 29.5, 26.0);
        xx.quadraticCurveTo(26.7, 25.2, 26.3, 21.2);
        xx.closePath();
      }
      function headPath(xx) {
        xx.beginPath();
        xx.moveTo(14.5, 5.4);
        xx.quadraticCurveTo(20, 3.5, 25.5, 5.4);
        xx.quadraticCurveTo(26.4, 9.4, 25.3, 12.2);
        xx.quadraticCurveTo(20, 15.3, 14.7, 12.2);
        xx.quadraticCurveTo(13.6, 9.4, 14.5, 5.4);
        xx.closePath();
      }
      function hairPath(xx) {
        xx.beginPath();
        xx.moveTo(13.4, 7.0);
        xx.quadraticCurveTo(12.9, 2.6, 20, 2.3);
        xx.quadraticCurveTo(27.1, 2.6, 26.6, 7.0);
        xx.quadraticCurveTo(25.4, 5.0, 24.3, 4.6);
        xx.quadraticCurveTo(20, 6.6, 15.7, 4.6);
        xx.quadraticCurveTo(14.6, 5.0, 13.4, 7.0);
        xx.closePath();
      }
      function lockL(xx) {
        xx.beginPath();
        xx.moveTo(14.8, 4.9);
        xx.quadraticCurveTo(13.9, 6.6, 14.1, 8.7);
        xx.quadraticCurveTo(14.9, 9.1, 15.5, 8.2);
        xx.quadraticCurveTo(15.2, 6.5, 15.8, 4.9);
        xx.closePath();
      }
      function lockR(xx) {
        xx.beginPath();
        xx.moveTo(25.2, 4.9);
        xx.quadraticCurveTo(26.1, 6.6, 25.9, 8.7);
        xx.quadraticCurveTo(25.1, 9.1, 24.5, 8.2);
        xx.quadraticCurveTo(24.8, 6.5, 24.2, 4.9);
        xx.closePath();
      }
      /* 交领：一条窄领带，不是一大块亮三角——否则像戴了围裙 */
      function collarPath(xx) {
        xx.beginPath();
        xx.moveTo(14.9, 13.9);
        xx.quadraticCurveTo(20, 18.3, 25.1, 13.9);
        xx.quadraticCurveTo(25.0, 13.1, 24.3, 13.0);
        xx.quadraticCurveTo(20, 16.6, 15.7, 13.0);
        xx.quadraticCurveTo(15.0, 13.1, 14.9, 13.9);
        xx.closePath();
      }
      function beltPath(xx) {
        xx.beginPath();
        xx.moveTo(12.4, 22.6);
        xx.quadraticCurveTo(20, 21.4, 27.6, 22.6);
        xx.lineTo(27.8, 24.9);
        xx.quadraticCurveTo(20, 26.2, 12.2, 24.9);
        xx.closePath();
      }
      function sashL(xx) {
        xx.beginPath();
        xx.moveTo(12.6, 24.6);
        xx.quadraticCurveTo(10.4, 28.0, 11.4, 31.4);
        xx.quadraticCurveTo(12.2, 32.3, 13.2, 31.6);
        xx.quadraticCurveTo(13.0, 28.2, 14.0, 25.0);
        xx.closePath();
      }
      function sashR(xx) {
        xx.beginPath();
        xx.moveTo(27.4, 24.6);
        xx.quadraticCurveTo(29.6, 28.0, 28.6, 31.4);
        xx.quadraticCurveTo(27.8, 32.3, 26.8, 31.6);
        xx.quadraticCurveTo(27.0, 28.2, 26.0, 25.0);
        xx.closePath();
      }
      /* ---- 腿脚 ---- */
      add(15.2, 26.0, 3.8, 8.6, pal.robeDark);
      add(21.0, 26.0, 3.8, 8.6, A.shade(pal.robeDark, -0.10));
      add(14.7, 33.5, 4.8, 2.7, pal.shoe);
      add(20.6, 33.5, 4.8, 2.7, pal.shoe);

      /* ---- 袖（在袍身之下，袍身盖住肩部接缝） ---- */
      path(sleeveL, pal.robe);
      path(sleeveR, A.shade(pal.robe, -0.12));
      add(9.2, 25.2, 3.6, 3.2, pal.skin, { round: true });
      add(27.2, 25.2, 3.6, 3.2, A.shade(pal.skin, -0.10), { round: true });

      /* ---- 袍身：路径 + 内部裁剪铺明暗与衣褶 ---- */
      P.push({
        clip: robePath, path: robePath, c: pal.robe,
        paint: function (xx) {
          var g = xx.createLinearGradient(10, 0, 30, 0);
          g.addColorStop(0, A.alpha(pal.robeHi, 0.36));
          g.addColorStop(0.42, 'rgba(255,255,255,0)');
          g.addColorStop(1, A.alpha(pal.robeDark, 0.46));
          xx.fillStyle = g; xx.fillRect(9, 13, 22, 17);
          /* 衣褶 */
          xx.strokeStyle = 'rgba(0,0,0,0.17)';
          xx.lineWidth = 0.6;
          [[16.6, 17.6, 15.6, 28.6], [23.4, 17.6, 24.4, 28.6], [20, 23.0, 20, 28.8]]
            .forEach(function (l) {
              xx.beginPath();
              xx.moveTo(l[0], l[1]);
              xx.quadraticCurveTo(l[0] + (l[2] - l[0]) * 0.35, 23.2, l[2], l[3]);
              xx.stroke();
            });
        }
      });

      /* ---- 交领 ---- */
      path(collarPath, pal.collar);

      /* ---- 腰带 ---- */
      path(beltPath, pal.belt);
      P.push({
        clip: beltPath, c: pal.beltHi,
        paint: function (xx) {
          xx.fillStyle = A.alpha(pal.beltHi, 0.75);
          xx.fillRect(11, 22.3, 18, 0.9);
        }
      });
      add(18.6, 22.5, 2.5, 2.5, '#d8b768', { round: true });
      add(18.8, 22.7, 2.1, 0.8, 'rgba(255,246,214,0.65)');
      /* 腰带下投影 */
      add(13.0, 25.0, 14.0, 0.9, 'rgba(0,0,0,0.20)');

      /* ---- 飘带 ---- */
      path(sashL, pal.sash, { alpha: 0.92 });
      path(sashR, pal.sash, { alpha: 0.92 });

      /* ---- 头 ---- */
      P.push({
        clip: headPath, path: headPath, c: pal.skin,
        paint: function (xx) {
          /* 用渐变而不是"额头一条亮带 + 下颌一条暗带"：
             两条平直色带横贯整张脸时，脸会立刻读成方块。 */
          var gv = xx.createLinearGradient(0, 4, 0, 15.6);
          gv.addColorStop(0, A.alpha(pal.skinHi, 0.58));
          gv.addColorStop(0.34, 'rgba(255,255,255,0)');
          gv.addColorStop(0.76, 'rgba(0,0,0,0)');
          gv.addColorStop(1, A.alpha(pal.skinSh, 0.80));
          xx.fillStyle = gv; xx.fillRect(13, 3, 14, 13.6);
          /* 腮侧柔和收暗，把脸型从"方"拉回"椭圆" */
          xx.fillStyle = A.alpha(pal.skinSh, 0.26);
          xx.beginPath(); xx.ellipse(14.6, 10.6, 2.2, 3.1, 0, 0, 6.2832); xx.fill();
          xx.beginPath(); xx.ellipse(25.4, 10.6, 2.2, 3.1, 0, 0, 6.2832); xx.fill();
        }
      });
      /* 发 */
      path(hairPath, pal.hair);
      path(lockL, pal.hair);
      path(lockR, pal.hair);
      /* 发顶受光：横向一条亮带会让头发读成"头盔"，
         改成左上偏移 + 一道中分暗线。 */
      add(16.0, 3.0, 6.2, 1.0, A.alpha(pal.hairHi, 0.60));
      add(22.0, 4.1, 2.6, 0.7, A.alpha(pal.hairHi, 0.30));
      add(19.8, 3.4, 0.55, 2.6, A.alpha(pal.hair, 0.75));
      /* 眉 / 眼 / 鼻 */
      add(16.7, 7.6, 2.3, 0.75, A.alpha(pal.hair, 0.80));
      add(21.0, 7.6, 2.3, 0.75, A.alpha(pal.hair, 0.80));
      add(17.0, 9.2, 1.7, 2.0, pal.eye);
      add(21.3, 9.2, 1.7, 2.0, pal.eye);
      add(17.0, 9.1, 1.7, 0.7, 'rgba(255,255,255,0.62)');
      add(21.3, 9.1, 1.7, 0.7, 'rgba(255,255,255,0.62)');
      add(17.0, 11.0, 1.7, 0.5, A.alpha(pal.skinSh, 0.55));  /* 下眼睑 */
      add(21.3, 11.0, 1.7, 0.5, A.alpha(pal.skinSh, 0.55));
      add(19.7, 11.0, 0.8, 0.8, A.alpha(pal.skinSh, 0.9));   /* 鼻影 */
      return bake(P, 40, 40);
    },

    /* ===== M1：血煞教（设计 M1 v1.0 §5.3）=====
       三者都是"缺素材时的程序化兜底"。剪影比例对齐 killer（头 y1.6–15 / 身 y15–31 / 靴 y30–35），
       否则并排站着会比主角矮胖一大截。ell() 是椭圆工具，poly() 画多边形。 */
    cultist: function () {
      var o = A.cv(40, 40), x = o.x;
      function ell(cx, cy, rx, ry) { x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 6.2832); x.fill(); }
      function poly(p, c) {
        x.fillStyle = c; x.beginPath(); x.moveTo(p[0][0], p[0][1]);
        for (var i = 1; i < p.length; i++) x.lineTo(p[i][0], p[i][1]);
        x.closePath(); x.fill();
      }
      A.shadowEllipse(x, 20, 36, 12.5, 4.2, 0.46);
      var robe = '#33202c', robeHi = '#4e3040', robeDark = '#1b1018', blood = '#a8242c';
      /* 靴：藏在袍下只露一点，避免整块剪影"悬浮" */
      poly([[16.2, 29.6], [18.6, 29.6], [18.6, 34.8], [16.2, 34.8]], '#141018');
      poly([[21.4, 29.6], [23.8, 29.6], [23.8, 34.8], [21.4, 34.8]], '#0f0c12');
      /* 下摆（梯形张开）→ 袍身（肩宽腰收）→ 垂袖 → 血色腰带 */
      poly([[14.2, 22], [25.8, 22], [28.4, 31.4], [11.6, 31.4]], robeDark);
      x.fillStyle = robe;
      x.beginPath(); x.moveTo(14.6, 15.4);
      x.quadraticCurveTo(20, 13.6, 25.4, 15.4);
      x.quadraticCurveTo(25.0, 19.4, 25.6, 23.2);
      x.quadraticCurveTo(20, 24.8, 14.4, 23.2);
      x.quadraticCurveTo(15.0, 19.4, 14.6, 15.4); x.closePath(); x.fill();
      poly([[13.2, 16.6], [16.0, 15.8], [16.6, 24.8], [12.8, 24.0]], robeHi);
      poly([[24.0, 15.8], [26.8, 16.6], [27.2, 24.0], [23.4, 24.8]], robeHi);
      x.fillStyle = blood; x.fillRect(14.2, 20.4, 11.6, 2.0);
      /* 兜帽（罩住整个头）→ 面部阴影 → 血色目线 */
      x.fillStyle = robeDark;
      x.beginPath(); x.moveTo(14.8, 6.2);
      x.quadraticCurveTo(14.0, 1.4, 20, 1.4);
      x.quadraticCurveTo(26.0, 1.4, 25.2, 6.2);
      x.quadraticCurveTo(24.6, 12.6, 20, 15.0);
      x.quadraticCurveTo(15.4, 12.6, 14.8, 6.2); x.closePath(); x.fill();
      x.fillStyle = '#0b0608'; ell(20, 9.2, 4.6, 3.4);
      x.fillStyle = blood; x.fillRect(16.6, 8.0, 2.8, 1.0); x.fillRect(20.6, 8.0, 2.8, 1.0);
      return o.c;
    },

    bloodbat: function () {
      var o = A.cv(40, 40), x = o.x;
      function ell(cx, cy, rx, ry) { x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 6.2832); x.fill(); }
      A.shadowEllipse(x, 20, 35, 9, 3.2, 0.40);
      var wing = '#2a1630', wingHi = '#452443', body = '#190d1c', blood = '#b32b34';
      /* 双翼：外缘暗色 → 内翼亮色（读得出翼膜层次），翼展拉到近满幅 */
      x.fillStyle = wing;
      x.beginPath(); x.moveTo(20, 15);
      x.quadraticCurveTo(10, 6.5, 1.8, 11.5); x.quadraticCurveTo(5.4, 18, 2.6, 25);
      x.quadraticCurveTo(12, 24.4, 20, 19.6); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(20, 15);
      x.quadraticCurveTo(30, 6.5, 38.2, 11.5); x.quadraticCurveTo(34.6, 18, 37.4, 25);
      x.quadraticCurveTo(28, 24.4, 20, 19.6); x.closePath(); x.fill();
      x.fillStyle = wingHi;
      x.beginPath(); x.moveTo(20, 16.4);
      x.quadraticCurveTo(12.4, 10.4, 5.6, 13.6); x.quadraticCurveTo(8.6, 18, 6.6, 22.4);
      x.quadraticCurveTo(13.6, 22, 20, 18.6); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(20, 16.4);
      x.quadraticCurveTo(27.6, 10.4, 34.4, 13.6); x.quadraticCurveTo(31.4, 18, 33.4, 22.4);
      x.quadraticCurveTo(26.4, 22, 20, 18.6); x.closePath(); x.fill();
      /* 翼骨（把翼膜分区读出来） */
      x.strokeStyle = 'rgba(0,0,0,0.34)'; x.lineWidth = 0.55;
      [[7.4, 13.2, 4.6, 22.6], [32.6, 13.2, 35.4, 22.6]].forEach(function (b) {
        x.beginPath(); x.moveTo(b[0], b[1]); x.lineTo(b[2], b[3]); x.stroke();
      });
      /* 躯干与头 */
      x.fillStyle = body; ell(20, 21.6, 5.0, 5.4); ell(20, 14.6, 3.6, 3.2);
      /* 耳 */
      x.beginPath(); x.moveTo(17.4, 12.6); x.lineTo(16.0, 7.6); x.lineTo(19.4, 11.6); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(22.6, 12.6); x.lineTo(24.0, 7.6); x.lineTo(20.6, 11.6); x.closePath(); x.fill();
      /* 血色双目 */
      x.fillStyle = blood; ell(18.6, 14.4, 1.0, 1.0); ell(21.4, 14.4, 1.0, 1.0);
      return o.c;
    },

    xuemian: function () {
      var o = A.cv(40, 40), x = o.x;
      function ell(cx, cy, rx, ry) { x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 6.2832); x.fill(); }
      function poly(p, c) {
        x.fillStyle = c; x.beginPath(); x.moveTo(p[0][0], p[0][1]);
        for (var i = 1; i < p.length; i++) x.lineTo(p[i][0], p[i][1]);
        x.closePath(); x.fill();
      }
      A.shadowEllipse(x, 20, 36, 14, 4.8, 0.48);
      var robe = '#4a1f2a', robeHi = '#74303c', robeDark = '#281016', gold = '#c9a24a', blood = '#c02a33';
      /* 靴 */
      poly([[15.8, 29.4], [18.4, 29.4], [18.4, 34.8], [15.8, 34.8]], '#171016');
      poly([[21.6, 29.4], [24.2, 29.4], [24.2, 34.8], [21.6, 34.8]], '#120c11');
      /* 大氅（比杂兵更宽，压出「执事」气场）→ 袍身 → 垂袖 */
      poly([[12.4, 21.4], [27.6, 21.4], [30.6, 31.8], [9.4, 31.8]], robeDark);
      x.fillStyle = robe;
      x.beginPath(); x.moveTo(14.0, 15.2);
      x.quadraticCurveTo(20, 13.2, 26.0, 15.2);
      x.quadraticCurveTo(25.6, 19.4, 26.2, 23.4);
      x.quadraticCurveTo(20, 25.2, 13.8, 23.4);
      x.quadraticCurveTo(14.4, 19.4, 14.0, 15.2); x.closePath(); x.fill();
      poly([[12.6, 16.6], [15.6, 15.6], [16.2, 25.0], [12.2, 24.2]], robeHi);
      poly([[24.4, 15.6], [27.4, 16.6], [27.8, 24.2], [23.8, 25.0]], robeHi);
      /* 血色内衬 + 金色门襟 + 金色腰带 */
      x.fillStyle = blood; x.fillRect(19.2, 15.6, 1.6, 8.4);
      x.fillStyle = gold; x.fillRect(13.6, 20.4, 12.8, 1.5);
      /* 肩甲 + 金饰 */
      x.fillStyle = robeHi; ell(11.0, 16.6, 3.8, 3.0); ell(29.0, 16.6, 3.8, 3.0);
      x.fillStyle = gold; ell(11.0, 15.4, 2.1, 1.2); ell(29.0, 15.4, 2.1, 1.2);
      /* 头 + 血纹面具（暗底 → 白面具 → 三道血纹 → 眼缝）：辨识核心 */
      x.fillStyle = '#170c10'; ell(20, 8.4, 5.8, 5.6);
      x.fillStyle = '#d8d2c4'; ell(20, 9.2, 4.6, 4.2);
      x.fillStyle = blood;
      x.fillRect(16.0, 7.8, 8.0, 1.1);
      x.fillRect(17.4, 10.2, 5.2, 0.9);
      x.fillRect(18.8, 12.0, 2.4, 0.8);
      x.fillStyle = '#12060a'; x.fillRect(16.6, 6.4, 2.6, 1.0); x.fillRect(20.8, 6.4, 2.6, 1.0);
      return o.c;
    }
  };

  /* ---------- 导出 ---------- */
  /* 心魔立绘：取主角战斗立绘，压暗 + 罩一层暗紫，读作"另一个自己" */
  var _hd = null;
  function heartDemonSprite() {
    if (_hd) return _hd;
    var src = beastSprite('hero');
    var o = G.Art.cv(src.width, src.height);
    var x = o.x;
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = 'rgba(58,20,72,0.62)';
    x.fillRect(0, 0, src.width, src.height);
    x.fillStyle = 'rgba(120,26,34,0.30)';
    x.fillRect(0, src.height * 0.52, src.width, src.height * 0.48);
    x.globalCompositeOperation = 'source-over';
    _hd = o.c;
    return _hd;
  }

  var Sprites = {
    makeHero: makeHero,
    hero: null,
    /* 懒加载帧表：clear() 之后无需外部重建，渲染点直接取用即可 */
    heroFrames: function () {
      if (!this.hero) this.hero = makeHero();
      return this.hero;
    },
    npc: npcSprite,
    npcFrames: function (kind) {
      return [npcSprite(kind), npcSprite(kind), npcSprite(kind)];
    },
    beast: beastSprite,
    beastResolve: beastResolve,
    heroBattle: function () { return beastSprite('hero'); },
    heartDemon: heartDemonSprite,
    /* 已登记的程序化战斗立绘键（供契约断言"登记了且真的能产出位图"） */
    BAKE_KEYS: Object.keys(BAKE),
    HERO_PAL: HERO,
    /* 地图角色的逻辑占位尺寸：渲染点必须用它，改 MAP_SCALE 时不会漏改一边 */
    HERO_W: HERO_LW, HERO_H: HERO_LH, MAP_SCALE: MAP_SCALE,
    /* 超采样倍率变更后必须调用：清空全部精灵缓存并丢弃已建好的 hero 帧表，
       否则旧倍率的位图会被继续复用（放大后重新变糊）。 */
    clear: function () {
      heroCache = {}; npcCache = {}; beastCache = {}; _hd = null;
      this.hero = null;
    }
  };

  G.Sprites = Sprites;
  G.Art.heroSprite = heroSprite;
})();
