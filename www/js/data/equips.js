/* 法宝（装备）—— 武器 / 防具 / 饰品 三槽
 *
 * 用户口径：「这个人物少了三个法宝格子，武器、防具、饰品」。
 *
 * 设计要点：
 *   · **三槽**：`save.equip = { weapon, armor, accessory }`，每槽一件。
 *   · 法宝**就是道具**（存在 `save.items` 里，`>0` 即拥有）——
 *     不另立一套背包，否则"储物页看不到法宝"必然出问题。
 *   · 加成**并进 `computeStats` 的 `te`**（与副本三选一同一条路）：
 *     一处生效 → 面板 / HUD / 战斗三处自动都认到。
 *     ⚠️ 效果字段必须落在 `te` 的已知集合里（`a/f/h/s/c/cd/vamp`）——
 *        写错字段名会**静默不生效**，契约 `equip.contract` 会拦。
 *   · 品阶 `tier` 只影响数值档位与后续掉落池，不参与判定。
 */
(function () {
  var SLOT_N = { weapon: '武器', armor: '防具', accessory: '饰品' };

  var LIST = [
    /* 武器：偏攻击 */
    { id: 'eq_qingfeng', n: '青锋剑', slot: 'weapon', tier: '凡',
      d: '青溪镇上铁匠打的凡铁剑。', fx: { a: 0.10 } },
    { id: 'eq_chixiao', n: '赤霄刀', slot: 'weapon', tier: '灵',
      d: '刀身赤红，出鞘带火气。', fx: { a: 0.18, c: 0.04 } },
    /* 防具：偏防御与气血 */
    { id: 'eq_bujia', n: '粗布甲', slot: 'armor', tier: '凡',
      d: '粗麻织成，聊胜于无。', fx: { f: 0.12 } },
    { id: 'eq_xuanwu', n: '玄武甲', slot: 'armor', tier: '灵',
      d: '玄龟背甲所制，沉而坚。', fx: { f: 0.22, h: 0.10 } },
    /* 饰品：偏速度与暴击 */
    { id: 'eq_yupei', n: '暖玉佩', slot: 'accessory', tier: '凡',
      d: '常年贴身，温润养气。', fx: { h: 0.08, s: 0.06 } },
    { id: 'eq_lingdang', n: '摄魂铃', slot: 'accessory', tier: '灵',
      d: '铃声一响，心神失守。', fx: { c: 0.06, cd: 0.15 } }
  ];

  var index = {};
  LIST.forEach(function (e) { index[e.id] = e; });

  G.Data = G.Data || {};
  G.Data.equips = {
    SLOT_N: SLOT_N,
    SLOTS: ['weapon', 'armor', 'accessory'],
    list: LIST,
    byId: function (id) { return index[id] || null; },
    /* 该槽可用的全部法宝 */
    ofSlot: function (slot) {
      return LIST.filter(function (e) { return e.slot === slot; });
    },
    /* 把三槽的加成汇总成 {a,f,h,s,c,cd,vamp}（与 dungeonBuffs.sum 同形） */
    sum: function (equip) {
      var o = { a: 0, f: 0, h: 0, s: 0, c: 0, cd: 0, vamp: 0 };
      if (!equip) return o;
      Object.keys(equip).forEach(function (slot) {
        var e = index[equip[slot]];
        if (!e) return;
        Object.keys(e.fx).forEach(function (k) { o[k] = (o[k] || 0) + e.fx[k]; });
      });
      return o;
    }
  };
})();
