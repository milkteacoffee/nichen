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

  /* ===== 外观部件（v2.0.0 换装）=====
     这两个函数生成**配饰叠加层**的矩形（与 `heroParts` 同形，可直接接在它后面
     一起 `bake`）—— 所以配饰天然继承轮廓线 / 体积光 / 分档压缩，不需要单独一套管线。

     ⚠️ 坐标系是 `heroParts` 的**逻辑 16×24 画布**（不是 28×42）。常见落点：
        头顶发线 y≈1.0、颈部 y≈8.6、肩线 y≈9.4、脚底 y≈23.9。
     ⚠️ **不要在这里读 save**。参数只有 `(def, dir, step, bob)` ——
        本文件是渲染层，不该知道存档长什么样；调用方把 `def` 取好传进来。
     ⚠️ 一律用**轴对齐矩形**拼斜向形状，不要 `rotate`：
        旋转会引入小数坐标，降采样到像素格后边缘发毛（本版刚转像素风，尤其敏感）。 */

  /* 头饰：一件 = 一组矩形。`kind` 决定画法。 */
  function _headParts(def, dir, step, bob) {
    var P = [];
    if (!def || def.kind === 'none') return P;
    var c = def.c || '#e8e4d8', hi = def.hi || c;
    var back = dir === 'up';
    /* 所有头饰都挂在"发顶"上：正面发线 y=1.0，背面整头在 1.2 起。
       ⚠️ 必须带 bob（走路时的 0.35 上抬），否则帽子会"浮在头顶不跟着动"。 */
    var ty = (back ? 1.2 : 1.0) + bob;
    if (def.kind === 'guan') {
      /* 玉冠/金冠：一枚小方冠骑在发髻上，前面一道横梁压住发线 */
      P.push({ x: 6.2, y: ty - 2.0, w: 3.6, h: 2.4, c: c });
      P.push({ x: 6.2, y: ty - 2.0, w: 3.6, h: 0.8, c: hi });
      P.push({ x: 5.2, y: ty - 0.2, w: 5.6, h: 1.0, c: c });
      P.push({ x: 5.0, y: ty + 0.4, w: 0.8, h: 1.2, c: hi });      /* 左侧簪孔 */
      P.push({ x: 10.2, y: ty + 0.4, w: 0.8, h: 1.2, c: hi });     /* 右侧 */
    } else if (def.kind === 'dou') {
      /* 斗笠：宽檐 + 尖顶。**檐必须比头宽**（头是 3.2..12.8），否则读不出"笠" */
      P.push({ x: 1.4, y: ty - 0.4, w: 13.2, h: 1.6, c: c });      /* 檐 */
      P.push({ x: 1.4, y: ty - 0.4, w: 13.2, h: 0.5, c: hi });     /* 檐口高光 */
      P.push({ x: 5.0, y: ty - 2.6, w: 6.0, h: 2.4, c: c });       /* 穹顶 */
      P.push({ x: 5.0, y: ty - 2.6, w: 6.0, h: 0.8, c: hi });
      P.push({ x: 7.0, y: ty - 3.6, w: 2.0, h: 1.2, c: c });       /* 顶尖 */
    } else if (def.kind === 'zan') {
      /* 玉簪：横插过发髻，右侧露出一截 */
      P.push({ x: 4.6, y: ty + 0.6, w: 7.2, h: 0.7, c: c });
      P.push({ x: 4.6, y: ty + 0.6, w: 7.2, h: 0.3, c: hi });
      P.push({ x: 11.6, y: ty + 0.35, w: 0.9, h: 1.2, c: hi });    /* 簪头 */
    }
    return P;
  }

  /* 武器：背在身后（侧面最明显，正面只露一角 —— 这是像素 RPG 的常规取舍）。 */
  function _weaponParts(def, dir, step, bob) {
    var P = [];
    if (!def || def.kind === 'none') return P;
    var c = def.c || '#c9ccd4', hi = def.hi || c;
    var back = dir === 'up';
    var left = dir === 'left', right = dir === 'right';
    /* 侧面：武器整体偏向**身后那一侧**；正面：贴右肩后，尽量少抢视线。 */
    var ox = left ? -1.6 : right ? 1.6 : 0;
    var oy = bob;
    if (def.kind === 'sword' || def.kind === 'saber') {
      /* 斜背的刀剑：3 段矩形拼出"斜"的读感（两端各错开一点，连起来就读作斜线） */
      var w0 = def.kind === 'saber' ? 1.4 : 1.1;
      var x0 = back ? 10.2 : 10.4;
      P.push({ x: x0 + ox, y: 2.2 + oy, w: w0, h: 3.2, c: c });        /* 上段（肩外） */
      P.push({ x: x0 - 0.7 + ox, y: 5.2 + oy, w: w0, h: 3.2, c: c });  /* 中段 */
      P.push({ x: x0 - 1.4 + ox, y: 8.2 + oy, w: w0, h: 3.0, c: c });  /* 下段 */
      P.push({ x: x0 + ox, y: 2.2 + oy, w: w0, h: 1.0, c: hi });       /* 刃口高光 */
      P.push({ x: x0 - 0.5 + ox, y: 1.6 + oy, w: 2.1, h: 0.9, c: hi });/* 护手 */
      P.push({ x: x0 + 0.1 + ox, y: 0.4 + oy, w: 0.9, h: 1.3, c: '#5a4636' }); /* 柄 */
    } else if (def.kind === 'spear') {
      /* 长枪：比人还高，一根杆从脚后斜穿到头顶外 */
      P.push({ x: 11.0 + ox, y: -0.6 + oy, w: 1.0, h: 20.0, c: c });
      P.push({ x: 11.0 + ox, y: -0.6 + oy, w: 0.4, h: 20.0, c: hi });  /* 受光边 */
      P.push({ x: 10.5 + ox, y: -2.4 + oy, w: 2.0, h: 2.0, c: hi });   /* 枪尖 */
      P.push({ x: 10.6 + ox, y: -3.0 + oy, w: 1.8, h: 0.9, c: '#b84040' }); /* 红缨 */
    } else if (def.kind === 'fan') {
      /* 折扇：别在腰带右侧 */
      P.push({ x: 9.6 + ox, y: 14.2 + oy, w: 3.4, h: 2.6, c: c });
      P.push({ x: 9.6 + ox, y: 14.2 + oy, w: 3.4, h: 0.7, c: hi });
    } else if (def.kind === 'whisk') {
      /* 拂尘：柄挂在左侧，马尾垂下来 */
      P.push({ x: 1.0 + ox, y: 12.0 + oy, w: 0.9, h: 6.0, c: hi });    /* 柄 */
      P.push({ x: 0.4 + ox, y: 17.6 + oy, w: 2.1, h: 3.0, c: c });     /* 尾 */
      P.push({ x: 0.4 + ox, y: 17.6 + oy, w: 2.1, h: 0.8, c: hi });
    } else if (def.kind === 'flute') {
      /* 玉笛：横在腰后 */
      P.push({ x: 2.4 + ox, y: 14.6 + oy, w: 7.4, h: 0.8, c: c });
      P.push({ x: 2.4 + ox, y: 14.6 + oy, w: 7.4, h: 0.3, c: hi });
    }
    return P;
  }

  /* NOTE: 关于 `def.noBun` —— 斗笠/冠会盖住发髻，但 `heroParts` 里的发髻是**头部**
     的一部分（不受配饰控制）。这里**不做头部重绘**，理由：重绘头部 = 让配饰函数
     反过来改主体 → 两套逻辑互相依赖，是"部件化"最容易失控的地方。
     实测斗笠的檐（13.2 宽）已经比发髻（6.2..9.8）宽得多，视觉上完全盖住了，
     不需要真的删掉发髻。所以 `noBun` 只作为**语义标记**保留（面板可显示"覆盖发髻"），
     渲染层不消费它 —— 这是刻意的，不是漏接。 */

  /* v0.71.0：`bodyRatio` —— 童年/少年形象用。
     颈部以下（含领、袍、腰、臂、腿）整体纵向压缩，**头不压** → 头身比变大、更幼态；
     压缩后脚底会离画布底沿，再整体下移把脚钉回原脚底线，保证三档"站在同一地面"。
     默认 undefined → 完全不进入这段，十六岁形象与历史行为**逐像素一致**。

     v2.0.0 换装：第 5 参 `look` = `{ head, weapon, feet }`，各为**装扮定义对象**
     （`G.Data.appearance.byId` 的返回值）或 null。**不传 = 老行为逐像素不变**
     （这是零回归闸的物理保证：不传 look 时下面两个 push 循环一次都不跑）。 */
  function heroParts(dir, step, pal, bodyRatio, look) {
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

    /* ---- v2.0.0 换装：配饰叠加层 ----
       ① **接在"足"之后**（最后一个主体部件）→ 配饰在绘制序里压在最上层，
          这是对的：斗笠要能盖住头发、背剑要能跨过肩臂。
       ② **接在 `bodyRatio` 压缩之前** → 童年档的斗笠/背剑会跟着一起缩，
          与"帽子随头走、剑随人缩"的直觉一致（放在压缩之后就成"小孩戴大人帽子"）。
       ③ `look` 缺省/无该槽 → 对应函数立刻返回空数组，**零次 push**，
          所以默认外观的 P 数组与历史**逐元素相同**（零回归）。
       ④ 兜底用 `heroParts.__look` 那个模块级变量（见 `heroSprite` 的头注），
          这样"渲染点上忘了传 look"不会静默退化成光头空手。 */
    var _lk = look || heroParts.__look;
    if (_lk) {
      var _hp = _headParts(_lk.head, dir, step, bob);
      for (var hi2 = 0; hi2 < _hp.length; hi2++) P.push(_hp[hi2]);
      var _wp = _weaponParts(_lk.weapon, dir, step, bob);
      for (var wi = 0; wi < _wp.length; wi++) P.push(_wp[wi]);
    }

    /* 童年/少年（v0.71.0）：**以脚底为不动点**把颈部以下按 r 压缩，头部只随之下移
       而**不改尺寸** —— 头身比自然变大，读起来才像小孩（不是"缩小版大人"）。
       分界取颈顶（8.6）：映射在该点连续（左极限 = 右极限），且分界处没有跨越元素，
       脖子不会裂开。16 岁（未传 bodyRatio）整段跳过，行为与历史逐像素一致。 */
    if (bodyRatio && bodyRatio !== 1) {
      var NECK = 8.6, FOOT = 23.9;
      var r2 = Math.max(0.5, Math.min(1, bodyRatio));
      var headShift = (FOOT - (FOOT - NECK) * r2) - NECK;   /* 头整体下移量 = 身高缩掉的那截 */
      for (var q = 0; q < P.length; q++) {
        var pp = P[q];
        if (pp.y < NECK) { pp.y += headShift; }             /* 头：只平移，大小不变 → 更幼态 */
        else { pp.y = FOOT - (FOOT - pp.y) * r2; pp.h = Math.max(0.5, pp.h * r2); }
      }
    }

    return P;
  }

  /* ===== v2.0.0 外观兜底（改渲染签名时的**防静默**装置）=====
     `heroParts` / `heroAnim` 都新增了 `look` 参数。**渲染点上忘了传** →
     新特征（服饰换色 / 配饰）**完全不出现，且不报任何错** —— 这正是本项目
     历史上最贵的一类缺陷（"表现层缺失"型缺口：数值/资源都在，就是没人画）。

     所以在这里存一份模块级"当前外观"，由 UI 层在帧初登记（`setLook`）：
       · `heroParts(dir,step,pal,ratio,look)` 显式传了 → 用传进来的（可控、可测）
       · 没传 → 用 `heroParts.__look`（默认路径 = 已登记外观）
     契约 `appearance.contract` 会断言"登记后，不传 look 也能画出配饰"。
     ⚠️ 只影响**程序化**路径；素材路径由调用方决定（素材不带部件信息）。 */
  function setLook(lk) { heroParts.__look = lk || null; }
  function currentLook() { return heroParts.__look || null; }
  /* 从存档取"当前外观"四槽定义 —— **唯一入口**。
     overlays / explore / 演出 都调它，不许各自 memberwise 拼一遍。 */
  function lookOf(save) {
    var A = G.Data && G.Data.appearance;
    if (!A) return null;
    return {
      robe: A.worn(save, 'robe'), head: A.worn(save, 'head'),
      weapon: A.worn(save, 'weapon'), feet: A.worn(save, 'feet')
    };
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
  /* v2.0.0：第 4 参 `look`。省略（undefined）时**读帧初登记的外观**（见 `setLook`），
     显式传 `null` 则强制"无配饰"（契约用它做零回归反例）。 */
  function heroSprite(dir, step, pal, look) {
    pal = pal || HERO;
    var lk = look === undefined ? currentLook() : look;
    /* ⚠️ 缓存键必须带 `lkTag` —— 不带就会"换了衣服但地图上角色不变"（命中旧缓存），
       而且**完全静默**（不报错、契约也绿）。见 `appearanceData.keyOf` 的头注。 */
    var lkTag = lkTagOf(lk);
    /* ⚠️ 键里必须带 **K** —— 像素块边长 = PIXEL × K，K 变（窗口缩放/画质自适应）
       块的大小就变，不带 K 会复用旧倍率的块（表现：改画质后块大小不对，且静默）。 */
    var key = 'hero|' + dir + '|' + step + '|' + pal.robe + '|' + lkTag + '|' + (A.K || 1);
    if (heroCache[key]) return heroCache[key];
    /* 素材层优先：manifest 里登记 char.hero.<dir>.<step> 就整张替换（建议出图 168×252）。
       ⚠️ v2.0.0：素材是**成品图**（衣服已画死），换不了颜色。所以：
         · 默认外观（含没穿任何装扮）→ 走素材
         · 穿了非默认外观 → **强制走程序化**，由 `pal` + `look` 现画
       不做这个分流的话，表现就是"面板里换了衣服、地图上纹丝不动" ——
       正是本版要消灭的那类**静默不一致**。

       ⚠️ **两条路都要像素化**（v2.0.0 的关键取舍，用户口径「转成像素风格，
          但现在的素材不要丢弃，可以作为对话或者动画的原图」）：
          · 地图上的角色 = 世界的一部分 → 必须与像素地面同族，**素材也降格**
          · 素材原图**没有被丢弃** —— 它仍走同一条降格管线，只是多了一趟像素化；
            而"对话立绘"用的是 `art.js: A.portrait`（另一条路，见那里的换装分支），
            那里**保持高清**，正是用户说的"作为对话或者动画的原图"。
          ⚠️ 第一版只降了程序化路径 → 默认外观（素材）是高清、换了衣服变像素格，
            同一屏里两种画风来回跳，比全高清更糟。 */
    var _defLook = _lookIsDefault(lk);
    var im = _defLook && G.Assets && G.Assets.img
      ? G.Assets.img('char.hero.' + dir + '.' + step) : null;
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
      c = bake(heroParts(dir, step, pal, null, lk), 16, 24, null, { scale: MAP_SCALE });
      if (dir === 'right') c = mirror(c);
    }
    /* 像素化（v2.0.0）：**两条路都降格**（含素材路，理由见上注）。
       `A.pixelate` 是"两趟同尺寸"做法（点采样降到 1/PIXEL → 最近邻升回原尺寸），
       所以 `c.width/height` 不变，渲染点按 HERO_W×HERO_H 画的逻辑尺寸也不用改。 */
    if (G.Art && G.Art.pixelate && G.pixelOn && G.pixelOn()) c = G.Art.pixelate(c, G.PIXEL);
    heroCache[key] = c;
    return c;
  }

  /* 外观缓存键片段：把四槽压成短串。
     ⚠️ 这里的 tag 与 `G.Data.appearance.keyOf(save)` **不是一回事** ——
        那个吃 save，这个吃**已解析的 look 对象**。两者必须同形，
        否则"面板算出来的键"与"渲染算出来的键"会不一致（→ 缓存该失效的不失效）。
        契约 `appearance.contract` 会断言：`keyOf(save)` 与 `lkTagOf(lookOf(save))` 相等。 */
  function lkTagOf(lk) {
    if (!lk) return '-';
    /* 凡**影响像素**的字段都要进键：id + kind + 颜色。
       只放 id 的话，"两个 id 不同但颜色相同的件"会各烘一份（浪费但不错），
       而"同一 id 改了颜色"会**拿着旧图不放**（错）。取 id+kind+c 兼顾两头。 */
    return ['robe', 'head', 'weapon', 'feet'].map(function (s) {
      var e = lk[s];
      return e ? (e.id || '?') + (e.kind ? ':' + e.kind : '') + (e.c ? ':' + e.c : '') : '-';
    }).join(',');
  }
  /* 当前 look 是否"等同默认外观"（决定能不能走素材路径）。
     判据：四槽都等于 `G.Data.appearance.DEFAULT` 里的 id，或该槽为空/默认。 */
  function _lookIsDefault(lk) {
    var D = G.Data && G.Data.appearance && G.Data.appearance.DEFAULT;
    if (!D) return true;                       /* 数据层没加载（老快照）→ 当默认，保零回归 */
    if (!lk) return true;
    var S4 = ['robe', 'head', 'weapon', 'feet'];
    for (var i = 0; i < S4.length; i++) {
      var e = lk[S4[i]];
      var id = e && e.id;
      if (id && id !== D[S4[i]]) return false;
    }
    return true;
  }

  function makeHero(pal) {
    var out = {};
    ['down', 'left', 'right', 'up'].forEach(function (d) {
      out[d] = [heroSprite(d, 0, pal), heroSprite(d, 1, pal), heroSprite(d, 2, pal)];
    });
    return out;
  }

  /* ===== 童年/少年形象（v0.71.0 程序化；v0.90.0 改为**素材优先**）=====
     入世演出用：6 岁 / 10 岁 / 16 岁三拍，脚底钉在同一基线上"往上长"。

     v0.90.0 改动（用户截图反馈：「6、10、16 岁都没有渲染真正的图片」）：
     原实现**刻意不读素材**（当时素材只有十六岁一档，读素材三档全一个样），
     结果演出里是一个程序化色块小人。现改为：
       ① `char.hero.age6` / `char.hero.age10` 两档真实立绘（与 `char.hero.down`
          同一画风、同一几何：**画布 84×126、脚底 y=125、内容高 87/105/125**）；
       ② 16 岁**直接用** `char.hero.down`（它本来就是成年立绘）；
       ③ 素材缺失时**仍然回退**到原程序化 `heroParts(..., bodyRatio)` ——
          与地图兜底同一套画法，保证任何情况下都画得出。

     ⚠️ 几何必须严格一致：脚底不动点 + 内容高随龄增长是"长高"观感的唯一来源。
        素材是**按 364×546 / 脚底对齐 / 内容高比例 0.690·0.833·0.992 预合成**的。

     ⚠️ v0.90.1 **高密度烘焙**（修"太模糊"）：
        入世演出把立绘画到 `逻辑28×42 × GROW_SCALE2.6 × S`，
        S（Art.K 上限 5）时 = **364×546 物理像素**。
        而本函数原先烘焙进 84×126 的画布 → 演出放大 **4.33 倍** → 必糊。
        现改为按 `AGE_STAGE_BAKE_SCALE`（= S 上限 × GROW_SCALE）烘焙：
          · 本函数**只被入世演出使用**（reincarnation.js），不在高速地图路径上，
            一次烘焙长期复用，性能无影响；
          · 缓存键不含倍率 —— 倍率变了由 `G.Sprites.clear()` 统一清（与其它精灵一致）。 */
  var AGE_STAGE_R = { 6: 0.52, 10: 0.74, 16: 1 };
  /* 各档素材键（16 岁复用成年正面立绘）。 */
  var AGE_STAGE_KEY = { 6: 'char.hero.age6', 10: 'char.hero.age10', 16: 'char.hero.age16' };
  /* 逻辑画布 = 16×24 × MAP_SCALE = 28×42 */
  var AGE_STAGE_W = 16 * MAP_SCALE, AGE_STAGE_H = 24 * MAP_SCALE;
  /* 素材像素（13 倍密度，见 _gen/_hero_age_stage.py）。
     ⚠️ 16 岁档用 char.hero.down（168×252），比例与之**不同**（它按 168×252 设计）——
        所以每档各存自己的源尺寸，不能共用一个常量。 */
  var AGE_STAGE_SRC = {
    6: { w: 364, h: 546 },
    10: { w: 364, h: 546 },
    16: { w: 364, h: 546 }
  };
  /* 烘焙密度：覆盖"演出的最大绘制尺寸"。
     = 逻辑 28 × GROW_SCALE(2.6) × S上限(5) / MAP_SCALE(1.75) ≈ 13 倍逻辑。
     取整 13：烘焙画布 = 28×13 × 42×13 = 364×546，正好 1:1。 */
  var AGE_STAGE_BAKE_SCALE = 13;
  var childCache = {};
  /* 该档有没有可用素材（供契约与调试查） */
  function ageStageHasAsset(age) {
    var k = AGE_STAGE_KEY[age];
    return !!(k && G.Assets && G.Assets.img && G.Assets.img(k));
  }
  /* v2.0.0：第 4 参 `look` = 当前外观定义（见 `lookOf`）。
     ⚠️ **素材命中时不消费 look**（`char.hero.age*` 是成品立绘，里面已经画死了衣服）。
        这是刻意的：入世演出是"出生"那一刻，本来就不该穿着后来换的衣服。
        素材缺 / 非正面方向 → 走程序化，那时 look 才生效。 */
  function heroAgeStage(age, dir, step, look) {
    dir = dir || 'down'; step = step || 0;
    var lk = look === undefined ? currentLook() : look;
    /* ⚠️ 缓存键必须带**真实外观签名**（`lkTagOf(lk)`）。
       初版这里写的是 `keyOf(null)` —— 恒等于"默认外观"，于是换了衣服之后
       入世演出的 6/10/16 岁形象**永远停在旧外观**，且完全静默。
       （素材路径不消费外观，所以签名只影响程序化兜底那几档 —— 但缓存是共用的，
         必须一起带签名，否则"先播过默认档"会把非默认档也钉住。） */
    var key = age + '|' + dir + '|' + step + '|' + lkTagOf(lk);
    if (childCache[key]) return childCache[key];
    var c = null;
    /* ① 素材优先：立绘只有**正面**一版，所以只对 'down' 生效；
          其它方向仍走程序化（侧/背面立绘本项目没有，硬转会让方向错乱）。 */
    if (dir === 'down' && ageStageHasAsset(age)) {
      var im = G.Assets.img(AGE_STAGE_KEY[age]);
      /* 高密度画布：A.cv 返回的 ctx 在**逻辑坐标**（内部已 scale K），
         但这里要的是"物理像素足够大"，所以直接传放大后的逻辑尺寸即可：
         A.cv(W*s, H*s) 的实际像素 = W*s*K，K 已是 S。 */
      var o = A.cv(AGE_STAGE_W * AGE_STAGE_BAKE_SCALE / MAP_SCALE,
        AGE_STAGE_H * AGE_STAGE_BAKE_SCALE / MAP_SCALE);
      if (o && o.x && im && o.c) {
        var src = AGE_STAGE_SRC[age] || AGE_STAGE_SRC[6];
        /* ctx 在逻辑坐标系 → 目标宽高写**该坐标系下的值**：
           烘焙画布的逻辑尺寸就是这个 cv 的 W/H。按高度取比例、底部居中。 */
        var LW = AGE_STAGE_W * AGE_STAGE_BAKE_SCALE / MAP_SCALE;
        var LH = AGE_STAGE_H * AGE_STAGE_BAKE_SCALE / MAP_SCALE;
        var k2 = LH / src.h;
        var dw = src.w * k2, dh = LH;
        o.x.drawImage(im, (LW - dw) / 2, 0, dw, dh);
        c = o.c;
      }
    }
    /* ② 程序化兜底（素材缺 / 非正面方向）：保持 v0.71.0 的原始行为不变
          （`lk` 为 null / 未登记时 `heroParts` 一次配饰都不 push → 逐像素同历史） */
    if (!c) {
      var r = AGE_STAGE_R[age];
      if (r == null) r = 1;
      c = bake(heroParts(dir, step, HERO, r, lk), 16, 24, null, { scale: MAP_SCALE });
      if (dir === 'right') c = mirror(c);
    }
    childCache[key] = c;
    return c;
  }

  /* ---------- NPC ---------- */
  function childParts(pal) {
    /* 幼童：头大、身短、腿短（16×24 画布内，整体比成人矮一截）。 */
    var P = [];
    function add(x, y, w, h, c, extra) {
      var o = { x: x, y: y, w: w, h: h, c: c };
      if (extra) for (var k in extra) o[k] = extra[k];
      P.push(o);
    }
    /* 头（偏大） */
    add(3.6, 3.0, 8.8, 7.0, pal.skin);
    add(2.8, 1.6, 10.4, 3.2, pal.hair);
    add(2.8, 3.6, 1.8, 3.6, pal.hair);
    add(11.4, 3.6, 1.8, 3.6, pal.hair);
    add(3.6, 8.2, 8.8, 1.6, pal.skinSh);
    add(5.8, 6.0, 1.3, 1.4, '#201d28');
    add(9.0, 6.0, 1.3, 1.4, '#201d28');
    add(5.5, 5.2, 1.8, 0.6, pal.hair);
    add(8.7, 5.2, 1.8, 0.6, pal.hair);
    /* 身（短褐） */
    add(6.8, 9.6, 2.4, 1.2, pal.skinSh);
    add(4.8, 10.4, 6.4, 1.7, pal.collar);
    add(3.6, 11.2, 8.8, 5.0, pal.robe);
    add(4.0, 11.2, 1.1, 4.8, A.shade(pal.robe, 0.14));
    add(10.9, 11.2, 1.4, 4.8, pal.robeDark);
    add(3.6, 14.8, 8.8, 1.6, pal.belt);
    add(3.6, 14.8, 8.8, 0.5, A.shade(pal.belt, 0.22));
    /* 短腿 */
    add(4.2, 16.4, 3.2, 2.6, pal.robeDark);
    add(8.6, 16.4, 3.2, 2.6, pal.robe);
    add(4.0, 18.8, 3.4, 1.8, pal.shoe);
    add(8.6, 18.8, 3.4, 1.8, pal.shoe);
    /* 小手 */
    add(2.6, 11.8, 1.7, 4.2, pal.robe);
    add(2.6, 15.6, 1.5, 1.5, pal.skin);
    add(11.7, 11.8, 1.7, 4.2, pal.robeDark);
    add(11.9, 15.6, 1.5, 1.5, pal.skin);
    return P;
  }

  function npcParts(kind, pal) {
    if (kind === 'child') return childParts(pal);
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
    var girl = kind === 'girl';
    var pal = {
      hair: kind === 'elder' ? '#cfccc0' : (cult ? '#231d24' : (girl ? '#3a2a30' : '#2b2833')),
      skin: '#e8b890',
      /* 主色与暗部**必须拉开明度**：只差一点点的话，程序化立绘会糊成一块红方块
         （第一版 6d3038 / 4a1f27 就是这样，远看像邮筒）。 */
      robe: kind === 'elder' ? '#6b7a68' : kind === 'keeper' ? '#7a6a52'
        : (cult ? '#7a343d' : (girl ? '#a86a8a' : '#8a8a92')),
      robeDark: kind === 'elder' ? '#4c5949' : kind === 'keeper' ? '#5a4d3a'
        : (cult ? '#3d171c' : (girl ? '#7d4a64' : '#66666e')),
      collar: cult ? '#c9a2a6' : (girl ? '#f0d8d0' : '#e6ddc2'),
      belt: girl ? '#8a5a72' : '#5a4632', shoe: '#2c2a30'
    };
    if (kind === 'child') {
      pal.hair = '#332a22';
      pal.robe = '#5f8f6d'; pal.robeDark = '#426b50';
      pal.collar = '#e9e2c6'; pal.belt = '#6a5a3a';
    }
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
  /* 战斗主角（v0.54.0）：把新写实待机帧烘进战斗盒，与地图/NPC 同一形象；缺帧回退旧立绘。
     v0.60.0 起待机两帧**循环播放**（呼吸/衣摆微动），不再是钉死的单帧纸片。 */
  var _hbat = null, _hbatFrames = null;
  function _bakeBattleFrame(fr) {
    var o = A.cv(BEAST_LW, BEAST_LH);
    o.x.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in o.x) o.x.imageSmoothingQuality = 'high';
    var h = BEAST_LH, w = ANIM_W * (h / ANIM_H);
    o.x.drawImage(fr, (BEAST_LW - w) / 2, 0, w, h);
    return o.c;
  }
  function heroBattleFrames() {
    if (_hbatFrames) return _hbatFrames;
    var fr = heroAnim('down', 'idle');
    if (!fr) { _hbatFrames = [beastSprite('hero')]; return _hbatFrames; }
    _hbatFrames = [];
    for (var i = 0; i < fr.length; i++) _hbatFrames.push(_bakeBattleFrame(fr[i]));
    return _hbatFrames;
  }
  function heroBattleSprite() {
    if (_hbat) return _hbat;
    _hbat = heroBattleFrames()[0];
    return _hbat;
  }

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

/* __BOSSGEN_INJECTED__ */
/* ===== v0.77.0 第二批：元素 Boss 程序化立绘生成器 =====
   设计：元素定调色板、角色定轮廓。24 个新 Boss 各产出真实位图，
   由 dungeon.boss.assets 契约钉死"禁止静默退回通用 snake"。
   本片段运行于 sprites.js 的 IIFE 内，可直接使用 G.Art（A）。 */
function bossPal(elem) {
  var P = {
    ice:     { base: '#7fc8e8', hi: '#e4f7ff', dark: '#2c6c92', glow: '#bfeeff' },
    thunder: { base: '#e6c448', hi: '#fff0a0', dark: '#785c14', glow: '#ffe684' },
    fire:    { base: '#e65e2c', hi: '#ffc074', dark: '#862810', glow: '#ff9848' },
    dark:    { base: '#7c4c8c', hi: '#b88ccc', dark: '#2e1638', glow: '#aa6ccc' },
    void:    { base: '#8a6ad6', hi: '#c6b2ff', dark: '#22184a', glow: '#b69cff' },
    earth:   { base: '#bc9e5c', hi: '#e2ca98', dark: '#68502a', glow: '#dac28c' },
    wood:    { base: '#6ca850', hi: '#acda92', dark: '#31602a', glow: '#98da7a' },
    light:   { base: '#e8d68a', hi: '#fff8d4', dark: '#8a7438', glow: '#fff0b4' },
    blood:   { base: '#aa3a4a', hi: '#e28292', dark: '#4a1420', glow: '#da5262' },
    wind:    { base: '#8ac8c2', hi: '#caf2ec', dark: '#38726a', glow: '#b2e8e2' }
  };
  return P[elem] || P.dark;
}

/* 通用部件：翼 / 角 / 光环 / 冠 */
function bossWings(x, p, spread) {
  var s = spread || 1;
  x.fillStyle = p.dark;
  x.beginPath(); x.moveTo(18, 18);
  x.quadraticCurveTo(8 - 2 * s, 8, 3 - 3 * s, 13); x.quadraticCurveTo(7, 18, 6, 24);
  x.quadraticCurveTo(13, 22, 18, 21); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(22, 18);
  x.quadraticCurveTo(32 + 2 * s, 8, 37 + 3 * s, 13); x.quadraticCurveTo(33, 18, 34, 24);
  x.quadraticCurveTo(27, 22, 22, 21); x.closePath(); x.fill();
  x.fillStyle = A.alpha(p.base, 0.7);
  x.beginPath(); x.moveTo(18, 19);
  x.quadraticCurveTo(11, 12, 6, 14.5); x.quadraticCurveTo(10, 19, 9, 22.5);
  x.quadraticCurveTo(14, 21, 18, 20.5); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(22, 19);
  x.quadraticCurveTo(29, 12, 34, 14.5); x.quadraticCurveTo(30, 19, 31, 22.5);
  x.quadraticCurveTo(26, 21, 22, 20.5); x.closePath(); x.fill();
}
function bossHorns(x, p, big) {
  var c = big ? p.glow : p.hi;
  x.strokeStyle = p.dark; x.lineWidth = big ? 3.4 : 2.6; x.lineCap = 'round';
  x.beginPath(); x.moveTo(14, 8); x.quadraticCurveTo(11, 3, 8, 2); x.stroke();
  x.beginPath(); x.moveTo(26, 8); x.quadraticCurveTo(29, 3, 32, 2); x.stroke();
  x.strokeStyle = c; x.lineWidth = big ? 1.5 : 1.1;
  x.beginPath(); x.moveTo(14, 7.6); x.quadraticCurveTo(11.4, 3.6, 9, 2.6); x.stroke();
  x.beginPath(); x.moveTo(26, 7.6); x.quadraticCurveTo(28.6, 3.6, 31, 2.6); x.stroke();
}
function bossHalo(x, p) {
  x.strokeStyle = A.alpha(p.glow, 0.9); x.lineWidth = 1.6;
  x.beginPath(); x.ellipse(20, 6.4, 6.4, 2.2, 0, 0, 6.2832); x.stroke();
  x.strokeStyle = A.alpha(p.hi, 0.7); x.lineWidth = 0.7;
  x.beginPath(); x.ellipse(20, 6.2, 6.4, 2.2, 0, 0, 6.2832); x.stroke();
}
function bossCrown(x, p) {
  x.fillStyle = p.dark;
  x.beginPath(); x.moveTo(13, 7); x.lineTo(14, 2.4); x.lineTo(17, 5.4);
  x.lineTo(20, 1.8); x.lineTo(23, 5.4); x.lineTo(26, 2.4); x.lineTo(27, 7);
  x.closePath(); x.fill();
  x.fillStyle = p.glow;
  x.beginPath(); x.moveTo(14, 6.4); x.lineTo(14.8, 3.6); x.lineTo(17, 5.6);
  x.lineTo(20, 3); x.lineTo(23, 5.6); x.lineTo(25.2, 3.6); x.lineTo(26, 6.4);
  x.closePath(); x.fill();
}

/* ---------- 人形（甲胄战士 / 神 / 祭司）---------- */
function bossHumanoid(C) {
  var x = C.x, p = C.p, f = C.f;
  if (f.wings) bossWings(x, p, f.big ? 1.2 : 1);
  if (f.cape) {
    x.fillStyle = A.alpha(p.dark, 0.92);
    x.beginPath(); x.moveTo(13, 15); x.quadraticCurveTo(9, 26, 10, 35);
    x.lineTo(30, 35); x.quadraticCurveTo(31, 26, 27, 15); x.closePath(); x.fill();
  }
  /* 腿 / 靴 */
  x.fillStyle = p.dark;
  x.fillRect(15, 25, 4, 9); x.fillRect(21, 25, 4, 9);
  x.fillStyle = A.shade(p.dark, -0.1);
  x.fillRect(14.4, 32.6, 5.2, 2.6); x.fillRect(20.4, 32.6, 5.2, 2.6);
  /* 躯干甲 */
  x.fillStyle = p.base;
  x.beginPath(); x.moveTo(13.4, 15); x.lineTo(26.6, 15); x.lineTo(27.4, 26);
  x.lineTo(12.6, 26); x.closePath(); x.fill();
  x.fillStyle = A.alpha(p.hi, 0.8);
  x.beginPath(); x.moveTo(15, 16); x.lineTo(20, 16); x.lineTo(19, 25); x.lineTo(14, 25); x.closePath(); x.fill();
  x.fillStyle = p.dark; x.fillRect(12.8, 24.4, 14.4, 2.2);
  /* 肩甲 */
  x.fillStyle = p.dark;
  A.blob(x, 12.4, 15.6, 3.1, 0.85); A.blob(x, 27.6, 15.6, 3.1, 0.85);
  x.fillStyle = p.hi;
  A.blob(x, 11.9, 14.9, 1.7, 0.8); A.blob(x, 27.1, 14.9, 1.7, 0.8);
  /* 臂 */
  x.fillStyle = A.shade(p.base, -0.08);
  x.fillRect(10.6, 17, 3, 8); x.fillRect(26.4, 17, 3, 8);
  /* 头 + 盔 */
  x.fillStyle = '#e0b48c'; A.blob(x, 20, 10.6, 4.2, 1.15);
  x.fillStyle = p.dark;
  x.beginPath(); x.moveTo(15.4, 9.4); x.quadraticCurveTo(20, 3.6, 24.6, 9.4);
  x.lineTo(24.2, 7); x.lineTo(15.8, 7); x.closePath(); x.fill();
  x.fillStyle = p.hi; x.fillRect(19.3, 4.4, 1.4, 3);
  x.fillStyle = p.glow;
  A.blob(x, 18.4, 11, 0.8, 1); A.blob(x, 21.6, 11, 0.8, 1);
  x.fillStyle = p.dark; A.blob(x, 18.4, 11.2, 0.4, 1); A.blob(x, 21.6, 11.2, 0.4, 1);
  if (f.horns) bossHorns(x, p, f.big);
  if (f.crown) bossCrown(x, p);
  if (f.halo) bossHalo(x, p);
  bossWeapon(C);
}
function bossWeapon(C) {
  var x = C.x, p = C.p, w = C.f.weapon;
  if (w === 'sword' || w === 'blade') {
    x.strokeStyle = '#dfe8f2'; x.lineWidth = w === 'blade' ? 2 : 2.4; x.lineCap = 'round';
    x.beginPath(); x.moveTo(31, 30); x.lineTo(w === 'blade' ? 36 : 34, 8); x.stroke();
    x.strokeStyle = p.dark; x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(29.6, 28.6); x.lineTo(32.4, 31); x.stroke();
  } else if (w === 'spear' || w === 'halberd') {
    x.strokeStyle = '#caa06a'; x.lineWidth = 1.8;
    x.beginPath(); x.moveTo(32, 33); x.lineTo(32, 5); x.stroke();
    x.fillStyle = '#dfe8f2';
    x.beginPath(); x.moveTo(32, 5); x.lineTo(w === 'halberd' ? 37 : 34, 9); x.lineTo(32, 10); x.closePath(); x.fill();
  } else if (w === 'hammer') {
    x.strokeStyle = '#caa06a'; x.lineWidth = 1.8;
    x.beginPath(); x.moveTo(31, 31); x.lineTo(35, 9); x.stroke();
    x.fillStyle = p.glow; x.fillRect(31.4, 6, 7, 5);
  } else if (w === 'staff') {
    x.strokeStyle = '#8a6438'; x.lineWidth = 1.8;
    x.beginPath(); x.moveTo(30, 32); x.lineTo(33, 7); x.stroke();
    x.fillStyle = A.alpha(p.glow, 0.95); A.blob(x, 33.2, 6.4, 2.4, 1);
    x.fillStyle = A.alpha(p.hi, 0.8); A.blob(x, 32.8, 6, 1.1, 1);
  } else if (w === 'dagger') {
    x.strokeStyle = '#dfe8f2'; x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(29, 26); x.lineTo(31, 16); x.stroke();
  }
}

/* ---------- 巨兽（泰坦，四足）---------- */
function bossBeast(C) {
  var x = C.x, p = C.p, f = C.f;
  x.strokeStyle = p.dark; x.lineWidth = 4.6; x.lineCap = 'round';
  [[12, 24], [17, 25], [25, 25], [30, 24]].forEach(function (q) {
    x.beginPath(); x.moveTo(q[0], q[1]); x.lineTo(q[0] - 0.6, 34); x.stroke();
  });
  x.fillStyle = p.dark;
  [[10.8, 34.6], [15.8, 35], [24, 35], [28.8, 34.6]].forEach(function (q) {
    A.blob(x, q[0], q[1], 2.4, 0.6);
  });
  x.fillStyle = p.base; A.blob(x, 21, 23, 12.5, 0.62);
  x.fillStyle = p.hi; A.blob(x, 17, 19.5, 7, 0.5);
  x.fillStyle = A.alpha(p.dark, 0.5); A.blob(x, 22, 28, 10, 0.4);
  /* 头（朝前，双角）*/
  x.fillStyle = p.base; A.blob(x, 10, 19, 7, 0.9);
  x.fillStyle = p.dark;
  x.beginPath(); x.moveTo(6, 14); x.lineTo(3, 7); x.lineTo(9, 12.5); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(12, 13); x.lineTo(14, 6); x.lineTo(14, 12.5); x.closePath(); x.fill();
  x.fillStyle = p.glow; A.blob(x, 8, 18, 1.5, 1); A.blob(x, 11.5, 18, 1.5, 1);
  x.fillStyle = p.dark; A.blob(x, 8, 18.3, 0.7, 1); A.blob(x, 11.5, 18.3, 0.7, 1);
  x.fillStyle = A.alpha(p.hi, 0.8); A.blob(x, 6.4, 22, 2.4, 0.6);
  if (f.plates) {
    x.fillStyle = p.glow;
    for (var i = 0; i < 4; i++) A.blob(x, 15 + i * 3, 16.6 - i * 0.4, 2, 1.3);
  }
}

/* ---------- 龙（长身 + 翼）---------- */
function bossDragon(C) {
  var x = C.x, p = C.p;
  bossWings(x, p, 1.1);
  x.strokeStyle = p.dark; x.lineWidth = 7.5; x.lineCap = 'round';
  x.beginPath(); x.moveTo(8, 32); x.quadraticCurveTo(20, 24, 30, 31); x.stroke();
  x.strokeStyle = p.base; x.lineWidth = 5.6;
  x.beginPath(); x.moveTo(8, 32); x.quadraticCurveTo(20, 24, 30, 31); x.stroke();
  x.strokeStyle = p.dark; x.lineWidth = 7;
  x.beginPath(); x.moveTo(12, 29); x.quadraticCurveTo(10, 16, 17, 10); x.stroke();
  x.strokeStyle = p.base; x.lineWidth = 5;
  x.beginPath(); x.moveTo(12, 29); x.quadraticCurveTo(10, 16, 17, 10); x.stroke();
  /* 背棘 */
  x.fillStyle = p.glow;
  [[10, 26], [13, 20], [17, 14]].forEach(function (q) {
    x.beginPath(); x.moveTo(q[0] - 1.4, q[1] + 1.6); x.lineTo(q[0], q[1] - 3);
    x.lineTo(q[0] + 1.4, q[1] + 1.6); x.closePath(); x.fill();
  });
  /* 头 + 角 + 须 */
  x.fillStyle = p.base; A.blob(x, 17, 9, 6, 0.78);
  x.fillStyle = p.dark;
  x.beginPath(); x.moveTo(14, 6); x.lineTo(11, 1); x.lineTo(16, 5); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(19, 5.4); x.lineTo(22, 1); x.lineTo(20, 6); x.closePath(); x.fill();
  x.strokeStyle = A.alpha(p.glow, 0.8); x.lineWidth = 0.8;
  x.beginPath(); x.moveTo(13, 10); x.quadraticCurveTo(8, 12, 7, 16); x.stroke();
  x.fillStyle = p.glow; A.blob(x, 14, 8.4, 1.4, 1); A.blob(x, 18.4, 8, 1.4, 1);
  x.fillStyle = p.dark; A.blob(x, 14, 8.6, 0.7, 1); A.blob(x, 18.4, 8.2, 0.7, 1);
}

/* ---------- 魔物（双足恶魔，长臂弯角）---------- */
function bossMonster(C) {
  var x = C.x, p = C.p, f = C.f;
  if (f.wings) bossWings(x, p, f.big ? 1.3 : 1);
  /* 腿（屈膝）*/
  x.strokeStyle = p.dark; x.lineWidth = 4.2; x.lineCap = 'round';
  x.beginPath(); x.moveTo(16, 25); x.lineTo(14, 31); x.lineTo(11, 34); x.stroke();
  x.beginPath(); x.moveTo(24, 25); x.lineTo(26, 31); x.lineTo(29, 34); x.stroke();
  x.fillStyle = p.glow;
  x.beginPath(); x.moveTo(9, 34); x.lineTo(13, 33); x.lineTo(12, 35.4); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(31, 34); x.lineTo(27, 33); x.lineTo(28, 35.4); x.closePath(); x.fill();
  /* 躯干（魁梧）*/
  x.fillStyle = p.base; A.blob(x, 20, 21, 10.5, 1.05);
  x.fillStyle = p.hi; A.blob(x, 16.6, 17.5, 5.5, 0.8);
  x.fillStyle = A.alpha(p.dark, 0.55); A.blob(x, 21, 25, 8, 0.6);
  /* 长臂 + 爪 */
  x.strokeStyle = A.shade(p.base, -0.08); x.lineWidth = 3.4; x.lineCap = 'round';
  x.beginPath(); x.moveTo(12, 18); x.quadraticCurveTo(7, 23, 8, 28); x.stroke();
  x.beginPath(); x.moveTo(28, 18); x.quadraticCurveTo(33, 23, 32, 28); x.stroke();
  x.fillStyle = p.glow;
  A.blob(x, 8, 28.6, 2, 0.7); A.blob(x, 32, 28.6, 2, 0.7);
  /* 头 + 大角 */
  x.fillStyle = p.base; A.blob(x, 20, 11, 5.4, 0.95);
  bossHorns(x, p, true);
  x.fillStyle = p.glow; A.blob(x, 18, 11, 1.6, 1); A.blob(x, 22, 11, 1.6, 1);
  x.fillStyle = p.dark; A.blob(x, 18, 11.3, 0.8, 1); A.blob(x, 22, 11.3, 0.8, 1);
  /* 獠牙 */
  x.fillStyle = '#f4ecd8';
  x.fillRect(17.6, 13.4, 1, 2); x.fillRect(21.4, 13.4, 1, 2);
  if (f.crown) bossCrown(x, p);
  if (f.tendrils) {
    x.strokeStyle = A.alpha(p.glow, 0.7); x.lineWidth = 1.2;
    for (var i = 0; i < 3; i++) {
      x.beginPath(); x.moveTo(14 + i * 6, 17);
      x.quadraticCurveTo(10 + i * 7, 12, 9 + i * 8, 7); x.stroke();
    }
  }
}

/* ---------- 蟾蜍 ---------- */
function bossToad(C) {
  var x = C.x, p = C.p;
  x.fillStyle = p.dark; A.blob(x, 20, 28, 15, 0.62);
  x.fillStyle = p.base; A.blob(x, 20, 26, 14, 0.6);
  x.fillStyle = p.hi; A.blob(x, 16, 22, 8, 0.5);
  /* 疣 */
  x.fillStyle = A.alpha(p.glow, 0.6);
  [[14, 25], [22, 23], [26, 27], [17, 29]].forEach(function (q) { A.blob(x, q[0], q[1], 1.5, 1); });
  /* 眼（凸顶）*/
  x.fillStyle = p.base; A.blob(x, 15, 15, 4, 1); A.blob(x, 25, 15, 4, 1);
  x.fillStyle = p.glow; A.blob(x, 15, 14.6, 2.2, 1); A.blob(x, 25, 14.6, 2.2, 1);
  x.fillStyle = p.dark; A.blob(x, 15, 15, 1, 1.4); A.blob(x, 25, 15, 1, 1.4);
  /* 阔嘴 + 毒涎 */
  x.strokeStyle = p.dark; x.lineWidth = 1.4;
  x.beginPath(); x.moveTo(9, 26); x.quadraticCurveTo(20, 30, 31, 26); x.stroke();
  x.fillStyle = A.alpha(p.glow, 0.7);
  A.blob(x, 12, 28, 1.2, 1); A.blob(x, 28, 28, 1.2, 1);
}

/* ---------- 蝎 ---------- */
function bossScorpion(C) {
  var x = C.x, p = C.p;
  /* 步足 */
  x.strokeStyle = p.dark; x.lineWidth = 1.6; x.lineCap = 'round';
  [[14, 26, 10, 33], [16, 27, 15, 34], [24, 27, 25, 34], [26, 26, 30, 33]].forEach(function (l) {
    x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(l[2], l[3]); x.stroke();
  });
  /* 躯体节 */
  x.fillStyle = p.base;
  for (var i = 0; i < 4; i++) A.blob(x, 16 + i * 2.6, 26 - i * 0.4, 3.4 - i * 0.3, 0.8);
  x.fillStyle = p.hi; A.blob(x, 15, 24, 3, 0.7);
  /* 双钳 */
  x.strokeStyle = p.base; x.lineWidth = 3;
  x.beginPath(); x.moveTo(13, 23); x.quadraticCurveTo(7, 20, 6, 15); x.stroke();
  x.beginPath(); x.moveTo(13, 25); x.quadraticCurveTo(8, 26, 6, 24); x.stroke();
  x.fillStyle = p.dark; A.blob(x, 5.6, 14.5, 2.4, 0.8); A.blob(x, 5.6, 24.4, 2.4, 0.8);
  /* 尾（卷曲上扬）+ 毒刺 */
  x.strokeStyle = p.dark; x.lineWidth = 3.6;
  x.beginPath(); x.moveTo(23, 25); x.quadraticCurveTo(33, 22, 31, 12);
  x.quadraticCurveTo(29, 6, 24, 8); x.stroke();
  x.strokeStyle = p.base; x.lineWidth = 2.4;
  x.beginPath(); x.moveTo(23, 25); x.quadraticCurveTo(32, 22, 30, 12);
  x.quadraticCurveTo(28.4, 7, 24.4, 8.6); x.stroke();
  x.fillStyle = p.glow;
  x.beginPath(); x.moveTo(24, 8.6); x.lineTo(21, 4); x.lineTo(26, 6.4); x.closePath(); x.fill();
}

/* ---------- 晶石魔像 ---------- */
function bossGolem(C) {
  var x = C.x, p = C.p;
  /* 腿（方块）*/
  x.fillStyle = p.dark;
  x.fillRect(14, 27, 5, 8); x.fillRect(21, 27, 5, 8);
  /* 躯干（多面）*/
  x.fillStyle = p.base;
  x.beginPath(); x.moveTo(13, 15); x.lineTo(27, 15); x.lineTo(28, 28); x.lineTo(12, 28); x.closePath(); x.fill();
  x.fillStyle = p.hi;
  x.beginPath(); x.moveTo(14, 16); x.lineTo(20, 16); x.lineTo(18, 27); x.lineTo(13, 27); x.closePath(); x.fill();
  x.fillStyle = A.alpha(p.dark, 0.6);
  x.beginPath(); x.moveTo(20, 16); x.lineTo(26, 16); x.lineTo(27, 27); x.lineTo(19, 27); x.closePath(); x.fill();
  /* 核心 */
  x.fillStyle = A.alpha(p.glow, 0.95); A.blob(x, 20, 21, 2.6, 1.2);
  x.fillStyle = A.alpha('#ffffff', 0.8); A.blob(x, 19.2, 20.2, 1, 1);
  /* 肩 / 臂 */
  x.fillStyle = p.dark;
  x.fillRect(9.6, 16, 4, 4); x.fillRect(26.4, 16, 4, 4);
  x.fillRect(10, 20, 3.4, 8); x.fillRect(26.6, 20, 3.4, 8);
  /* 颈（晶柱，把头与躯干接上，避免头悬浮）*/
  x.fillStyle = p.dark; x.fillRect(18, 12, 4, 4);
  /* 头（菱形晶簇，落在颈上）*/
  x.fillStyle = p.base;
  x.beginPath(); x.moveTo(20, 5); x.lineTo(23.4, 12); x.lineTo(16.6, 12); x.closePath(); x.fill();
  x.fillStyle = p.hi;
  x.beginPath(); x.moveTo(20, 6); x.lineTo(20, 12); x.lineTo(17.2, 11.4); x.closePath(); x.fill();
  x.fillStyle = p.glow; A.blob(x, 18.7, 10, 0.8, 1); A.blob(x, 21.3, 10, 0.8, 1);
  x.fillStyle = p.dark; A.blob(x, 18.7, 10.2, 0.4, 1); A.blob(x, 21.3, 10.2, 0.4, 1);
}

/* ---------- 巫妖 / 死神（袍 + 骷髅）---------- */
function bossLich(C) {
  var x = C.x, p = C.p, f = C.f;
  /* 破袍（宽摆）*/
  x.fillStyle = p.dark;
  x.beginPath(); x.moveTo(14, 14); x.quadraticCurveTo(9, 26, 7, 35);
  x.lineTo(33, 35); x.quadraticCurveTo(31, 26, 26, 14); x.closePath(); x.fill();
  x.fillStyle = A.alpha(p.base, 0.85);
  x.beginPath(); x.moveTo(15, 15); x.quadraticCurveTo(12, 26, 11, 34);
  x.lineTo(29, 34); x.quadraticCurveTo(28, 26, 25, 15); x.closePath(); x.fill();
  x.strokeStyle = A.alpha(p.glow, 0.5); x.lineWidth = 0.8;
  x.beginPath(); x.moveTo(13, 20); x.quadraticCurveTo(11, 28, 10, 33); x.stroke();
  x.beginPath(); x.moveTo(27, 20); x.quadraticCurveTo(29, 28, 30, 33); x.stroke();
  /* 骷髅手 */
  x.fillStyle = '#e6e0d0';
  A.blob(x, 11, 27, 1.8, 0.8); A.blob(x, 29, 27, 1.8, 0.8);
  /* 兜帽 + 骷髅头 */
  x.fillStyle = p.dark;
  x.beginPath(); x.moveTo(14, 13); x.quadraticCurveTo(20, 2, 26, 13);
  x.quadraticCurveTo(20, 16, 14, 13); x.closePath(); x.fill();
  x.fillStyle = '#e6e0d0'; A.blob(x, 20, 10, 4.4, 1.05);
  x.fillStyle = p.glow; A.blob(x, 18.2, 10, 1.3, 1); A.blob(x, 21.8, 10, 1.3, 1);
  x.fillStyle = p.dark; A.blob(x, 18.2, 10.3, 0.6, 1); A.blob(x, 21.8, 10.3, 0.6, 1);
  x.fillRect(18.6, 12.6, 2.8, 0.8);
  if (f.reaper) {
    /* 镰刀 */
    x.strokeStyle = '#8a6438'; x.lineWidth = 1.8;
    x.beginPath(); x.moveTo(30, 33); x.lineTo(34, 7); x.stroke();
    x.strokeStyle = '#dfe8f2'; x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(34, 7); x.quadraticCurveTo(39, 9, 36, 17); x.stroke();
  } else {
    /* 巫妖冠角 */
    x.fillStyle = p.glow;
    x.beginPath(); x.moveTo(16, 6.4); x.lineTo(14, 2); x.lineTo(17.4, 5.4); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(24, 6.4); x.lineTo(26, 2); x.lineTo(22.6, 5.4); x.closePath(); x.fill();
  }
}

/* ---------- 灵体（流光下半身 + 翼/光环）---------- */
function bossSpirit(C) {
  var x = C.x, p = C.p, f = C.f;
  if (f.wings) bossWings(x, p, 1.2);
  /* 流光下半身（无腿）*/
  x.fillStyle = A.alpha(p.base, 0.85);
  x.beginPath(); x.moveTo(15, 17); x.quadraticCurveTo(11, 28, 9, 35);
  x.lineTo(31, 35); x.quadraticCurveTo(29, 28, 25, 17); x.closePath(); x.fill();
  x.strokeStyle = A.alpha(p.glow, 0.8); x.lineWidth = 1.1;
  for (var i = 0; i < 3; i++) {
    x.beginPath(); x.moveTo(15 + i * 5, 19);
    x.quadraticCurveTo(13 + i * 5, 28, 12 + i * 5, 34); x.stroke();
  }
  /* 躯干 + 头 */
  x.fillStyle = A.alpha(p.hi, 0.9);
  x.beginPath(); x.moveTo(15, 14); x.lineTo(25, 14); x.lineTo(26, 20); x.lineTo(14, 20); x.closePath(); x.fill();
  x.fillStyle = '#f0d8b8'; A.blob(x, 20, 10.4, 4, 1.1);
  x.fillStyle = p.hair || p.glow;
  x.beginPath(); x.moveTo(16, 9); x.quadraticCurveTo(20, 4, 24, 9); x.lineTo(23.4, 7); x.lineTo(16.6, 7); x.closePath(); x.fill();
  x.fillStyle = p.glow; A.blob(x, 18.4, 10.6, 0.8, 1); A.blob(x, 21.6, 10.6, 0.8, 1);
  x.fillStyle = p.dark; A.blob(x, 18.4, 10.8, 0.4, 1); A.blob(x, 21.6, 10.8, 0.4, 1);
  if (f.halo) bossHalo(x, p);
}

/* ---------- 太初 / 混沌（核心 + 环绕）---------- */
function bossPrimordial(C) {
  var x = C.x, p = C.p, f = C.f;
  /* 外环 */
  x.strokeStyle = A.alpha(p.glow, 0.55); x.lineWidth = 1.6;
  x.beginPath(); x.ellipse(20, 21, 15, 13, 0.3, 0, 6.2832); x.stroke();
  x.strokeStyle = A.alpha(p.hi, 0.5); x.lineWidth = 0.9;
  x.beginPath(); x.ellipse(20, 21, 11, 15, -0.5, 0, 6.2832); x.stroke();
  /* 触须 */
  x.strokeStyle = A.alpha(p.glow, 0.7); x.lineWidth = 1.2;
  for (var i = 0; i < 5; i++) {
    var a = i * 1.257;
    x.beginPath(); x.moveTo(20 + Math.cos(a) * 6, 21 + Math.sin(a) * 6);
    x.quadraticCurveTo(20 + Math.cos(a + .4) * 13, 21 + Math.sin(a + .4) * 13,
      20 + Math.cos(a + .8) * 16, 21 + Math.sin(a + .8) * 16); x.stroke();
  }
  /* 核心 */
  x.fillStyle = p.dark; A.blob(x, 20, 21, 7.5, 1);
  x.fillStyle = p.base; A.blob(x, 20, 20.6, 6.4, 1);
  x.fillStyle = p.hi; A.blob(x, 18, 18.4, 3, 0.9);
  /* 多眼 */
  x.fillStyle = p.glow;
  A.blob(x, 17.4, 20, 1.4, 1); A.blob(x, 22.6, 20, 1.4, 1);
  A.blob(x, 20, 23, 1.2, 1);
  x.fillStyle = p.dark;
  A.blob(x, 17.4, 20.2, 0.7, 1); A.blob(x, 22.6, 20.2, 0.7, 1); A.blob(x, 20, 23.2, 0.6, 1);
}

/* ---------- 总入口 ---------- */
function bossGen(plan, elem, f) {
  f = f || {};
  var o = A.cv(40, 40), x = o.x, p = bossPal(elem);
  A.shadowEllipse(x, 20, 36.5, 13, 4.2, 0.4);
  if (f.aura) {
    var gg = x.createRadialGradient(20, 22, 2, 20, 22, 19);
    gg.addColorStop(0, A.alpha(p.glow, 0.28)); gg.addColorStop(1, A.alpha(p.glow, 0));
    x.fillStyle = gg; x.beginPath(); x.arc(20, 22, 19, 0, 6.2832); x.fill();
  }
  var C = { x: x, p: p, f: f };
  if (plan === 'humanoid') bossHumanoid(C);
  else if (plan === 'beast') bossBeast(C);
  else if (plan === 'dragon') bossDragon(C);
  else if (plan === 'monster') bossMonster(C);
  else if (plan === 'toad') bossToad(C);
  else if (plan === 'scorpion') bossScorpion(C);
  else if (plan === 'golem') bossGolem(C);
  else if (plan === 'lich') bossLich(C);
  else if (plan === 'spirit') bossSpirit(C);
  else bossPrimordial(C);
  return o.c;
}

  var BAKE = {
    demon: function () { return bossGen('monster','dark',{wings:true,aura:true}); },
    /* 雷兽（v1.2.0）：普通野怪（**不是 Boss**）—— 所以不用 `big`（Boss 才放大），
       但要 `aura`（雷系发光，与"雷雨天出没"呼应）。
       ⚠️ 键名与 `enemies.js` 里 `雷貂` 的 `sprite: 'thunder_beast'` 对应 ——
          两处必须一致，否则静默退回 `BAKE.snake()`（一个雷兽长成蛇样）。
          契约 `weather.encounter.contract` 钉这条。
       ⚠️ v1.3.0：**手绘立绘已出**（`battle.enemy.thunder_beast`），本函数降级为
          "素材丢失时的兜底" —— 但仍必须保留（否则素材一丢就是空图）。 */
    thunder_beast: function () { return bossGen('beast','thunder',{aura:true}); },

    ice_warrior: function () { return bossGen('humanoid','ice',{weapon:'sword'}); },
    ice_dragon: function () { return bossGen('dragon','ice',{aura:true}); },
    thunder_warrior: function () { return bossGen('humanoid','thunder',{weapon:'spear'}); },
    thunder_god: function () { return bossGen('humanoid','thunder',{weapon:'hammer',halo:true,aura:true,big:true}); },
    fire_demon: function () { return bossGen('monster','fire',{wings:true,aura:true}); },
    inferno_lord: function () { return bossGen('monster','fire',{wings:true,crown:true,aura:true,big:true}); },
    void_warrior: function () { return bossGen('humanoid','void',{weapon:'blade',cape:true}); },
    void_lord: function () { return bossGen('monster','void',{wings:true,crown:true,aura:true,big:true,tendrils:true}); },
    poison_toad: function () { return bossGen('toad','wood',{aura:true}); },
    sand_scorpion: function () { return bossGen('scorpion','earth'); },
    crystal_golem: function () { return bossGen('golem','light',{aura:true}); },
    lich: function () { return bossGen('lich','dark',{aura:true}); },
    lava_titan: function () { return bossGen('beast','fire',{plates:true,aura:true,big:true}); },
    aurora_spirit: function () { return bossGen('spirit','ice',{halo:true,aura:true}); },
    thunder_titan: function () { return bossGen('beast','thunder',{plates:true,aura:true,big:true}); },
    shadow_king: function () { return bossGen('monster','dark',{crown:true,wings:true,aura:true,big:true}); },
    angel: function () { return bossGen('spirit','light',{wings:true,halo:true,aura:true}); },
    chaos_herald: function () { return bossGen('monster','void',{tendrils:true,wings:true,aura:true,big:true}); },
    blood_cult: function () { return bossGen('humanoid','blood',{weapon:'dagger',cape:true}); },
    diviner: function () { return bossGen('humanoid','wind',{weapon:'staff',halo:true}); },
    celestial_guard: function () { return bossGen('humanoid','thunder',{weapon:'halberd',cape:true}); },
    primordial: function () { return bossGen('primordial','light',{aura:true}); },
    reaper: function () { return bossGen('lich','dark',{reaper:true,aura:true}); },
    /* 天道本体 · 云幕冷眼（终局 v0.86）：一只悬于云翳、冷瞰诸世的巨眼。 */
    tiandao: function () {
      var o = A.cv(40, 40), x = o.x;
      var rg = x.createRadialGradient(20, 20, 2, 20, 20, 19);
      rg.addColorStop(0, 'rgba(150,180,230,0.4)'); rg.addColorStop(1, 'rgba(150,180,230,0)');
      x.fillStyle = rg; x.fillRect(0, 0, 40, 40);
      /* 眼白（杏仁形）*/
      x.fillStyle = '#d8e0ee';
      x.beginPath();
      x.moveTo(4, 20);
      x.quadraticCurveTo(20, 8, 36, 20);
      x.quadraticCurveTo(20, 32, 4, 20); x.closePath(); x.fill();
      /* 虹膜（同心冷环）*/
      [[10, '#3650a4'], [8, '#5a7cd0'], [6, '#9ab4ec'], [4, '#e8f0ff']].forEach(function (r) {
        x.fillStyle = r[1]; x.beginPath(); x.arc(20, 20, r[0], 0, 6.2832); x.fill();
      });
      /* 冷竖瞳 + 高光 */
      x.fillStyle = '#0a0e1c';
      x.beginPath(); x.ellipse(20, 20, 1.3, 4.2, 0, 0, 6.2832); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.95)'; A.blob(x, 17.6, 17.4, 1.1, 1);
      /* 上下云翳（眼睑），压住眼白上下缘，呈「云中半睁」*/
      x.fillStyle = '#0a0e1c';
      x.beginPath(); x.moveTo(3, 15); x.quadraticCurveTo(20, 1, 37, 15);
      x.lineTo(37, 9); x.quadraticCurveTo(20, -3, 3, 9); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(3, 25); x.quadraticCurveTo(20, 39, 37, 25);
      x.lineTo(37, 31); x.quadraticCurveTo(20, 43, 3, 31); x.closePath(); x.fill();
      /* 放射冷线 */
      x.strokeStyle = 'rgba(180,200,240,0.5)'; x.lineWidth = 0.6;
      for (var a = 0; a < 8; a++) {
        var an = a / 8 * 6.2832;
        x.beginPath();
        x.moveTo(20 + Math.cos(an) * 11, 20 + Math.sin(an) * 11);
        x.lineTo(20 + Math.cos(an) * 14.5, 20 + Math.sin(an) * 14.5); x.stroke();
      }
      return o.c;
    },
    /* 通用陆地坐骑（马形，朝右；explore 左向时镜像）。无素材时的兜底，保证骑乘必有可见坐骑。 */
    mount: function () {
      var o = A.cv(40, 40), x = o.x;
      A.shadowEllipse(x, 20, 37, 15, 4.5, 0.4);
      var body = '#8a5a34', hi = '#b47d49', dark = '#5e3c22', mane = '#3a2414', hoof = '#241608';
      /* 四条腿（后腿偏左、前腿偏右），先画腿再盖身体 */
      x.strokeStyle = dark; x.lineWidth = 3; x.lineCap = 'round';
      [[11, 23, 11, 35], [14, 23, 15, 35], [24, 22, 24, 35], [27, 22, 28, 35]].forEach(function (l) {
        x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(l[2], l[3]); x.stroke();
      });
      x.strokeStyle = hoof; x.lineWidth = 2;
      [[11, 35], [15, 35], [24, 35], [28, 35]].forEach(function (p2) {
        x.beginPath(); x.moveTo(p2[0] - 1, p2[1]); x.lineTo(p2[0] + 1, p2[1]); x.stroke();
      });
      /* 躯干 + 臀 + 胸 */
      x.fillStyle = dark; A.blob(x, 19, 23, 11.5, 0.52);
      x.fillStyle = body; A.blob(x, 19, 22, 11, 0.5); A.blob(x, 11, 22, 5, 0.6); A.blob(x, 26, 21, 5, 0.58);
      x.fillStyle = hi; A.blob(x, 17, 20, 7, 0.4);
      /* 尾（左后）*/
      x.strokeStyle = dark; x.lineWidth = 2.4;
      x.beginPath(); x.moveTo(9, 20); x.quadraticCurveTo(4, 25, 6, 30); x.stroke();
      /* 颈 + 鬃（朝右上）*/
      x.strokeStyle = body; x.lineWidth = 5;
      x.beginPath(); x.moveTo(26, 19); x.lineTo(31, 11); x.stroke();
      x.strokeStyle = mane; x.lineWidth = 2;
      x.beginPath(); x.moveTo(24, 19); x.lineTo(29, 11); x.stroke();
      /* 头 + 耳 + 眼 */
      x.fillStyle = body; A.blob(x, 32, 10, 4, 0.66);
      x.fillStyle = dark; x.fillRect(30, 5, 1.6, 3.4); x.fillRect(33, 5.4, 1.6, 3.2);
      x.fillStyle = '#1c1208'; x.fillRect(33.4, 9.4, 1.4, 1.4);
      return o.c;
    },
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

  /* ===== 手绘帧动画（v0.54.0）=====
     读取已切片的 sheet.hero.* 精灵条（每帧等宽、脚底对齐），逐帧烘到统一占位盒：
     横向居中、脚底钉盒底。view: down/up/side；action: walk(4帧)/idle(2帧)。 */
  var ANIM_W = 28, ANIM_H = 46;
  var ANIM_DEF = {
    walk: { n: 4, keys: { down: 'sheet.hero.walk.down', up: 'sheet.hero.walk.up', side: 'sheet.hero.walk.side' } },
    idle: { n: 2, keys: { down: 'sheet.hero.idle.down', up: 'sheet.hero.idle.up', side: 'sheet.hero.idle.side' } }
  };
  var animCache = {};
  /* v2.0.0：第 3 参 `look`。与 `heroSprite` 同一分流逻辑：
       · 默认外观 → 走 `sheet.hero.*` 手绘帧（**零回归**，老玩家看到的是它）
       · 穿了非默认外观 → 返回 null，让调用方**回落到 `heroFrames()` 的程序化帧**
         （那条路会消费 pal + look，所以换装是**立即生效**的）。
     返回 null ≠ "没有动画" —— 它是"这一路画不了换装，请走兜底"。
     ⚠️ 调用方必须保留对 null 的兜底分支（explore.js 已有，不要删）。 */
  function heroAnim(view, action, look) {
    var lk = look === undefined ? currentLook() : look;
    var ck = action + '.' + view + '|' + lkTagOf(lk) + '|' + (A.K || 1);
    if (Object.prototype.hasOwnProperty.call(animCache, ck)) return animCache[ck];
    var def = ANIM_DEF[action];
    /* 非默认外观：手绘帧换不了衣服 → 明确返回 null 交给程序化兜底。
       这一句是"换装立即生效"的关键，删掉它就会出现最难查的那种
       "面板换了、地图没换"（因为动画帧优先，兜底永远轮不到）。 */
    if (!_lookIsDefault(lk)) { animCache[ck] = null; return null; }
    var img = G.Assets && G.Assets.img ? G.Assets.img(def.keys[view]) : null;
    if (!img) { animCache[ck] = null; return null; }
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var cw = iw / def.n, arr = [];
    for (var i = 0; i < def.n; i++) {
      var o = A.cv(ANIM_W, ANIM_H);
      o.x.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in o.x) o.x.imageSmoothingQuality = 'high';
      var sx = Math.round(i * cw), sw = Math.round((i + 1) * cw) - sx;
      var dw = sw * (ANIM_H / ih);
      var dx = (ANIM_W - dw) / 2;
      o.x.drawImage(img, sx, 0, sw, ih, dx, 0, dw, ANIM_H);
      /* 像素化（v2.0.0）：手绘帧也要与像素地面/程序化角色同族。
         ⚠️ 不降的话，走路时（用 sheet 帧）是高清、停下时（用 heroSprite）是像素格 ——
            同一角色两步之内换画风，比全高清更刺眼。 */
      arr.push(G.Art && G.Art.pixelate && G.pixelOn && G.pixelOn()
        ? G.Art.pixelate(o.c, G.PIXEL) : o.c);
    }
    animCache[ck] = arr;
    return arr;
  }

  /* NPC 待机帧（v0.54.0）：2 帧 idle，烘到与主角同一占位盒。 */
  var NPC_ANIM_KEY = {
    villager: 'sheet.npc.villager', elder: 'sheet.npc.elder',
    keeper: 'sheet.npc.keeper', cultist: 'sheet.npc.cultist'
  };
  function npcAnim(kind) {
    var ck = 'npcanim.' + kind;
    if (Object.prototype.hasOwnProperty.call(animCache, ck)) return animCache[ck];
    var key = NPC_ANIM_KEY[kind];
    var img = key && G.Assets.img ? G.Assets.img(key) : null;
    if (!img) { animCache[ck] = null; return null; }
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var n = 2, cw = iw / n, arr2 = [];
    for (var i = 0; i < n; i++) {
      var o2 = A.cv(ANIM_W, ANIM_H);
      o2.x.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in o2.x) o2.x.imageSmoothingQuality = 'high';
      var sx = Math.round(i * cw), sw = Math.round((i + 1) * cw) - sx;
      var dw = sw * (ANIM_H / ih), dx = (ANIM_W - dw) / 2;
      o2.x.drawImage(img, sx, 0, sw, ih, dx, 0, dw, ANIM_H);
      arr2.push(o2.c);
    }
    animCache[ck] = arr2;
    return arr2;
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
    heroBattle: function () {
      var f = heroBattleFrames();
      /* 全局秒表驱动两帧待机循环；无头测试/无 DOM 时 time≈0，恒取第 0 帧，行为稳定 */
      return f.length > 1 ? f[Math.floor(G.game.time / 0.85) % f.length] : f[0];
    },
    heroBattleFrames: heroBattleFrames,
    heartDemon: heartDemonSprite,
    /* 已登记的程序化战斗立绘键（供契约断言"登记了且真的能产出位图"） */
    BAKE_KEYS: Object.keys(BAKE),
    HERO_PAL: HERO,
    /* 地图角色的逻辑占位尺寸：渲染点必须用它，改 MAP_SCALE 时不会漏改一边 */
    HERO_W: HERO_LW, HERO_H: HERO_LH, MAP_SCALE: MAP_SCALE,
    heroAnim: heroAnim, ANIM_W: ANIM_W, ANIM_H: ANIM_H,
    heroAgeStage: heroAgeStage, AGE_STAGE_R: AGE_STAGE_R,
    /* 童年档素材是否命中（供契约/探针查；素材缺时 heroAgeStage 会自动走程序化兜底） */
    ageStageHasAsset: ageStageHasAsset,
    /* 童年档的**逻辑尺寸**：调用方 drawImage 必须显式传这个，
       否则会把 K 倍物理位图当逻辑尺寸画（放大 K 倍且模糊）。 */
    AGE_STAGE_LOGICAL: { w: AGE_STAGE_W, h: AGE_STAGE_H },
    /* 烘焙密度（诊断/契约用）：位图像素 = LOGICAL × 此值 ÷ MAP_SCALE */
    AGE_STAGE_BAKE_SCALE: AGE_STAGE_BAKE_SCALE,
    AGE_STAGE_SRC: AGE_STAGE_SRC,
    npcAnim: npcAnim,
    /* ===== v2.0.0 换装（对外唯一口）=====
       · `setLook` / `lookOf` / `lkTagOf` / `lookIsDefault` —— 外观登记与判据
       · `heroParts` / `heroSprite` 导出是为了让契约能**直接喂参数**验证
         部件数与换装效果（不必绕渲染点；渲染点说不清"忘了传 look"）
       ⚠️ 渲染点取外观一律走 `lookOf(save)`，不要自己拼 —— 拼两份必漂。 */
    setLook: setLook, currentLook: currentLook, lookOf: lookOf,
    lkTagOf: lkTagOf, lookIsDefault: _lookIsDefault,
    heroParts: heroParts, heroSprite: heroSprite,
    /* 超采样倍率变更后必须调用：清空全部精灵缓存并丢弃已建好的 hero 帧表，
       否则旧倍率的位图会被继续复用（放大后重新变糊）。 */
    clear: function () {
      heroCache = {}; npcCache = {}; beastCache = {}; animCache = {}; _hd = null; _hbat = null; _hbatFrames = null;
      childCache = {};
      this.hero = null;
    }
  };

  G.Sprites = Sprites;
  G.Art.heroSprite = heroSprite;
})();
