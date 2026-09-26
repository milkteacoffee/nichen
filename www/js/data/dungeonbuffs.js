/* 副本内临时增益（每层三选一）—— 《逆尘》宗门副本对标设计 v1.0 §5.2
 *
 * **为什么要有**：我们是轮回制（Roguelite 骨架），但副本里没有"构筑"环节 ——
 * 打怪只是打怪，每一层和上一层没有区别。**「每层三选一」是 Roguelite 与线性 RPG 的分水岭**
 * （对标《暖雪》每关结束的三选一）。
 *
 * 生命周期：**只在本场副本内有效**。进副本清空、出副本清空、飞升清空。
 *   `save.dungeonRun.buffs = ['atk', 'crit', ...]`（可重复，效果叠加）
 *
 * 效果表达：全部落到 `computeStats` 已有的 `te`（天赋效果）字段上 ——
 *   `a` 攻击% / `f` 防御% / `h` 气血% / `s` 速度% / `c` 暴击 / `cd` 暴击伤害 / `vamp` 吸血。
 *   ⚠️ **不要新造一套应用点**：并进 `te` 就自动被面板、HUD、战斗三处同时认到；
 *      另起一套必然有一处漏掉（表现是"面板涨了、战斗没涨"）。
 */
(function () {
  var LIST = [
    { id: 'atk', n: '锐意', d: '攻击 +15%', fx: { a: 0.15 } },
    { id: 'hp', n: '厚土', d: '气血 +20%', fx: { h: 0.20 } },
    { id: 'def', n: '铁骨', d: '防御 +18%', fx: { f: 0.18 } },
    { id: 'spd', n: '疾风', d: '速度 +12%', fx: { s: 0.12 } },
    { id: 'crit', n: '会心', d: '暴击率 +8%', fx: { c: 0.08 } },
    { id: 'critd', n: '摧枯', d: '暴击伤害 +25%', fx: { cd: 0.25 } },
    { id: 'vamp', n: '噬血', d: '造成伤害的 8% 转为气血', fx: { vamp: 0.08 } },
    { id: 'allround', n: '圆融', d: '攻击·防御·气血 各 +8%', fx: { a: 0.08, f: 0.08, h: 0.08 } }
  ];
  var index = {};
  LIST.forEach(function (b) { index[b.id] = b; });

  G.Data = G.Data || {};
  G.Data.dungeonBuffs = {
    list: LIST,
    byId: function (id) { return index[id] || null; },
    /* 抽 n 个**互不重复**的候选（同一层不重复给同一条） */
    roll: function (n) {
      var pool = LIST.slice(), out = [];
      n = Math.min(n, pool.length);
      for (var i = 0; i < n; i++) {
        out.push(pool.splice(G.rng.int(0, pool.length - 1), 1)[0]);
      }
      return out;
    },
    /* 把一串增益 id 汇总成 {a,f,h,s,c,cd,vamp} */
    sum: function (ids) {
      var o = { a: 0, f: 0, h: 0, s: 0, c: 0, cd: 0, vamp: 0 };
      (ids || []).forEach(function (id) {
        var b = index[id];
        if (!b) return;
        Object.keys(b.fx).forEach(function (k) { o[k] = (o[k] || 0) + b.fx[k]; });
      });
      return o;
    },
    /* 给界面用的一行摘要（如「锐意 · 会心」） */
    label: function (ids) {
      return (ids || []).map(function (id) {
        var b = index[id];
        return b ? b.n : id;
      }).join(' · ');
    }
  };
})();
