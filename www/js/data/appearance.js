/* 装扮（外观部件）—— 服饰 / 头饰 / 武器 / 鞋子 四槽
 *
 * 用户口径：「我希望能支持主角更换服饰、武器、头饰、鞋子等等装饰物」。
 *
 * 设计要点（**读取本文件前请先读完这四条**）：
 *
 *   · **外观与数值彻底解耦**。装扮**只改长相，不给任何属性**。
 *     属性加成归「法宝三槽」（`G.Data.equips`，`save.equip`），那是另一套。
 *     两套并存的理由：法宝决定"强不强"，装扮决定"像不像我"。
 *     玩家不该为了好看而变弱，也不该为了变强而变丑 —— 这是两件事。
 *     ⚠️ 千万别在这里塞 `fx`。塞了就会出现"面板写 +8% 但不生效"（te 不认识
 *        这个字段）或"看着是装扮其实偷偷改了战斗数值"两种静默事故。
 *
 *   · **唯一取色口 `palOf(save)`**。`G.Sprites.heroParts` 的调色板只能从这里来，
 *     不许在 sprites/explore/overlays 任何一处自己拼 `pal` ——
 *     拼两份必然漂（表现是"地图上是蓝袍、面板立绘是绿袍"）。
 *
 *   · **`palOf(null)` 必须逐字段等于 `G.Sprites.HERO_PAL`**（零回归闸）。
 *     没装扮 / 老存档 / 无头契约都走这条默认路径，输出必须与历史逐像素一致。
 *
 *   · **`def` = 定义档（default）**，不是"当前穿着"。
 *     `save.appear` 只存**玩家亲手换过的那几槽**（`{ robe: 'rb_qing' }`），
 *     没存的槽按 `default` 解析。这样新增一槽/改一个默认件**不会把老档弄脏**，
 *     也不需要写存档迁移。
 */
(function () {
  /* 四槽。`cap` = 器物槽（武器/头饰/鞋），渲染时是**叠加层**，不参与袍身换色；
     `wear` = 织物槽（服饰），渲染时走**调色板映射**（换色，不叠加图形）。 */
  var SLOTS = ['robe', 'head', 'weapon', 'feet'];
  var SLOT_N = { robe: '服饰', head: '头饰', weapon: '武器', feet: '鞋子' };
  var SLOT_KIND = { robe: 'wear', head: 'cap', weapon: 'cap', feet: 'cap' };

  /* ===== 服饰（走调色板映射）=====
     `c` = 主色（robe / robeHi / robeDark / collar / belt / beltHi / sash 由主色派生）
     `acc` = 饰边色（领口 / 腰带 / 飘带），不填则用主色派生的中性米色。 */
  var ROBES = [
    { id: 'rb_bu', n: '素麻布衣', c: '#8d8574', acc: '#cfc6ae', d: '入世时穿的粗麻布衣，洗得发白。' },
    { id: 'rb_qing', n: '青衫', c: '#5d6f94', acc: '#e6ddc2', d: '最常见的读书人青衫。' },
    { id: 'rb_bai', n: '白袍', c: '#d8d9dd', acc: '#8c93a6', d: '素白无纹，据说是某些隐门的常服。' },
    { id: 'rb_xuan', n: '玄衣', c: '#3a3a48', acc: '#8a7f6a', d: '通体玄黑，夜里几乎看不见人影。' },
    { id: 'rb_jiang', n: '绛红长袍', c: '#8c3446', acc: '#e0c896', d: '绛红配金线，富贵气重。' },
    { id: 'rb_zhu', n: '竹青道袍', c: '#4d7a52', acc: '#e2dcc0', d: '竹青色道袍，绣有云鹤暗纹。' },
    { id: 'rb_zi', n: '紫霞法衣', c: '#6b4a96', acc: '#dcc8f0', d: '紫霞流转，气机自生。' },
    { id: 'rb_yue', n: '月白短打', c: '#9fb4c8', acc: '#5c6a7d', d: '月白色短打，利落好动。' }
  ];

  /* ===== 头饰（叠加层）=====
     `c` = 主色；`hi` = 高光色；`kind` 决定画法（见 sprites.js `_capParts`）。
     `noBun` 表示这一件**盖住发髻**（斗笠/冠），渲染时会隐去头顶发髻。 */
  var HEADS = [
    { id: 'hd_shu', n: '束发', kind: 'none', c: '#4a4459', hi: '#6d6478',
      d: '最简单的束发，一根布带系住。' },
    { id: 'hd_guan', n: '玉冠', kind: 'guan', c: '#e8e4d8', hi: '#ffffff', d: '白玉小冠，束在发髻上。' },
    { id: 'hd_dou', n: '斗笠', kind: 'dou', c: '#b8945e', hi: '#d8b87a', noBun: true,
      d: '竹篾编的斗笠，遮日遮雨。' },
    { id: 'hd_jin', n: '金冠', kind: 'guan', c: '#d8b768', hi: '#f6e4a8', d: '金冠束发，气度森然。' },
    { id: 'hd_dai', n: '青玉簪', kind: 'zan', c: '#5f8f7a', hi: '#a8d4c0', d: '一支青玉簪横插发间。' },
    { id: 'hd_mo', n: '墨玉冠', kind: 'guan', c: '#3c3a48', hi: '#6d6880', d: '墨玉冠，沉而不亮。' }
  ];

  /* ===== 武器（叠加层，背在身后）=====
     `kind` 决定画法（见 sprites.js `_weaponParts`）。
     ⚠️ 武器**只做外观**，不接任何战斗数值；战斗伤害仍走 `G.Data.equips`。 */
  var WEAPONS = [
    { id: 'wp_none', n: '空手', kind: 'none', c: '#8d8574', hi: '#cfc6ae', d: '两手空空，倒也无牵无挂。' },
    { id: 'wp_jian', n: '长剑', kind: 'sword', c: '#c9ccd4', hi: '#eef1f6', d: '最常见的青钢长剑，斜背在背后。' },
    { id: 'wp_dao', n: '弯刀', kind: 'saber', c: '#b8a878', hi: '#e4d8a8', d: '刀身微弯，鞘上缠着旧布。' },
    { id: 'wp_qiang', n: '长枪', kind: 'spear', c: '#8a6a48', hi: '#c0a074', d: '枪杆斜倚肩后，红缨微垂。' },
    { id: 'wp_shan', n: '折扇', kind: 'fan', c: '#e0d8c4', hi: '#8c7448', d: '纸骨折扇，扇骨上刻着极小的字。' },
    { id: 'wp_fu', n: '拂尘', kind: 'whisk', c: '#e8e4dc', hi: '#8a6a48', d: '马尾拂尘，柄是旧竹。' },
    { id: 'wp_yu', n: '玉笛', kind: 'flute', c: '#cfe0d8', hi: '#8fb0a0', d: '一支素玉笛，横在腰间。' }
  ];

  /* ===== 鞋子（走向调色板映射 `shoe`）===== */
  var FEET = [
    { id: 'ft_bu', n: '布鞋', c: '#2c2a30', hi: '#4a4652', d: '黑布鞋，走着不出声。' },
    { id: 'ft_cao', n: '草鞋', c: '#8a7448', hi: '#b09860', d: '草绳编的鞋，走山路最合适。' },
    { id: 'ft_xue', n: '皂靴', c: '#1e1c22', hi: '#3e3a46', d: '官样皂靴，踏地有声。' },
    { id: 'ft_yun', n: '云纹履', c: '#5f6f94', hi: '#93a4c8', d: '履面绣云纹，据说不沾泥。' },
    { id: 'ft_chi', n: '赤足', c: '#c99870', hi: '#e8b890', d: '索性脱了鞋。' }
  ];

  var POOL = { robe: ROBES, head: HEADS, weapon: WEAPONS, feet: FEET };
  var INDEX = {};
  SLOTS.forEach(function (s) {
    (POOL[s] || []).forEach(function (e) { INDEX[e.id] = e; e.slot = s; });
  });

  /* 每槽的**默认件**（老档 / 未穿过任何装扮时解析到它）。
     ⚠️ 这四个 id 必须真实存在于上面的池子里（契约 `appearance.contract` 钉住）。
     ⚠️ 默认服饰取 `rb_qing`（青衫），它的主色 `#5d6f94` **逐字等于**
        `G.Sprites.HERO_PAL.robe` —— 这正是"零回归"的物理来源：默认外观走
        `palOf` 与走老路径得到的是同一组色值。改这个颜色 = 全体玩家外观变了。 */
  var DEFAULT = { robe: 'rb_qing', head: 'hd_shu', weapon: 'wp_none', feet: 'ft_bu' };

  /* ---------- 颜色派生 ----------
     只做 **HSL 明度/饱和度** 调整，不改色相 —— 保证"青衫换白袍"时
     高光/暗面仍然读作同一块布，而不是三块不相干的色。 */
  function parse(h) {
    h = String(h || '#000000');
    if (h.charAt(0) === '#') {
      var t = h.slice(1);
      if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
      return [parseInt(t.substr(0, 2), 16), parseInt(t.substr(2, 2), 16), parseInt(t.substr(4, 2), 16)];
    }
    var m = h.match(/(\d+)[^\d]+(\d+)[^\d]+(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
  }
  function hex(c) {
    return '#' + c.map(function (v) {
      var n = Math.max(0, Math.min(255, Math.round(v)));
      return (n < 16 ? '0' : '') + n.toString(16);
    }).join('');
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (mx === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h, s, l];
  }
  function hsl2hex(h, s, l) {
    function hue(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    h = ((h % 1) + 1) % 1;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3);
    }
    return hex([r * 255, g * 255, b * 255]);
  }
  /* 同色相调明度/饱和：`dl` 明度增量 +，`ds` 饱和增量 + */
  function shift(hexCol, dl, ds) {
    var c = parse(hexCol);
    var h = rgb2hsl(c[0], c[1], c[2]);
    return hsl2hex(h[0], Math.max(0, Math.min(1, h[1] + (ds || 0))), Math.max(0, Math.min(1, h[2] + (dl || 0))));
  }
  /* 向白/黑插值（做领口那种"褪色"的中性饰边） */
  function mixw(hexCol, t) {
    var c = parse(hexCol);
    return hex(c.map(function (v) { return v + (255 - v) * (t || 0); }));
  }

  /* 取某槽"当前实际穿着"的件（含默认回退）。
     `save` 可以为 null（→ 全默认）。**绝不抛异常** —— 存档里可能存着一个
     已被删掉的装扮 id（改版本删过件），这时静默回落到默认件而不是崩。 */
  function worn(save, slot) {
    var cur = save && save.appear && save.appear[slot];
    var e = cur ? INDEX[cur] : null;
    if (e && e.slot === slot) return e;
    return INDEX[DEFAULT[slot]] || null;
  }

  /* ===== 唯一取色口 =====
     返回一个与 `G.Sprites.HERO_PAL` **同形**的调色板对象。
     `heroParts` / `heroAnim` / 面板立绘都只认它的返回值。
     ⚠️ 键名必须与 HERO_PAL 完全一致（hair/hairHi/skin/skinSh/skinHi/
        robe/robeDark/robeHi/collar/belt/beltHi/shoe/eye/sash），
        少一个键 → 对应部件画成 `undefined` 色 → canvas 抛错或黑块。 */
  function palOf(save) {
    var base = (G.Sprites && G.Sprites.HERO_PAL) || {};
    var robe = worn(save, 'robe') || {};
    var feet = worn(save, 'feet') || {};
    var c = robe.c || base.robe;
    var o = {
      hair: base.hair, hairHi: base.hairHi,
      skin: base.skin, skinSh: base.skinSh, skinHi: base.skinHi,
      eye: base.eye,
      /* 袍身三面：主色 / 高光（提亮 9%）/ 暗面（压暗 11%）
         —— 与历史 HERO_PAL 的 #5d6f94 / #7e91b8 / #3f4c6d 同一套路数 */
      robe: c,
      robeHi: shift(c, 0.09, -0.02),
      robeDark: shift(c, -0.11, 0.02),
      /* 领口 / 腰带 / 飘带 */
      collar: robe.acc || mixw(c, 0.62),
      sash: robe.acc || mixw(c, 0.42),
      belt: shift(robe.acc || c, -0.16, 0.08),
      beltHi: shift(robe.acc || c, 0.06, 0.04),
      /* 鞋 */
      shoe: feet.c || base.shoe
    };
    /* 默认件必须**原样返回历史色值**（不经过任何 shift 往返）。
       理由：HLS 往返有 ±1 的舍入误差 → 默认外观逐像素不变这条闸会假红。
       所以这里显式用历史常量覆盖一次。 */
    if ((robe.id || DEFAULT.robe) === DEFAULT.robe && (feet.id || DEFAULT.feet) === DEFAULT.feet) {
      o.robe = base.robe; o.robeHi = base.robeHi; o.robeDark = base.robeDark;
      o.collar = base.collar; o.belt = base.belt; o.beltHi = base.beltHi; o.sash = base.sash;
      o.shoe = base.shoe;
    }
    /* 鞋单独换过时也要覆盖（上面的分支只在"两槽都默认"时进） */
    if ((feet.id || DEFAULT.feet) !== DEFAULT.feet) o.shoe = feet.c || base.shoe;
    return o;
  }

  /* 外观签名：把"当前穿着"压成短串，用于**精灵缓存键**。
     ⚠️ 缓存键不带外观 = 换了衣服但地图上角色不变（缓存命中旧的），
        而且**完全静默**。凡是缓存角色位图的地方都必须带上它。 */
  function keyOf(save) {
    return SLOTS.map(function (s) {
      var e = worn(save, s);
      return e ? e.id : '-';
    }).join('|');
  }

  /* 一键换某槽（面板用）。`id` 传空 = 恢复默认件。
     返回 {ok, reason}，与 `Player.setEquip` 同形，调用方只负责提示文案。 */
  function set(save, slot, id) {
    if (!save) return { ok: false, reason: '无存档' };
    if (SLOTS.indexOf(slot) < 0) return { ok: false, reason: '无此槽位' };
    if (id && !INDEX[id]) return { ok: false, reason: '无此装扮' };
    if (id && INDEX[id].slot !== slot) return { ok: false, reason: '装扮与槽位不符' };
    save.appear = save.appear || {};
    if (!id || id === DEFAULT[slot]) delete save.appear[slot];   /* 默认件不落存档 */
    else save.appear[slot] = id;
    if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
    return { ok: true };
  }

  /* 解锁条件：这一版**全部开放**（装扮不加数值 → 不存在"氪金变强"问题），
     但接口先留出来，后续要接"宗门贡献 / 副本首杀"只需改这一个函数。
     ⚠️ 面板按钮的**禁用判据**必须读它，不许自己写条件（两处判据必漂）。 */
  function unlocked(save, id) { return !!INDEX[id]; }

  G.Data = G.Data || {};
  G.Data.appearance = {
    SLOTS: SLOTS, SLOT_N: SLOT_N, SLOT_KIND: SLOT_KIND, DEFAULT: DEFAULT,
    list: function (slot) { return (POOL[slot] || []).slice(); },
    byId: function (id) { return INDEX[id] || null; },
    worn: worn, palOf: palOf, keyOf: keyOf, set: set, unlocked: unlocked,
    /* 颜色工具（面板画色块预览要用；单独导出让面板不必自己 parse 颜色） */
    shift: shift, mixw: mixw
  };
})();
