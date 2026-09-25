/* 四界 28 区域规格 —— 《逆尘》四界区域与副本落位设计 v1.0 §3 / §4.1
 *
 * 这里只存"紧凑规格"，完整地图由 core/regiongen.js 确定性生成（种子 = worldSeed + ':' + regionId）。
 * · id     = 区域 id，也是生成型区域的场景 id
 * · map    = 若给出，则该区域**复用现有手写地图**（凡界 F1–F3 = town/field/cave），不参与生成
 * · exits  = { to:'<区域id>', side:'north|south|east|west' }；落点自动取目标区域对侧的 landing
 * · zones  = 遭遇分区（按 y 划分）。**不写 sp**，由 explore 回退到 save.world.beast（浮世相位），
 *            这样同一区域在不同浮世相位下的兽群构成自动不同。
 * · b      = 建筑清单 { k:建筑类型, n:名称, w,h:格数, n2:可选数量 }
 *            建筑类型 → 室内模板见 core/interiorgen.js（house/inn/shop/apothecary/smithy/
 *            alchemy/temple/hall/tower/gate）
 * · gate   = true 表示该区有「界门」（各界的首区），用于主界/回访下界之间往返
 */
(function () {
  function R(o) { return o; }
  function B(k, n, w, h, n2) { var o = { k: k, n: n, w: w, h: h }; if (n2) o.n2 = n2; return o; }

  /* ===== 凡界 9 区（gl 1–63）===== */
  var fan = [
    R({ id: 'fan1', n: '青溪镇', map: 'town', theme: '起点市镇', gate: false, exits: [], b: [] }),
    R({ id: 'fan2', n: '翠微山', map: 'field', theme: '城郊山野', gate: false, exits: [], b: [] }),
    R({ id: 'fan3', n: '赤牙洞', map: 'cave', theme: '山腹洞窟', gate: false, exits: [], b: [] }),

    /* 凡界的界门放在**落霞镇**（商旅重镇 = 交通枢纽），而不是青溪镇 ——
       青溪镇是复用现有手写地图（`town`），往里塞界门对象会动到 M0 教学链与既有测试契约。 */
    R({ id: 'fan4', n: '落霞镇', theme: '商旅重镇', w: 44, h: 28, ground: 'town', safe: true, gate: true,
        exits: [{ to: 'fan1', side: 'south' }, { to: 'fan5', side: 'east' }, { to: 'fan7', side: 'north' }, { to: 'fan8', side: 'west' }],
        b: [B('shop', '坊市', 6, 3), B('smithy', '铁匠铺', 5, 3), B('alchemy', '丹房', 5, 3),
            B('temple', '当铺', 5, 3), B('inn', '悦来客栈', 7, 4), B('inn', '同福客栈', 7, 4),
            B('house', '民居', 4, 3, 4)] }),

    R({ id: 'fan5', n: '黑风岭', theme: '匪寨山地', w: 42, h: 30, ground: 'grass', gate: false,
        exits: [{ to: 'fan4', side: 'west' }, { to: 'fan6', side: 'east' }, { to: 'fan9', side: 'north' }],
        zones: [{ id: 'low', y0: 20, y1: 29, enc: { min: 10, max: 14 }, pair: 20 },
                { id: 'high', y0: 0, y1: 19, enc: { min: 14, max: 20 }, pair: 30 }],
        b: [B('gate', '寨门楼', 6, 3), B('tower', '哨塔', 2, 3, 2),
            B('hall', '聚义厅', 8, 5), B('house', '匪舍', 4, 3, 3)] }),

    R({ id: 'fan6', n: '幽篁谷', theme: '竹谷药圃', w: 40, h: 30, ground: 'grass', gate: false,
        exits: [{ to: 'fan5', side: 'west' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 18, max: 30 }, pair: 25 }],
        b: [B('apothecary', '药圃茅庐', 5, 3), B('house', '采药人屋', 4, 3, 2), B('temple', '竹亭', 4, 3)] }),

    R({ id: 'fan7', n: '乱葬岗', theme: '荒坟鬼冢', w: 40, h: 30, ground: 'cave', gate: false,
        exits: [{ to: 'fan4', side: 'south' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 28, max: 40 }, pair: 30 }],
        b: [B('temple', '义庄', 7, 4), B('house', '守墓屋', 4, 3), B('tower', '破棺洞', 3, 3)] }),

    R({ id: 'fan8', n: '落霞灵矿', theme: '废弃灵矿', w: 42, h: 28, ground: 'cave', gate: false,
        exits: [{ to: 'fan4', side: 'east' }],
        zones: [{ id: 'all', y0: 0, y1: 27, enc: { min: 38, max: 50 }, pair: 25 }],
        b: [B('house', '矿工棚', 4, 3, 2), B('hall', '矿主宅', 7, 4), B('gate', '矿洞入口', 6, 3)] }),

    R({ id: 'fan9', n: '火云谷', theme: '地火熔岩谷', w: 42, h: 30, ground: 'cave', gate: false,
        exits: [{ to: 'fan5', side: 'south' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 48, max: 63 }, pair: 30 }],
        b: [B('alchemy', '炼丹废庐', 5, 3), B('house', '火工屋', 4, 3, 2)] })
  ];

  /* ===== 灵界 5 区（gl 64–90）===== */
  var ling = [
    R({ id: 'ling1', n: '雷泽荒原', theme: '雷雨沼泽', w: 46, h: 32, ground: 'grass', gate: true,
        exits: [{ to: 'ling2', side: 'north' }, { to: 'ling3', side: 'east' }],
        zones: [{ id: 'low', y0: 18, y1: 31, enc: { min: 64, max: 68 }, pair: 20 },
                { id: 'high', y0: 0, y1: 17, enc: { min: 68, max: 70 }, pair: 30 }],
        b: [B('tower', '观雷台', 4, 4), B('hall', '雷池守卫所', 8, 5), B('gate', '界门', 6, 4)] }),

    R({ id: 'ling2', n: '寒渊水府', theme: '深水宫阙', w: 44, h: 30, ground: 'cave', gate: false,
        exits: [{ to: 'ling1', side: 'south' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 68, max: 76 }, pair: 25 }],
        b: [B('hall', '水府正殿', 9, 5), B('house', '鲛人厢房', 4, 3, 2), B('tower', '藏珍阁', 4, 4)] }),

    R({ id: 'ling3', n: '血煞总坛', theme: '邪教总坛', w: 46, h: 30, ground: 'town', gate: false,
        exits: [{ to: 'ling1', side: 'west' }, { to: 'ling4', side: 'north' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 74, max: 82 }, pair: 30 }],
        b: [B('hall', '血煞大殿', 9, 5), B('temple', '祭坛', 6, 4), B('gate', '刑牢', 6, 3),
            B('house', '执事房', 4, 3, 2)] }),

    R({ id: 'ling4', n: '黄沙古堡', theme: '荒漠遗迹', w: 46, h: 32, ground: 'grass', gate: false,
        exits: [{ to: 'ling3', side: 'south' }, { to: 'ling5', side: 'east' }],
        zones: [{ id: 'all', y0: 0, y1: 31, enc: { min: 80, max: 86 }, pair: 30 }],
        b: [B('hall', '古堡主楼', 9, 5), B('tower', '风蚀哨塔', 3, 4, 2), B('inn', '商队客栈', 7, 4)] }),

    R({ id: 'ling5', n: '云海剑冢', theme: '剑修遗迹', w: 44, h: 30, ground: 'grass', gate: false,
        exits: [{ to: 'ling4', side: 'west' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 85, max: 90 }, pair: 35 }],
        b: [B('tower', '剑阁', 5, 5), B('house', '守冢庐', 4, 3), B('tower', '藏剑楼', 5, 5)] })
  ];

  /* ===== 仙界 9 区（gl 91–144）===== */
  var xian = [
    R({ id: 'xian1', n: '南天门', theme: '天宫门户', w: 46, h: 30, ground: 'town', safe: true, gate: true,
        exits: [{ to: 'xian2', side: 'north' }],
        b: [B('hall', '镇门殿', 9, 5), B('house', '天兵营', 5, 3, 2), B('gate', '界门', 6, 4)] }),

    R({ id: 'xian2', n: '瑶池仙境', theme: '仙池园囿', w: 46, h: 32, ground: 'grass', safe: true, gate: false,
        exits: [{ to: 'xian1', side: 'south' }, { to: 'xian3', side: 'east' }],
        b: [B('temple', '瑶池亭', 6, 4), B('tower', '仙鹤苑', 4, 4), B('house', '侍女所', 4, 3, 2)] }),

    R({ id: 'xian3', n: '兜率天宫', theme: '丹炉道宫', w: 46, h: 30, ground: 'town', gate: false,
        exits: [{ to: 'xian2', side: 'west' }, { to: 'xian4', side: 'north' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 106, max: 116 }, pair: 30 }],
        b: [B('alchemy', '丹房', 6, 4), B('hall', '炉鼎殿', 9, 5), B('tower', '藏丹阁', 5, 5)] }),

    R({ id: 'xian4', n: '星河渡', theme: '星海渡口', w: 46, h: 32, ground: 'grass', gate: false,
        exits: [{ to: 'xian3', side: 'south' }, { to: 'xian5', side: 'east' }],
        zones: [{ id: 'all', y0: 0, y1: 31, enc: { min: 114, max: 124 }, pair: 30 }],
        b: [B('inn', '渡口栈', 7, 4), B('tower', '观星台', 5, 5), B('gate', '星舟坞', 6, 3)] }),

    R({ id: 'xian5', n: '蟠桃园', theme: '仙果园囿', w: 46, h: 32, ground: 'grass', gate: false,
        exits: [{ to: 'xian4', side: 'west' }, { to: 'xian6', side: 'north' }],
        zones: [{ id: 'all', y0: 0, y1: 31, enc: { min: 120, max: 130 }, pair: 30 }],
        b: [B('gate', '园门楼', 6, 3), B('house', '看守所', 4, 3, 2), B('tower', '果窖', 4, 4)] }),

    R({ id: 'xian6', n: '斩仙台', theme: '天宫刑台', w: 44, h: 30, ground: 'town', gate: false,
        exits: [{ to: 'xian5', side: 'south' }, { to: 'xian7', side: 'east' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 126, max: 134 }, pair: 35 }],
        b: [B('hall', '刑台殿', 9, 5), B('tower', '锁仙柱廊', 5, 5), B('gate', '监牢', 6, 3)] }),

    R({ id: 'xian7', n: '广寒宫', theme: '月宫寒阙', w: 44, h: 30, ground: 'cave', gate: false,
        exits: [{ to: 'xian6', side: 'west' }, { to: 'xian8', side: 'north' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 132, max: 138 }, pair: 30 }],
        b: [B('hall', '月殿', 9, 5), B('temple', '桂树苑', 6, 4), B('tower', '寒窟', 4, 4)] }),

    R({ id: 'xian8', n: '天枢阁', theme: '天规藏经', w: 44, h: 30, ground: 'town', gate: false,
        exits: [{ to: 'xian7', side: 'south' }, { to: 'xian9', side: 'east' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 136, max: 141 }, pair: 30 }],
        b: [B('tower', '经阁', 5, 5), B('temple', '天规碑亭', 5, 4), B('tower', '书楼', 5, 5)] }),

    R({ id: 'xian9', n: '九霄云台', theme: '雷部演武', w: 44, h: 30, ground: 'grass', gate: false,
        exits: [{ to: 'xian8', side: 'west' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 140, max: 144 }, pair: 35 }],
        b: [B('hall', '演武场', 9, 5), B('tower', '雷台', 5, 5), B('gate', '云梯楼', 6, 4)] })
  ];

  /* ===== 道界 5 区（gl 145–171；固定试炼，不走随机池）===== */
  var dao = [
    R({ id: 'dao1', n: '道则回廊', theme: '回廊入口', w: 44, h: 30, ground: 'town', safe: true, gate: true,
        exits: [{ to: 'dao2', side: 'north' }],
        b: [B('temple', '道碑亭', 6, 4), B('house', '守关庐', 4, 3), B('gate', '界门', 6, 4)] }),

    R({ id: 'dao2', n: '斩尸崖', theme: '斩三尸', w: 42, h: 30, ground: 'cave', gate: false,
        exits: [{ to: 'dao1', side: 'south' }, { to: 'dao3', side: 'north' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 150, max: 155 }, pair: 35 }],
        b: [B('temple', '斩尸台', 7, 4), B('house', '静室', 4, 3, 2)] }),

    R({ id: 'dao3', n: '功德海', theme: '功德道相', w: 44, h: 30, ground: 'grass', gate: false,
        exits: [{ to: 'dao2', side: 'south' }, { to: 'dao4', side: 'north' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 155, max: 162 }, pair: 35 }],
        b: [B('temple', '功德莲台', 7, 4), B('tower', '功德碑廊', 5, 5)] }),

    R({ id: 'dao4', n: '混沌渊', theme: '大道化身', w: 42, h: 30, ground: 'cave', gate: false,
        exits: [{ to: 'dao3', side: 'south' }, { to: 'dao5', side: 'north' }],
        zones: [{ id: 'all', y0: 0, y1: 29, enc: { min: 162, max: 168 }, pair: 35 }],
        b: [B('temple', '混沌窟', 7, 4), B('tower', '道则傀儡台', 5, 5)] }),

    R({ id: 'dao5', n: '合道台', theme: '合道终点', w: 42, h: 30, ground: 'town', safe: true, gate: false,
        exits: [{ to: 'dao4', side: 'south' }],
        b: [B('hall', '合道台', 9, 5), B('gate', '大道之门', 6, 4)] })
  ];

  var byWorld = { fan: fan, ling: ling, xian: xian, dao: dao };
  var index = {};
  ['fan', 'ling', 'xian', 'dao'].forEach(function (wid) {
    byWorld[wid].forEach(function (r) { r.world = wid; index[r.id] = r; });
  });

  G.Data = G.Data || {};
  G.Data.regions = {
    byWorld: byWorld,
    index: index,
    worldNames: { fan: '凡界', ling: '灵界', xian: '仙界', dao: '道界' },
    /* 该界的区域数组 */
    of: function (worldId) { return byWorld[worldId] || []; },
    /* 单个区域规格 */
    byId: function (regionId) { return index[regionId] || null; },
    /* 区域 → 实际场景 id（凡界 F1–F3 复用现有手写地图） */
    mapIdOf: function (regionId) {
      var r = index[regionId];
      return r ? (r.map || r.id) : null;
    },
    /* 反向：场景 id → 区域 id（town → fan1） */
    regionIdOf: function (mapId) {
      var found = null;
      Object.keys(index).forEach(function (k) {
        if ((index[k].map || index[k].id) === mapId) found = k;
      });
      return found;
    },
    all: function () {
      return fan.concat(ling, xian, dao);
    },

    /* ===== 天道随机（设计 §2.2 / §6.1）=====
       主界：已解锁界中「未通关的界优先」抽 1 —— 保证主线能推进，不会反复回已通关的凡界。
       入口：从主界区域**无放回抽 5 个**作为落位点；副本原型顺序由 dungeons.rollSet() 给出
             （2 大 3 小、第 5 必大）。槽位决定 Boss gl，所以随机顺序不会崩坏数值。
       道界例外：不抽随机池，5 个区域对应固定试炼（副本 v3.2 §6.3）。 */
    rollMainWorld: function (meta) {
      var pr = (meta && meta.progress) || {};
      var wd = pr.worlds || {};
      var unlocked = ['fan'];
      if (wd.ling) unlocked.push('ling');
      if (wd.xian) unlocked.push('xian');
      if (pr.daoKey) unlocked.push('dao');
      var pending = unlocked.filter(function (w) { return !(wd[w] && wd[w].cleared); });
      var pool = pending.length ? pending : unlocked;
      return pool[G.rng.int(0, pool.length - 1)];
    },

    /* 入口落位候选：**只落在生成型、非安全区**的区域。
       理由（设计 §6.1）：
         · 安全区（市镇 / 天宫门阙等）是休整与交易的地方，不该冒出秘境裂隙；
         · 凡界 F1–F3 是教学锚定区（复用现有手写地图），也不设裂隙。
       凡界候选 = 5、灵界 = 5、仙界 = 7，都够抽 5 个。 */
    entranceCandidates: function (worldId) {
      var all = byWorld[worldId] || [];
      var gen = all.filter(function (r) { return !r.map && !r.safe; });
      if (gen.length >= 5) return gen;
      var nonSafe = all.filter(function (r) { return !r.safe; });
      return nonSafe.length >= 5 ? nonSafe : all;
    },

    rollEntrances: function (worldId, seed, set) {
      var list = G.Data.regions.entranceCandidates(worldId);
      if (!list.length) return [];
      var n = Math.min(5, list.length);
      /* seed 给了 → 区域抽签也走种子：同一世同一界的落位可复现（缺口 U8）。
         不给则用全局 rng（无头测试靠它覆盖随机性）。 */
      var rng = seed == null ? G.rng : new G.RNG(G.RNG.hash(seed + ':' + worldId + ':ent'));
      var picked = rng.sampleIndices(n, list.length).map(function (i) { return list[i]; });
      if (worldId === 'dao') {
        return picked.map(function (r, i) {
          return { slot: i, arch: null, region: r.id, stage: 0, fixed: true };
        });
      }
      /* set 给了就**复用调用方的副本序列**（缺口 G20）：否则区域裂隙显示的副本
         与秘境枢纽的槽位来自两次独立随机，玩家会看到"裂隙点进去是万骨渊、
         枢纽里第 3 槽却是黑风寨"。 */
      var seq = set || G.Data.dungeons.rollSet(seed == null ? null : seed + ':' + worldId + ':set');
      return picked.map(function (r, i) {
        return { slot: i, arch: seq[i], region: r.id, stage: 0 };
      });
    }
  };
})();
