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

  /* 16 件法宝 —— 类型覆盖刀枪剑戟 / 布甲重甲法衣 / 玉佩佛珠项链铃 等
     （用户口径：「记得富化一下文生图的法宝样式，刀枪剑戟、项链、佛珠、玉佩、法衣、盔甲等等」）。
     图标见 `assets/img/equip.<id>.png`（文生图 4×4 图标集切片）。 */
  var LIST = [
    /* 武器：刀枪剑戟 */
    { id: 'eq_qingfeng', n: '青锋剑', slot: 'weapon', tier: '凡',
      grade: '下品',
      d: '青溪镇上铁匠打的凡铁剑。', fx: { a: 0.10 } },
    { id: 'eq_chixiao', n: '赤霄刀', slot: 'weapon', tier: '灵',
      grade: '上品',
      d: '刀身赤红，出鞘带火气。', fx: { a: 0.16, c: 0.04 } },
    { id: 'eq_dianqiang', n: '点钢枪', slot: 'weapon', tier: '灵',
      grade: '极品',
      d: '枪尖一点寒，最擅破甲。', fx: { a: 0.14, cd: 0.12 } },
    { id: 'eq_fangtian', n: '方天戟', slot: 'weapon', tier: '宝',
      grade: '玄级',
      d: '戟沉力猛，一击之威冠绝同阶。', fx: { a: 0.22, s: -0.04 } },
    /* 防具：布甲 / 重甲 / 法衣 / 护腕 */
    { id: 'eq_bujia', n: '粗布甲', slot: 'armor', tier: '凡',
      grade: '下品',
      d: '粗麻织成，聊胜于无。', fx: { f: 0.12 } },
    { id: 'eq_xuanwu', n: '玄武甲', slot: 'armor', tier: '灵',
      grade: '极品',
      d: '玄龟背甲所制，沉而坚。', fx: { f: 0.22, h: 0.10 } },
    { id: 'eq_fayi', n: '云纹法衣', slot: 'armor', tier: '灵',
      grade: '上品',
      d: '道袍绣云纹，行气最顺。', fx: { f: 0.10, h: 0.16 } },
    { id: 'eq_huwan', n: '皮护腕', slot: 'armor', tier: '凡',
      grade: '中品',
      d: '护住手腕，出手更稳。', fx: { f: 0.08, c: 0.03 } },
    /* 饰品：玉佩 / 铃 / 佛珠 / 项链 / 罗盘 / 如意 / 铜镜 / 葫芦 */
    { id: 'eq_yupei', n: '暖玉佩', slot: 'accessory', tier: '凡',
      grade: '中品',
      d: '常年贴身，温润养气。', fx: { h: 0.08, s: 0.06 } },
    { id: 'eq_soulbell', n: '摄魂铃', slot: 'accessory', tier: '灵',
      grade: '黄级',
      d: '铃声一响，心神失守。', fx: { c: 0.06, cd: 0.15 } },
    { id: 'eq_fozhu', n: '菩提佛珠', slot: 'accessory', tier: '灵',
      grade: '上品',
      d: '一百零八颗，捻之定神。', fx: { h: 0.12, f: 0.06 } },
    { id: 'eq_xianglian', n: '寒星项链', slot: 'accessory', tier: '宝',
      grade: '地级',
      d: '坠中星芒不灭，助长灵力。', fx: { c: 0.08, cd: 0.20 } },
    { id: 'eq_bagua', n: '八卦盘', slot: 'accessory', tier: '灵',
      grade: '极品',
      d: '掌中罗盘，趋吉避凶。', fx: { s: 0.12, f: 0.05 } },
    { id: 'eq_ruyi', n: '白玉如意', slot: 'accessory', tier: '宝',
      grade: '玄级',
      d: '玉质温润，气机圆融。', fx: { a: 0.08, f: 0.08, h: 0.08 } },
    { id: 'eq_tongjing', n: '照妖古镜', slot: 'accessory', tier: '灵',
      grade: '黄级',
      d: '照见本相，破幻除魅。', fx: { c: 0.05, a: 0.06 } },
    { id: 'eq_hulu', n: '药王葫芦', slot: 'accessory', tier: '凡',
      grade: '中品',
      d: '葫芦里装的不知是什么药。', fx: { h: 0.14 } },
    /* 炼器产物（四大技艺批3，《四大技艺 v1.0》§3.4）—— 自炼法宝，走同一套三槽与 te 加成 */
    { id: 'fq_hanyue', n: '寒月刀', slot: 'weapon', tier: '锻', grade: '自炼', d: '寒铁锻成，刀光如月。', fx: { a: 0.14, c: 0.02 } },
    { id: 'fq_huxin', n: '护心镜', slot: 'armor', tier: '锻', grade: '自炼', d: '悬于胸前，护住心脉。', fx: { f: 0.10 } },
    { id: 'fq_xuangui', n: '玄龟甲', slot: 'armor', tier: '锻', grade: '自炼', d: '仿玄龟背甲锻制，坚厚。', fx: { f: 0.16, h: 0.08 } },
    { id: 'fq_juling', n: '聚灵珠', slot: 'accessory', tier: '锻', grade: '自炼', d: '珠内聚灵，气机绵长。', fx: { h: 0.12, s: 0.05 } },
    { id: 'fq_jifeng', n: '疾风靴', slot: 'armor', tier: '锻', grade: '自炼', d: '履之如御风，身法见长。', fx: { s: 0.12 } },
    { id: 'fq_daowen', n: '道纹剑', slot: 'weapon', tier: '道', grade: '道纹', d: '剑身铭道纹，锋芒内敛。', fx: { a: 0.20, c: 0.05 } },
    { id: 'fq_daowenjia', n: '道纹甲', slot: 'armor', tier: '道', grade: '道纹', d: '甲刻道纹，万法难侵。', fx: { f: 0.20, h: 0.12 } }
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
    /* 法宝加成 → 一句人话（**唯一**文案口）。
       面板法宝子页与战斗法宝常显都读它，各写一套必然漂移
       （表现是"面板写 +8% 气血、战斗悬浮写别的"）。 */
    fxDesc: function (e) {
      if (!e || !e.fx) return '';
      var W = { a: '攻击', f: '防御', h: '气血', s: '速度' };
      var parts = [];
      Object.keys(W).forEach(function (k) {
        if (e.fx[k]) parts.push(W[k] + ' +' + Math.round(e.fx[k] * 100) + '%');
      });
      if (e.fx.c) parts.push('暴击 +' + Math.round(e.fx.c * 100) + '%');
      if (e.fx.cd) parts.push('暴伤 +' + Math.round(e.fx.cd * 100) + '%');
      if (e.fx.vamp) parts.push('吸血 +' + Math.round(e.fx.vamp * 100) + '%');
      return parts.join('　');
    },
    /* 把三槽的加成汇总成 {a,f,h,s,c,cd,vamp}（与 dungeonBuffs.sum 同形）
       v0.76.0 阶段九：支持装备强化，使用强化后的属性 */
    sum: function (equip) {
      var o = { a: 0, f: 0, h: 0, s: 0, c: 0, cd: 0, vamp: 0 };
      if (!equip) return o;
      Object.keys(equip).forEach(function (slot) {
        var equipId = equip[slot];
        var e = index[equipId];
        if (!e) return;
        /* 使用强化后的属性（如果有强化模块） */
        var fx = (G.Enhance && G.Enhance.enhancedFx)
          ? G.Enhance.enhancedFx(equipId, e.fx)
          : e.fx;
        Object.keys(fx).forEach(function (k) { o[k] = (o[k] || 0) + fx[k]; });
      });
      return o;
    }
  };
})();
