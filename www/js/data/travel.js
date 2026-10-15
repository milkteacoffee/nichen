/* 世界内付费传送 —— 《逆尘》对标烟雨江湖差距分析与改进设计 v1.0 §4.2（G3）
 *
 * 烟雨江湖：走路慢、传送是刚需；跨区域靠马车（马车票约 50 文/点）、
 * 船夫/艄公等传送 NPC，神行符回落脚点。本模块提供：
 *   · 车马行（mode='carriage'）：至本世界已探明的区域，费用按地图距离；
 *   · 渡船（mode='boat'）：同目的地，水路更省（约 75 折）；
 *   · 回城符（G.Travel.recall）：一键回本世落脚点，不花灵石（消耗道具）。
 *
 * 硬约束：
 *   ① 只能去**已到访（visited）**的区域，未探明不可选；
 *   ② 不跨世界（各界路网独立）；
 *   ③ 灵石不足给提示，不允许赊账；
 *   ④ 化神境（gl≥181）起地图面板可**免费**自由传送（panels.TELEPORT_GL），
 *      本模块是它**之前**的付费出行手段。
 */
(function () {
  /* 注意：data 脚本在 core/overlays.js 之前加载，此处不能直接读 G.Overlays，
     否则 G.Overlays 未定义会使整个 IIFE 失败（G.Data.Travel 静默缺失）。 */
  var T = (G.Overlays && G.Overlays.TELEPORT_GL) || 181;

  /* 当前世界 id（与地图面板同源） */
  function worldId(save) {
    var meta = G.game.meta || {};
    if (G.Player.activeWorldId) return G.Player.activeWorldId(meta);
    return G.Player.worldOfGL(save.globalLevel || 1).id;
  }

  /* 当前所在区域 id */
  function curRegionId(save) {
    if (G.Data.regions.regionIdOf) return G.Data.regions.regionIdOf(save.map);
    return null;
  }

  /* 两地（归一化地图坐标 mx,my）距离 */
  function dist(a, b) {
    return Math.hypot(a.mx - b.mx, a.my - b.my);
  }

  /* 费用（灵石）：carriage 8 + 距离×120；boat 6 + 距离×84（水路更省） */
  function feeOf(from, to, mode) {
    var d = dist(from, to);
    if (mode === 'boat') return Math.max(4, Math.round(6 + d * 84));
    return Math.max(6, Math.round(8 + d * 120));
  }

  /* 可选目的地列表：本世界、已到访、非当前。返回 {r,fee} 数组，按距离排序。 */
  function destinations(save, mode) {
    var w = worldId(save);
    var list = (G.Data.regions.of(w) || []).slice();
    var visited = save.visited || {};
    var curId = curRegionId(save);
    var from = null;
    list.forEach(function (r) { if (r.id === curId) from = r; });
    var out = [];
    list.forEach(function (r) {
      if (r.id === curId) return;
      if (!visited[r.id]) return;
      var ref = from || r;
      out.push({ r: r, fee: feeOf(ref, r, mode) });
    });
    out.sort(function (a, b) { return a.fee - b.fee; });
    return out;
  }

  /* 出行：校验灵石 → 扣费 → 换场景。返回 {ok, msg}。 */
  function go(scene, regionId, mode) {
    var save = G.game.save;
    var w = worldId(save);
    var list = G.Data.regions.of(w) || [];
    var target = null;
    list.forEach(function (r) { if (r.id === regionId) target = r; });
    if (!target) return { ok: false, msg: '无路可至' };
    if (!(save.visited || {})[regionId]) return { ok: false, msg: '未曾到过，无从前往' };
    var curId = curRegionId(save);
    var from = null;
    list.forEach(function (r) { if (r.id === curId) from = r; });
    var fee = feeOf(from || target, target, mode);
    if ((save.stone || 0) < fee) return { ok: false, msg: '灵石不足（需 ' + fee + '）' };
    save.stone -= fee;
    G.Storage.saveCurrent(save);
    if (scene.clearOverlay) scene.clearOverlay();
    G.game.changeScene(G.Data.regions.mapIdOf(target.id), { toSpawn: true });
    G.game.toast((mode === 'boat' ? '泛舟而至 · ' : '乘车而至 · ') + target.n);
    return { ok: true };
  }

  /* 本世落脚点（home）：各界首区（凡界 fan1 / 灵界 ling1 / …）。
     存 save.homeId 可覆盖；默认取本世界列表第一个。 */
  function homeRegion(save) {
    var w = worldId(save);
    var list = G.Data.regions.of(w) || [];
    if (save.homeId) {
      var found = null;
      list.forEach(function (r) { if (r.id === save.homeId) found = r; });
      if (found) return found;
    }
    return list[0] || null;
  }

  /* 回城符：消耗一张 → 回到落脚点。返回 {ok,msg}。 */
  function recall(scene) {
    var save = G.game.save;
    if (!save.items || !save.items['回城符']) return { ok: false, msg: '没有回城符' };
    var home = homeRegion(save);
    if (!home) return { ok: false, msg: '无落脚点' };
    var curId = curRegionId(save);
    if (home.id === curId) return { ok: false, msg: '已在落脚点' };
    save.items['回城符'] -= 1;
    if (save.items['回城符'] <= 0) delete save.items['回城符'];
    G.Storage.saveCurrent(save);
    if (scene.clearOverlay) scene.clearOverlay();
    G.game.changeScene(G.Data.regions.mapIdOf(home.id), { toSpawn: true });
    G.game.toast('神行回落 · ' + home.n);
    return { ok: true };
  }

  /* 化神后免费传送：本模块的付费入口在 gl≥181 时可提示玩家改用地图面板 */
  function isFree(save) { return (save.globalLevel || 1) >= T; }

  G.Data.Travel = {
    worldId: worldId,
    feeOf: feeOf,
    destinations: destinations,
    go: go,
    homeRegion: homeRegion,
    recall: recall,
    isFree: isFree
  };
})();
