/* 地图数据：结构建筑、道路、围栏、散布与出入口（宝可梦式俯视瓦片，16px/格） */
(function () {
  function S(id, kind, x, y, w, h, extra) {
    var o = { id: id, kind: kind, x: x, y: y, w: w, h: h };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  /* 道路段：h 横 / v 纵 */
  function path(kind, x, y, n) { return { kind: kind, x: x, y: y, n: n }; }
  function fence(x0, y0, x1, y1, gap) { return { x0: x0, y0: y0, x1: x1, y1: y1, gap: gap }; }

  var maps = {
    town: {
      id: 'town', w: 36, h: 24, safe: true, ground: 'town',
      spawn: { x: 18, y: 21 },
      structures: [
        S('home', 'house', 3, 5, 6, 5, { label: '沈家小院', roof: '#6b5a4a' }),
        S('shop', 'house', 14, 6, 6, 5, { label: '药铺', roof: '#5a6478' }),
        S('market', 'house', 26, 7, 5, 4, { label: '刘记杂货', roof: '#78624a' })
      ],
      paths: [
        path('v', 18, 11, 12),
        path('h', 6, 11, 13),
        path('h', 18, 12, 11),
        path('h', 28, 12, -9)
      ],
      fences: [
        fence(2, 4, 10, 4, { x: 6, y: 4 }),
        fence(2, 11, 2, 4, null),
        fence(10, 11, 10, 4, null),
        fence(2, 11, 10, 11, { x: 6, y: 11 })
      ],
      scatter: { trees: 6, rocks: 2 },
      special: [ { id: 'well', kind: 'well', x: 23, y: 16 } ],
      /* 站桩 NPC（探图 v0.2 §NPC）：占格实心、按 y 排序渲染、可点可面对交互。
         位置必须避开道路 —— 镇里的主路只有 1 格宽，NPC 站上去就把路堵死了。
         NPC 只有正面一套画法（程序化或 char.npc.<kind>），所以不配朝向。 */
      npcs: [
        { id: 'washer', kind: 'villager', name: '浣衣妇', portrait: 'villager',
          x: 22, y: 18, act: 'chat.washer' },
        { id: 'woodman', kind: 'villager', name: '老樵夫', portrait: 'villager',
          x: 7, y: 13, act: 'chat.woodman' }
      ],
      exits: [ { x0: 17, x1: 19, y: 23, to: 'field', spawn: { x: 24, y: 37 }, label: '翠微山' } ]
    },

    field: {
      id: 'field', w: 50, h: 40, ground: 'grass',
      spawn: { x: 24, y: 37 },
      zones: [
        /* sp = 单只遭遇的相对权重；pair = 双只组出现概率（%，灵根切片 v0.3 §11）
           bias = 该物种在本区的等级偏移（前坡狼比蛇高一段） */
        { id: 'front', y0: 28, y1: 39, enc: { min: 2, max: 4 },
          sp: { 青纹蛇: 60, 赤炎狼: 30 }, pair: 10, pairWith: '青纹蛇',
          bias: { 赤炎狼: 1 } },
        { id: 'mid', y0: 15, y1: 27, enc: { min: 4, max: 6 },
          sp: { 赤炎狼: 50, 青纹蛇: 20 }, pair: 30, pairWith: '赤炎狼' },
        { id: 'back', y0: 2, y1: 14, enc: { min: 5, max: 8 },
          sp: { 树精: 50, 赤炎狼: 25 }, pair: 25, pairWith: '树精' }
      ],
      structures: [
        S('temple', 'ruin', 40, 32, 5, 4, { label: '山神庙' }),
        S('caveIn', 'gate', 23, 2, 4, 2, {
          label: '赤牙洞', need: { globalLevel: 12 },
          to: 'cave', spawn: { x: 16, y: 24 },
          closedText: '落石封路，需炼气三段以上修为。'
        })
      ],
      paths: [ path('v', 24, 4, 35) ],
      fences: [],
      scatter: { trees: 46, rocks: 22 },
      special: [
        { id: 'chest1', kind: 'chest', x: 10, y: 20, loot: { stone: 100 } },
        { id: 'chest2', kind: 'chest', x: 38, y: 8, loot: { items: { '解封符': 2 } } }
      ],
      exits: [ { x0: 23, x1: 26, y: 39, to: 'town', spawn: { x: 18, y: 20 }, label: '青溪镇' } ]
    },

    cave: {
      id: 'cave', w: 32, h: 26, ground: 'cave',
      spawn: { x: 16, y: 24 },
      zones: [ { id: 'cave', y0: 4, y1: 25, enc: { min: 6, max: 9 },
        sp: { 青纹蛇: 40, 赤炎狼: 35, 树精: 25 }, pair: 35, pairWith: '青纹蛇' } ],
      structures: [],
      paths: [], fences: [],
      scatter: { rocks: 30 },
      special: [
        { id: 'chest3', kind: 'chest', x: 8, y: 14,
          loot: { stone: 150, items: { '回春丹': 2 } } },
        { id: 'boss', kind: 'boss', x: 16, y: 6 }
      ],
      exits: [ { x0: 14, x1: 17, y: 25, to: 'field', spawn: { x: 24, y: 4 }, label: '翠微山' } ]
    },

    /* ============================================================
       室内：全部按 30×17 格（正好一屏 480×272），门开在下边墙正中。
       spawn 是进门后的落脚点（门内侧一格），exits 走回门外那一格。
       ============================================================ */

    town_home: {
      id: 'town_home', w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
      label: '沈家小院', spawn: { x: 15, y: 14 },
      /* 家具从 y=3 起摆：房间正好一屏（17 格），顶部 0—2 行会被 HUD 盖住 */
      furn: [
        { id: 'bed', kind: 'bed', x: 3, y: 3, w: 3, h: 2, act: 'rest', label: '床' },
        { id: 'vessel', kind: 'vessel', x: 13, y: 3, w: 2, h: 2, act: 'cult', label: '逆命珠' },
        { id: 'screen', kind: 'screen', x: 20, y: 3, w: 4, h: 1 },
        { id: 'table', kind: 'table', x: 22, y: 5, w: 3, h: 2 },
        { id: 'cushion', kind: 'cushion', x: 13, y: 8, w: 2, h: 2, act: 'meditate', label: '蒲团' },
        { id: 'lanternL', kind: 'lantern', x: 1, y: 8, w: 1, h: 2 },
        { id: 'lanternR', kind: 'lantern', x: 28, y: 8, w: 1, h: 2 },
        { id: 'shelf', kind: 'shelf', x: 2, y: 12, w: 3, h: 1 },
        { id: 'jar', kind: 'jar', x: 6, y: 13, w: 1, h: 1 },
        { id: 'crate', kind: 'crate', x: 25, y: 13, w: 1, h: 1 }
      ],
      exits: [ { x0: 14, x1: 15, y: 16, to: 'town', spawn: { x: 6, y: 11 }, label: '出门' } ]
    },

    town_shop: {
      id: 'town_shop', w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
      label: '药铺', spawn: { x: 15, y: 14 },
      furn: [
        { id: 'shelfA', kind: 'shelf', x: 2, y: 3, w: 3, h: 1 },
        { id: 'shelfB', kind: 'shelf', x: 25, y: 3, w: 3, h: 1 },
        { id: 'lanternL', kind: 'lantern', x: 1, y: 5, w: 1, h: 2 },
        { id: 'lanternR', kind: 'lantern', x: 28, y: 5, w: 1, h: 2 },
        { id: 'counter', kind: 'counter', x: 11, y: 6, w: 5, h: 1, act: 'shenbo', label: '柜台' },
        { id: 'jarA', kind: 'jar', x: 2, y: 7, w: 1, h: 1 },
        { id: 'jarB', kind: 'jar', x: 27, y: 7, w: 1, h: 1 },
        { id: 'jarC', kind: 'jar', x: 2, y: 11, w: 1, h: 1 },
        { id: 'jarD', kind: 'jar', x: 27, y: 11, w: 1, h: 1 },
        { id: 'crate', kind: 'crate', x: 26, y: 10, w: 1, h: 1 },
        { id: 'shelfC', kind: 'shelf', x: 2, y: 13, w: 3, h: 1 },
        { id: 'shelfD', kind: 'shelf', x: 25, y: 13, w: 3, h: 1 }
      ],
      /* 沈伯站在柜台之后（y=5，柜台 y=6）。室内 y<5 的话头顶会被顶部 HUD 压住，
         连任务标记都会藏进 HUD 里，所以掌柜一律摆到 y≥5。 */
      npcs: [
        { id: 'shenbo', kind: 'elder', name: '沈伯', portrait: 'shenbo',
          x: 13, y: 5, act: 'shenbo' }
      ],
      exits: [ { x0: 14, x1: 15, y: 16, to: 'town', spawn: { x: 17, y: 12 }, label: '出门' } ]
    },

    town_market: {
      id: 'town_market', w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
      label: '刘记杂货', spawn: { x: 15, y: 14 },
      furn: [
        { id: 'crateA', kind: 'crate', x: 2, y: 3, w: 1, h: 1 },
        { id: 'crateB', kind: 'crate', x: 3, y: 3, w: 1, h: 1 },
        { id: 'crateC', kind: 'crate', x: 2, y: 4, w: 1, h: 1 },
        { id: 'crateD', kind: 'crate', x: 4, y: 3, w: 1, h: 1 },
        { id: 'crateE', kind: 'crate', x: 25, y: 3, w: 1, h: 1 },
        { id: 'crateF', kind: 'crate', x: 26, y: 3, w: 1, h: 1 },
        { id: 'crateG', kind: 'crate', x: 25, y: 4, w: 1, h: 1 },
        { id: 'lanternL', kind: 'lantern', x: 1, y: 7, w: 1, h: 2 },
        { id: 'lanternR', kind: 'lantern', x: 28, y: 7, w: 1, h: 2 },
        { id: 'counter', kind: 'counter', x: 10, y: 7, w: 5, h: 1, act: 'market', label: '柜台' },
        { id: 'table', kind: 'table', x: 20, y: 9, w: 3, h: 2 },
        { id: 'jarA', kind: 'jar', x: 2, y: 13, w: 1, h: 1 },
        { id: 'jarB', kind: 'jar', x: 3, y: 13, w: 1, h: 1 },
        { id: 'shelf', kind: 'shelf', x: 25, y: 13, w: 3, h: 1 }
      ],
      npcs: [
        { id: 'keeper', kind: 'keeper', name: '刘掌柜', portrait: 'keeper',
          x: 12, y: 6, act: 'market' }
      ],
      exits: [ { x0: 14, x1: 15, y: 16, to: 'town', spawn: { x: 28, y: 12 }, label: '出门' } ]
    },

    field_temple: {
      id: 'field_temple', w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
      label: '山神庙', spawn: { x: 15, y: 14 },
      furn: [
        { id: 'altar', kind: 'altar', x: 13, y: 3, w: 3, h: 2, act: 'temple', label: '神台' },
        { id: 'lanternL', kind: 'lantern', x: 4, y: 4, w: 1, h: 2 },
        { id: 'lanternR', kind: 'lantern', x: 25, y: 4, w: 1, h: 2 },
        { id: 'cushion', kind: 'cushion', x: 14, y: 7, w: 2, h: 2 },
        { id: 'jarA', kind: 'jar', x: 4, y: 13, w: 1, h: 1 },
        { id: 'jarB', kind: 'jar', x: 5, y: 13, w: 1, h: 1 },
        { id: 'crateA', kind: 'crate', x: 24, y: 13, w: 1, h: 1 },
        { id: 'crateB', kind: 'crate', x: 25, y: 12, w: 1, h: 1 }
      ],
      exits: [ { x0: 14, x1: 15, y: 16, to: 'field', spawn: { x: 41, y: 36 }, label: '出门' } ]
    }
  };

  G.Data = G.Data || {};
  G.Data.maps = maps;
})();
