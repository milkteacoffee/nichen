/* 炼丹配方与炼制逻辑 —— 《玩法方向与四大技艺设计 v1.0》§3.3
 * · 炼丹不失败，按材料品质出 1~2 枚（25% 概率多一枚）；
 * · 材料就是 save.items 中文名物品（采集/掉落产出）；
 * · 突破丹（淬体突破丹/筑基丹/结丹丹）= 大境界破境所需的「破境丹」，
 *   给玩家一条自行炼制的获取路径，破境仍走原有心魔劫流程。
 */
(function () {
  var RECIPES = [
    { id: 'huichun', n: '回春丹', need: 1, mats: { '凝血草': 2, '灵泉水': 1 }, d: '回复四成气血' },
    { id: 'jiedu', n: '解毒丹', need: 1, mats: { '凝血草': 1, '灵泉水': 1 }, d: '解除异常状态' },
    { id: 'juqi', n: '聚气散', need: 1, mats: { '灵泉水': 3 }, d: '灵气 +500' },
    { id: 'dahuan', n: '大还丹', need: 37, mats: { '凝血草': 3, '灵泉水': 2, '妖丹': 1 }, d: '回复七成五气血' },
    { id: 'xingshen', n: '醒神散', need: 37, mats: { '灵泉水': 2, '凝血草': 1 }, d: '解除异常状态' },
    { id: 'cuiti', n: '淬体突破丹', need: 1, mats: { '凝血草': 3, '妖丹': 2 }, d: '淬体→炼气 破境丹' },
    { id: 'jiefeng', n: '解封符', need: 109, mats: { '灵玉': 1, '灵泉水': 1 }, d: '解除封印控制' },
    { id: 'zhuji', n: '筑基丹', need: 37, mats: { '百年灵芝': 1, '妖丹': 3, '灵泉水': 2 }, d: '炼气→筑基 破境丹' },
    { id: 'jiedan', n: '结丹丹', need: 73, mats: { '百年灵芝': 2, '妖丹': 5, '灵玉': 1 }, d: '筑基→金丹 破境丹' },
    { id: 'daowen', n: '道纹丹', need: 577, mats: { '道纹草': 2, '道纹矿': 1 }, d: '道界疗伤 · 回复六成' }
  ];

  function canCraft(save, r) {
    /* v0.60 须先拜师学炼丹（用户第 7 点）：入门方炼凡丹，精通炼灵丹，宗师炼仙丹 */
    var needLv = r.need >= 577 ? 3 : r.need >= 37 ? 2 : 1;
    if (G.Professions.levelOf(save, 'alchemy') < needLv)
      return { ok: false, reason: '未得丹师传授（洞府→拜师）' };
    if ((save.globalLevel || 1) < r.need) return { ok: false, reason: '境界不足' };
    for (var k in r.mats) {
      if ((save.items[k] || 0) < r.mats[k]) return { ok: false, reason: '材料不足' };
    }
    return { ok: true };
  }

  function craft(save, r) {
    var c = canCraft(save, r);
    if (!c.ok) return c;
    for (var k in r.mats) {
      save.items[k] -= r.mats[k];
      if (save.items[k] <= 0) delete save.items[k];
    }
    var cnt = 1 + (Math.random() < 0.25 ? 1 : 0);
    save.items[r.n] = (save.items[r.n] || 0) + cnt;
    G.Storage.saveCurrent(save);
    return { ok: true, n: cnt };
  }

  function matsText(save, r) {
    var parts = [];
    for (var k in r.mats) {
      parts.push(k + ' ' + (save.items[k] || 0) + '/' + r.mats[k]);
    }
    return parts.join(' · ');
  }

  G.Data.alchemy = RECIPES;
  G.Alchemy = { recipes: RECIPES, canCraft: canCraft, craft: craft, matsText: matsText };
})();
