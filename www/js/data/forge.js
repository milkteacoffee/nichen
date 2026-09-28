/* 炼器配方与炼制逻辑 —— 《玩法方向与四大技艺设计 v1.0》§3.4
 * · 炼器不失败，一次成一件（装备不叠加多产出）；
 * · 产物就是法宝（按 eq id 入 save.items），走三槽 save.equip 与 computeStats 的 te，
 *   装备/卸下/查看全部复用既有法宝界面，不另开管线；
 * · 材料（玄铁/精钢/兽皮/妖骨/灵羽/灵玉/道纹矿/道纹草）来自采集与战怪掉落。
 */
(function () {
  var RECIPES = [
    { id: 'qingfeng', out: 'eq_qingfeng', need: 1, mats: { '玄铁': 3, '精钢': 2 }, d: '攻 +10%' },
    { id: 'huxin', out: 'fq_huxin', need: 1, mats: { '玄铁': 2, '灵玉': 1 }, d: '防 +10%' },
    { id: 'jifeng', out: 'fq_jifeng', need: 37, mats: { '兽皮': 2, '灵羽': 2 }, d: '速 +12%' },
    { id: 'hanyue', out: 'fq_hanyue', need: 37, mats: { '玄铁': 4, '精钢': 3, '妖骨': 1 }, d: '攻 +14% 暴 +2%' },
    { id: 'xuangui', out: 'fq_xuangui', need: 73, mats: { '玄铁': 3, '兽皮': 2, '灵玉': 1 }, d: '防 +16% 血 +8%' },
    { id: 'juling', out: 'fq_juling', need: 109, mats: { '灵玉': 2, '灵羽': 1 }, d: '血 +12% 速 +5%' },
    { id: 'daowenjia', out: 'fq_daowenjia', need: 577, mats: { '道纹矿': 3, '道纹草': 2 }, d: '防 +20% 血 +12%' },
    { id: 'daowen', out: 'fq_daowen', need: 577, mats: { '道纹矿': 3, '道纹草': 2 }, d: '攻 +20% 暴 +5%' }
  ];

  function canForge(save, r) {
    if ((save.globalLevel || 1) < r.need) return { ok: false, reason: '境界不足' };
    for (var k in r.mats) {
      if ((save.items[k] || 0) < r.mats[k]) return { ok: false, reason: '材料不足' };
    }
    return { ok: true };
  }

  function forge(save, r) {
    var c = canForge(save, r);
    if (!c.ok) return c;
    for (var k in r.mats) {
      save.items[k] -= r.mats[k];
      if (save.items[k] <= 0) delete save.items[k];
    }
    save.items[r.out] = (save.items[r.out] || 0) + 1;
    G.Storage.saveCurrent(save);
    return { ok: true };
  }

  function matsText(save, r) {
    var parts = [];
    for (var k in r.mats) parts.push(k + ' ' + (save.items[k] || 0) + '/' + r.mats[k]);
    return parts.join(' · ');
  }

  function outName(r) {
    var eq = G.Data.equips && G.Data.equips.byId(r.out);
    return eq ? eq.n : r.out;
  }

  G.Data.forge = RECIPES;
  G.Forge = { recipes: RECIPES, canForge: canForge, forge: forge, matsText: matsText, outName: outName };
})();
