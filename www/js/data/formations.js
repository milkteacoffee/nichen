/* 阵法（四大技艺批4）—— 《玩法方向与四大技艺设计 v1.0》§3.5
 * · 经营向长线投资：**只能主城/宗门交易（道纹阵为道界试炼）**，不可采集、不可掉落；
 * · save.formations = {id:true} 永久持有（本世）；效果在各自既有收口处生效：
 *   聚灵阵→rates.qi；聚宝阵→采集额外+1；静心阵→破境成功率；
 *   聚煞阵→战斗首回合攻击；道纹阵→道界内全属性；御兽阵→灵兽加成。
 */
(function () {
  /* cur: 结算货币 stone 灵石 / sectRep 宗门贡献 / daoCrystal 道晶；
     world: 最低可获取界（fan/ling/xian/dao）；sect:true 需拜入宗门 */
  var LIST = [
    { id: 'juling', n: '聚灵阵', src: '主城 · 灵界起', cur: 'stone', cost: 8000, world: 'ling',
      d: '打坐/战斗灵气 +15%' },
    { id: 'jubao', n: '聚宝阵', src: '宗门交易', cur: 'sectRep', cost: 300, sect: true, world: 'fan',
      d: '采集点每次产出 +1' },
    { id: 'yushou', n: '御兽阵', src: '宗门交易', cur: 'sectRep', cost: 260, sect: true, world: 'fan',
      d: '灵兽加成 +20%' },
    { id: 'jingxin', n: '静心阵', src: '主城 · 灵界起', cur: 'stone', cost: 12000, world: 'ling',
      d: '破境（问心魔劫）成功率 +10%' },
    { id: 'jusha', n: '聚煞阵', src: '宗门交易 · 仙界', cur: 'sectRep', cost: 600, sect: true, world: 'xian',
      d: '战斗首回合攻击 +25%' },
    { id: 'daowen', n: '道纹阵', src: '道界试炼', cur: 'daoCrystal', cost: 1500, world: 'dao',
      d: '道界内全属性 +5%' }
  ];
  var RANK = { fan: 0, ling: 1, xian: 2, dao: 3 };
  var index = {};
  LIST.forEach(function (f) { index[f.id] = f; });

  function has(save, id) { return !!(save.formations && save.formations[id]); }

  function activeWorld(meta) {
    if (G.Player && G.Player.activeWorldId) return G.Player.activeWorldId(meta || G.game.meta);
    return 'fan';
  }

  /* 该阵当前是否可在此购买 */
  function availability(save, meta, f) {
    var aw = activeWorld(meta);
    if (RANK[aw] < RANK[f.world]) return { ok: false, reason: '需至' + ({ ling: '灵界', xian: '仙界', dao: '道界' }[f.world] || '更高界') };
    if (f.sect && !save.sectId) return { ok: false, reason: '需拜入宗门' };
    if ((save[f.cur] || 0) < f.cost) return { ok: false, reason: '资财不足' };
    return { ok: true };
  }

  function buy(save, meta, id) {
    var f = index[id];
    if (!f) return { ok: false, reason: '无此阵' };
    if (has(save, id)) return { ok: false, reason: '已持有' };
    var c = availability(save, meta, f);
    if (!c.ok) return c;
    save[f.cur] -= f.cost;
    save.formations = save.formations || {};
    save.formations[id] = true;
    G.Storage.saveCurrent(save);
    return { ok: true };
  }

  G.Data = G.Data || {};
  G.Data.formations = LIST;
  G.Formations = {
    list: LIST, byId: function (id) { return index[id] || null; },
    has: has, availability: availability, buy: buy
  };
})();
