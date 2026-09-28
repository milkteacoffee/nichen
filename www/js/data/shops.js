/* 区域商店目录（R3 交易）—— 按界 + 店铺种类给可买清单与回收价。
 * 普通杂货（shop）卖丹药/材料/杂物；药铺（apothecary）偏丹药与草药。
 * 物品 id 即存档键（丹药/材料为中文名）；价格单位灵石。 */
(function () {
  function I(id, p) { return { id: id, n: id, p: p }; }
  var C = {
    fan: {
      shop: [I('回春丹', 40), I('解毒丹', 35), I('聚气散', 45), I('回城符', 25),
        I('玄铁', 60), I('精钢', 50), I('铁木', 40), I('兽皮', 30)],
      apothecary: [I('回春丹', 40), I('解毒丹', 35), I('聚气散', 45), I('醒神散', 70),
        I('凝血草', 25), I('灵泉水', 30)]
    },
    ling: {
      shop: [I('大还丹', 400), I('醒神散', 300), I('百年灵芝', 500), I('灵玉', 600),
        I('妖骨', 200), I('灵羽', 180), I('玄铁', 200), I('精钢', 180)],
      apothecary: [I('大还丹', 400), I('醒神散', 300), I('百年灵芝', 500),
        I('凝血草', 100), I('灵泉水', 120), I('解毒丹', 120)]
    },
    xian: {
      shop: [I('大还丹', 2000), I('百年灵芝', 2500), I('灵玉', 1500),
        I('妖骨', 900), I('灵羽', 800), I('玄铁', 800)],
      apothecary: [I('大还丹', 2000), I('醒神散', 1500), I('百年灵芝', 2500), I('灵泉水', 600)]
    },
    dao: {
      shop: [I('道纹丹', 8000), I('道纹草', 3000), I('道纹矿', 3500)],
      apothecary: [I('道纹丹', 8000), I('道纹草', 3000)]
    }
  };

  /* 全目录价格表（回收价依据） */
  var priceMap = {};
  Object.keys(C).forEach(function (w) {
    ['shop', 'apothecary'].forEach(function (k) {
      C[w][k].forEach(function (it) { if (priceMap[it.id] == null) priceMap[it.id] = it.p; });
    });
  });

  function isGear(id) { return /^(eq|fq)_/.test(id); }

  /* 回收价：目录内半价；装备走 equips.sell；材料按类别兜底；其余 8 灵石。 */
  function sellValue(id) {
    if (priceMap[id] != null) return Math.round(priceMap[id] * 0.5);
    if (isGear(id)) {
      var eq = G.Data.equips.byId(id);
      return (eq && eq.sell) || 40;
    }
    var m = G.Gather && G.Gather.byName ? G.Gather.byName(id) : null;
    if (m) return m.cat === 'gem' ? 120 : m.cat === 'ore' ? 25 : 12;
    return 8;
  }

  function catalog(world, kind) {
    var w = C[world] ? world : 'fan';
    return (C[w][kind] || C[w].shop).slice();
  }

  G.Data.shops = { catalogs: C, catalog: catalog, sellValue: sellValue, isGear: isGear };
})();
