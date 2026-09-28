/* 采集与材料系统 —— 《玩法方向与四大技艺设计 v1.0》§3.1/§3.2
 *
 * · 常见材料在各室外地图的**采集点**产出（与宝箱同级的可交互物），每个采集点每**游戏日**可采一次；
 * · 材料按界分层（凡/灵/仙/道），类别分 草药/矿石/玉/木料，按地图地表偏向选取；
 * · 材料就是 save.items 里按中文名存放的物品（与妖丹同模型），**不进战斗消耗品表**；
 * · 刷新只认游戏内 save.day（榻上安歇跨日 +1），不读 Date.now()，回归基线不被时间污染。
 */
(function () {
  var MATERIALS = [
    { id: 'herb.blood', n: '凝血草', worlds: ['fan', 'ling'], cat: 'herb' },
    { id: 'herb.spirit', n: '灵泉水', worlds: ['fan', 'ling', 'xian'], cat: 'herb' },
    { id: 'herb.lingzhi', n: '百年灵芝', worlds: ['ling', 'xian'], cat: 'herb' },
    { id: 'ore.iron', n: '玄铁', worlds: ['fan', 'ling', 'xian'], cat: 'ore' },
    { id: 'ore.steel', n: '精钢', worlds: ['fan', 'ling'], cat: 'ore' },
    { id: 'gem.spirit', n: '灵玉', worlds: ['ling', 'xian'], cat: 'gem' },
    { id: 'wood.iron', n: '铁木', worlds: ['fan', 'ling'], cat: 'wood' },
    { id: 'herb.dao', n: '道纹草', worlds: ['dao'], cat: 'herb' },
    { id: 'ore.dao', n: '道纹矿', worlds: ['dao'], cat: 'ore' }
  ];

  var NODE_N = 4;

  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function worldOf(mapId, md) {
    if (md.world) return md.world;
    if (mapId.indexOf('ling') === 0) return 'ling';
    if (mapId.indexOf('xian') === 0) return 'xian';
    if (mapId.indexOf('dao') === 0) return 'dao';
    return 'fan';   /* fan* 与手写 town/field/cave */
  }

  function materialsIn(world) {
    return MATERIALS.filter(function (m) { return m.worlds.indexOf(world) >= 0; });
  }

  /* 在已建好的地图上摆采集点（非实心、非道路、避开边界），确定性。 */
  function buildNodes(save, mapId, map) {
    var md = map.md;
    map.gatherNodes = {};
    if (md.indoor) return map.gatherNodes;
    var world = worldOf(mapId, md);
    var pool = materialsIn(world);
    if (!pool.length) return map.gatherNodes;
    var rng = new G.RNG(hashStr((save.worldSeed || '0') + ':gather:' + mapId));
    var placed = 0, tries = 0;
    while (placed < NODE_N && tries < 400) {
      tries++;
      var x = rng.int(2, map.w - 3), y = rng.int(2, map.h - 3);
      if (map.solid[y][x]) continue;
      var g = map.ground[y][x];
      if (g.t === 'path') continue;
      if (map.gatherNodes[x + ',' + y]) continue;
      /* 类别按地表偏向：草→草药；岩/洞→矿；其余在本界池内任取 */
      var cand = pool;
      if (g.t === 'grass') cand = pool.filter(function (m) { return m.cat === 'herb'; });
      else if (g.t === 'rock' || g.t === 'cave')
        cand = pool.filter(function (m) { return m.cat === 'ore' || m.cat === 'gem'; });
      if (!cand.length) cand = pool;
      var mat = cand[rng.int(0, cand.length - 1)];
      map.gatherNodes[x + ',' + y] = { idx: placed, x: x, y: y, mat: mat.n, cat: mat.cat };
      placed++;
    }
    return map.gatherNodes;
  }

  function keyOf(mapId, node) { return mapId + ':' + node.idx; }

  function gatheredToday(save, mapId, node) {
    save.day = save.day || 1;
    return !!(save.gather && save.gather[keyOf(mapId, node)] === save.day);
  }

  /* 走到采集点上：当日未采则入包并标记；已采静默。 */
  function gatherAt(save, mapId, node, scene) {
    if (gatheredToday(save, mapId, node)) return;
    save.items = save.items || {};
    var nGet = 1 + ((G.Formations && G.Formations.has(save, 'jubao')) ? 1 : 0);
    save.items[node.mat] = (save.items[node.mat] || 0) + nGet;
    save.gather = save.gather || {};
    save.gather[keyOf(mapId, node)] = save.day;
    G.Storage.saveCurrent(save);
    G.game.toast('采得 ' + node.mat + (nGet > 1 ? ' ×' + nGet : ''));
  }

  function advanceDay(save) { save.day = (save.day || 1) + 1; }

  function byName(n) {
    for (var i = 0; i < MATERIALS.length; i++) if (MATERIALS[i].n === n) return MATERIALS[i];
    return null;
  }

  /* 战怪特殊材料掉落（《四大技艺 v1.0》§3.5）：兽皮12%(兽类) / 妖骨8%(精英·Boss)
     / 灵羽6%(飞行) / 血精15%(血煞) / 道纹残片20%(道界试炼)。逐只独立判定，
     命中即入 save.items，返回 [{item,n}]。材料获取统一收口在 Gather。 */
  var RE_HUMAN = /杀手|教徒|探子|弟子|散修|修士|心魔|血面|长老|宗主|尸|傀|人|僧|尼|傀儡/;
  var RE_FLY   = /鹰|隼|鹤|雕|燕|蝠|鸾|雀|鹏|羽|鸟|凰/;
  var RE_BLOOD = /血煞|血蝠|血面|血教|血/;
  function rollOne(save, e, opts) {
    var sp = (e.species || '') + (e.name || '');
    var out = [];
    function give(item, p) { if (G.rng.next() < p) { save.items[item] = (save.items[item] || 0) + 1; out.push({ item: item, n: 1 }); } }
    if (opts.dao) { give('道纹残片', 0.20); return out; }
    if (!RE_HUMAN.test(sp)) give('兽皮', 0.12);
    if (opts.elite || e.boss) give('妖骨', 0.08);
    if (RE_FLY.test(sp)) give('灵羽', 0.06);
    if (RE_BLOOD.test(sp)) give('血精', 0.15);
    return out;
  }
  function rollDrops(save, es, opts) {
    save.items = save.items || {};
    var agg = {};
    es.forEach(function (e) {
      rollOne(save, e, opts || {}).forEach(function (g) { agg[g.item] = (agg[g.item] || 0) + g.n; });
    });
    return Object.keys(agg).map(function (item) { return { item: item, n: agg[item] }; });
  }

  /* 灵田/药圃/矿脉（四大技艺批5）：宗门后山的室内出产，每地块每游戏日一次，
     按类别在本界材料池内随机出；聚宝阵同样 +1。与采集点共用 save.gather 日历。 */
  function harvestPlot(save, plotId, cats, world) {
    save.day = save.day || 1; save.gather = save.gather || {}; save.items = save.items || {};
    if (save.gather[plotId] === save.day) { G.game.toast('今日已收，明日再来'); return { ok: false }; }
    var pool = materialsIn(world).filter(function (m) { return cats.indexOf(m.cat) >= 0; });
    if (!pool.length) { G.game.toast('此地无所出'); return { ok: false }; }
    var mat = pool[Math.floor(G.rng.next() * pool.length)];
    var nGet = 1 + ((G.Formations && G.Formations.has(save, 'jubao')) ? 1 : 0);
    save.items[mat.n] = (save.items[mat.n] || 0) + nGet;
    save.gather[plotId] = save.day;
    G.Storage.saveCurrent(save);
    G.game.toast('收得 ' + mat.n + (nGet > 1 ? ' ×' + nGet : ''));
    return { ok: true, mat: mat.n, n: nGet };
  }

  G.Gather = {
    buildNodes: buildNodes, gatherAt: gatherAt, gatheredToday: gatheredToday,
    advanceDay: advanceDay, rollDrops: rollDrops, harvestPlot: harvestPlot,
    byName: byName, materials: MATERIALS
  };
})();
