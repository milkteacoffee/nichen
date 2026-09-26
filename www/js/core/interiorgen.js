/* 建筑内部程序化生成 —— 《逆尘》四界区域与副本落位设计 v1.0 §5
 *
 * 一个建筑类型 = 一套模板（尺寸 + 家具布局 + NPC 位）。室内 map id = int.<regionId>.<buildingId>。
 * 种子 = worldSeed + ':' + interiorId，同世重进同一栋建筑布局完全一致。
 *
 * 硬约束（沿用既有室内契约，见 tools/smoke.js 的 indoor 断言）：
 *   · 必须有出口，且出口格不被实心堵死；出口指向真实场景
 *   · 家具 y ≥ 3（顶部 0—2 行会被 HUD 盖住）、逐格实心、逐格登记 furn 交互点
 *   · 至少一件家具有 act
 *   · NPC y ≥ 5（同理），且不压家具/出口
 */
(function () {
  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function F(id, kind, x, y, w, h, act, label) {
    return { id: id, kind: kind, x: x, y: y, w: w, h: h, act: act || null, label: label || null };
  }

  /* ===== 9 类模板 ===== */
  var TPL = {
    /* 民居：床 + 方桌 + 蒲团 + 箱瓮 + 屏风 */
    home: {
      w: 24, h: 17, title: '民居', npc: { x: 5, y: 7, kind: 'villager', name: '户主' },
      furn: [
        F('bed', 'bed', 2, 3, 3, 2), F('lantern', 'lantern', 6, 3, 1, 2),
        F('table', 'table', 7, 5, 3, 2, 'sit', '方桌'), F('cushion', 'cushion', 11, 5, 2, 2),
        F('crate', 'crate', 18, 3, 1, 1), F('jar', 'jar', 20, 4, 1, 1),
        F('screen', 'screen', 16, 12, 4, 1)
      ]
    },
    /* 杂货铺：柜台 + 货架 + 箱瓮 */
    shop: {
      w: 30, h: 17, title: '杂货铺', npc: { x: 13, y: 5, kind: 'keeper', name: '掌柜' },
      furn: [
        F('shelfL', 'shelf', 2, 3, 3, 1), F('shelfR', 'shelf', 25, 3, 3, 1),
        F('lanternL', 'lantern', 1, 7, 1, 2), F('lanternR', 'lantern', 28, 7, 1, 2),
        F('counter', 'counter', 11, 7, 5, 1, 'trade', '柜台'),
        F('crateA', 'crate', 3, 11, 1, 1), F('crateB', 'crate', 4, 11, 1, 1),
        F('jarA', 'jar', 25, 11, 1, 1), F('jarB', 'jar', 26, 11, 1, 1)
      ]
    },
    /* 客栈：柜台 + 四床 + 两桌 */
    inn: {
      w: 30, h: 17, title: '客栈', npc: { x: 13, y: 5, kind: 'keeper', name: '店小二' },
      furn: [
        F('bedA', 'bed', 2, 3, 3, 2), F('bedB', 'bed', 2, 11, 3, 2),
        F('bedC', 'bed', 25, 3, 3, 2), F('bedD', 'bed', 25, 11, 3, 2),
        F('lanternL', 'lantern', 1, 7, 1, 2), F('lanternR', 'lantern', 28, 7, 1, 2),
        F('counter', 'counter', 11, 7, 5, 1, 'inn', '柜台'),
        F('tableA', 'table', 7, 12, 3, 2), F('tableB', 'table', 20, 12, 3, 2)
      ]
    },
    /* 药铺：药柜 + 柜台 + 瓮 */
    apothecary: {
      w: 30, h: 17, title: '药铺', npc: { x: 13, y: 5, kind: 'elder', name: '药师' },
      furn: [
        F('shelfL', 'shelf', 2, 3, 3, 1), F('shelfR', 'shelf', 25, 3, 3, 1),
        F('lanternL', 'lantern', 1, 7, 1, 2),
        F('counter', 'counter', 11, 7, 5, 1, 'trade', '柜台'),
        F('table', 'table', 6, 12, 3, 2),
        F('jarA', 'jar', 20, 12, 1, 1), F('jarB', 'jar', 21, 12, 1, 1)
      ]
    },
    /* 铁匠铺：铁砧（柜台）+ 货架 + 箱 */
    smithy: {
      w: 24, h: 17, title: '铁匠铺', npc: { x: 11, y: 5, kind: 'keeper', name: '铁匠' },
      furn: [
        F('shelf', 'shelf', 2, 3, 3, 1),
        F('crateA', 'crate', 18, 3, 1, 1), F('crateB', 'crate', 19, 3, 1, 1),
        F('anvil', 'counter', 9, 6, 5, 1, 'forge', '铁砧'),
        F('lantern', 'lantern', 2, 10, 1, 2)
      ]
    },
    /* 丹房：丹炉（瓮）+ 药柜 + 蒲团 */
    alchemy: {
      w: 24, h: 17, title: '丹房', npc: { x: 6, y: 5, kind: 'elder', name: '丹师' },
      furn: [
        F('shelfL', 'shelf', 2, 3, 3, 1), F('shelfR', 'shelf', 19, 3, 3, 1),
        F('furnace', 'vessel', 10, 6, 2, 2, 'brew', '丹炉'),
        F('cushionA', 'cushion', 4, 12, 2, 2), F('cushionB', 'cushion', 18, 12, 2, 2),
        F('lantern', 'lantern', 11, 3, 1, 2)
      ]
    },
    /* 神殿/庙：神台 + 蒲团 + 供桌 */
    temple: {
      w: 30, h: 17, title: '神殿', npc: { x: 6, y: 5, kind: 'elder', name: '庙祝' },
      furn: [
        F('altar', 'altar', 13, 3, 3, 2, 'pray', '神台'),
        F('cushionA', 'cushion', 14, 7, 2, 2),
        F('cushionB', 'cushion', 8, 12, 2, 2), F('cushionC', 'cushion', 20, 12, 2, 2),
        F('lanternL', 'lantern', 4, 4, 1, 2), F('lanternR', 'lantern', 25, 4, 1, 2),
        F('table', 'table', 25, 12, 3, 2)
      ]
    },
    /* 大殿/聚义厅：主座（柜台）+ 屏风 + 长案 + 四灯 */
    hall: {
      w: 30, h: 17, title: '大殿', npc: { x: 5, y: 9, kind: 'keeper', name: '主事' },
      furn: [
        F('screen', 'screen', 13, 3, 4, 1),
        F('seat', 'counter', 12, 6, 6, 1, 'hall', '主座'),
        F('lanternA', 'lantern', 1, 4, 1, 2), F('lanternB', 'lantern', 28, 4, 1, 2),
        F('lanternC', 'lantern', 1, 12, 1, 2), F('lanternD', 'lantern', 28, 12, 1, 2),
        F('tableL', 'table', 3, 12, 3, 2), F('tableR', 'table', 24, 12, 3, 2)
      ]
    },
    /* 塔/阁：四书架 + 读案 + 蒲团 */
    tower: {
      w: 24, h: 17, title: '楼阁', npc: { x: 6, y: 10, kind: 'elder', name: '守阁' },
      furn: [
        F('shelfA', 'shelf', 2, 3, 3, 1), F('shelfB', 'shelf', 19, 3, 3, 1),
        F('shelfC', 'shelf', 2, 12, 3, 1), F('shelfD', 'shelf', 19, 12, 3, 1),
        F('desk', 'table', 10, 6, 3, 2, 'read', '书案'),
        F('cushion', 'cushion', 6, 6, 2, 2), F('lantern', 'lantern', 11, 3, 1, 2)
      ]
    },
    /* 门楼/守卫所：哨位（柜台）+ 兵器架（货架）+ 箱 */
    gatepost: {
      w: 24, h: 17, title: '守卫所', npc: { x: 11, y: 5, kind: 'keeper', name: '守卫' },
      furn: [
        F('rack', 'shelf', 2, 3, 3, 1),
        F('crate', 'crate', 20, 3, 1, 1),
        F('post', 'counter', 9, 6, 5, 1, 'guard', '哨位'),
        F('lantern', 'lantern', 2, 10, 1, 2),
        F('table', 'table', 18, 12, 3, 2)
      ]
    }
  };

  /* 建筑类型 → 模板（gate/cave_mouth 等归到最近的一类） */
  var KIND2TPL = {
    house: 'home', inn: 'inn', shop: 'shop', apothecary: 'apothecary',
    smithy: 'smithy', alchemy: 'alchemy', temple: 'temple', hall: 'hall',
    tower: 'tower', gate: 'gatepost'
  };

  function build(save, interiorId, structure, region) {
    var tpl = TPL[KIND2TPL[structure.bk] || 'home'];
    var rng = new G.RNG(hashStr(save.worldSeed + ':' + interiorId));
    var w = tpl.w, h = tpl.h;
    var cx = Math.floor(w / 2);

    var ground = [];
    for (var y = 0; y < h; y++) {
      ground[y] = [];
      for (var x = 0; x < w; x++) ground[y][x] = { t: 'floor', v: rng.int(0, 5) };
    }

    /* 出口开在南墙正中，回原区域；落点 = 建筑门格正下方（区域地图里那格必然可行走） */
    var door = { x: structure.x + Math.floor(structure.w / 2), y: structure.y + structure.h };
    var exits = [{ x0: cx - 1, x1: cx + 1, y: h - 1, to: region.map || region.id, spawn: door, label: region.n }];

    /* 家具：深拷贝模板，label 带上建筑名 */
    var furn = tpl.furn.map(function (f) {
      return { id: f.id, kind: f.kind, x: f.x, y: f.y, w: f.w, h: f.h, act: f.act,
               label: f.label ? (structure.n + '·' + f.label) : null };
    });

    /* NPC：站在模板指定点，绝不压家具/出口 */
    var npcs = [];
    if (tpl.npc) {
      var nx = tpl.npc.x, ny = tpl.npc.y;
      var blocked = false;
      furn.forEach(function (f) {
        if (nx >= f.x && nx < f.x + f.w && ny >= f.y && ny < f.y + f.h) blocked = true;
      });
      if (ny < 5) ny = 5;
      if (!blocked && nx > 0 && nx < w - 1 && ny > 0 && ny < h - 2) {
        npcs.push({ id: 'n1', kind: tpl.npc.kind, name: structure.n + '·' + tpl.npc.name,
                    portrait: tpl.npc.kind, x: nx, y: ny, act: 'chat.villager' });
      }
    }

    return {
      id: interiorId, interiorId: interiorId, indoor: true, safe: true,
      n: structure.n, label: structure.n,
      w: w, h: h, ground: 'floor',
      furn: furn, npcs: npcs, exits: exits,
      spawn: { x: cx, y: h - 2 }
    };
  }

  /* 注册（幂等）：同时建好场景，changeScene 才找得到 */
  function ensure(save, interiorId, structure, region) {
    if (!save || !structure || !region) return null;
    if (!G.Data.maps[interiorId]) G.Data.maps[interiorId] = build(save, interiorId, structure, region);
    sceneFor(interiorId);
    return G.Data.maps[interiorId];
  }

  function sceneFor(interiorId) {
    if (G.scenes[interiorId]) return G.scenes[interiorId];
    var hooks = {
      menu: function (s) { G.TianDao.openSettings(s); },
      overlayTap: G.TianDao.overlayTap,
      overlayKey: G.TianDao.overlayKey,
      onInteract: function (o, s) {
        if (!o || o.type !== 'furn') return;
        var act = o.act || '';
        if (act === 'trade' || act === 'inn' || act === 'forge' || act === 'brew') {
          G.game.toast('（' + (o.label || '柜台') + '）铺子尚未开张');
        } else if (act === 'pray') {
          G.game.toast('你对着神台上了一炷香');
        } else if (act === 'sit' || act === 'read' || act === 'hall' || act === 'guard') {
          G.game.toast('（' + (o.label || '') + '）没什么可做的');
        }
      },
      renderOverlay: function (x, s) {
        G.Overlays.route(x, s);
      }
    };
    var sc = G.Explore.create(interiorId, hooks);
    G.scenes[interiorId] = sc;
    return sc;
  }

  G.InteriorGen = {
    build: build,
    ensure: ensure,
    sceneFor: sceneFor,
    templates: TPL,
    kindToTemplate: KIND2TPL
  };
})();
