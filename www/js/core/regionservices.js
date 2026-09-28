/* 区域建筑服务（R3）—— 室内三种真实服务：投宿 / 打造 / 炼丹（交易见 shopservice）。
 * 由 interiorgen 生成的室内 Explore 场景在家具交互时调用。
 * 口径参考《全案闭环检查报告 v3.6》路线图 R3。 */
(function () {
  /* 当前界（决定投宿底价） */
  function worldId() {
    try { return G.Player.activeWorldId(G.game.meta); } catch (e) { return 'fan'; }
  }
  /* 投宿底价按界抬，同界内随大境（每 36 阶）小涨，避免后期 30 灵石形同免费。 */
  function innPrice(save) {
    var w = worldId();
    var base = w === 'fan' ? 30 : w === 'ling' ? 300 : w === 'xian' ? 1500 : 8000;
    var realmN = Math.floor((save.globalLevel || 1) / 36);
    return Math.round(base * (1 + realmN * 0.1));
  }
  /* 投宿：扣灵石 → 气血全复 → 跨游戏日（采集点刷新）。 */
  function innRest(scene) {
    var save = G.game.save;
    var price = innPrice(save);
    if ((save.stone || 0) < price) { G.game.toast('灵石不足，房资需 ' + price); return; }
    save.stone -= price;
    var st = G.Player.computeStats(save);
    save.hp = st.maxhp;
    if (G.Gather) G.Gather.advanceDay(save);
    G.Storage.saveCurrent(save);
    G.game.toast('投宿一夜，气血全复，灵石 -' + price);
  }
  /* 打造：铁匠铺铁砧 → 复用洞府炼器面板（自带材料即可在野外锻造）。 */
  function openForge(scene) { scene._craftFrom = 'field'; G.Overlays.openPanel(scene, 'forge'); }
  /* 炼丹：丹房丹炉 → 复用洞府炼丹面板。 */
  function openAlchemy(scene) { scene._craftFrom = 'field'; G.Overlays.openPanel(scene, 'alchemy'); }

  G.RegionServices = {
    innPrice: innPrice, innRest: innRest,
    openForge: openForge, openAlchemy: openAlchemy
  };
})();
