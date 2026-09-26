/* 支线任务（内容型）—— 有 NPC、有剧情、有进度
 *
 * 与主线的区别：主线走 `save.quest`（单线推进）；支线**并行多条**，各记各的进度：
 *   `save.side = { <id>: step }`   step 0/缺省 = 未接，1 = 进行中，2 = 可交，3 = 完成
 *
 * 每条支线的结构：
 *   n      任务名
 *   giver  接取/交付的 NPC id（town.js 的 NPC_ACTS 里按 id 找）
 *   intro  接取时的开场白（NPC 说）
 *   steps  每步的 { d 目标文案, hint 提示 }（索引 = step-1）
 *   ready  判定"能不能交"（返回 bool）—— 用**已有系统**（物品 / 副本进度）判，不新造子系统
 *   cost   交付时扣除（物品名 → 数量）
 *   reward 交付奖励 { stone?, items?, rep? }
 *   out    交付时的收尾台词
 *
 * ⚠️ `ready` 与 `cost` 必须**成对**：ready 判"够不够"，cost 扣"扣多少"。
 *    只写 ready 不写 cost 会白送；只写 cost 不写 ready 会扣成负数（物品是平表，扣穿就没了）。
 */
(function () {
  function S(o) { return o; }

  var LIST = [
    S({
      id: 'sq_washer', n: '浣衣妇的心事', giver: 'washer',
      intro: '“……你从翠微山回来？我那儿子进山采药，三天没回来了。”',
      steps: [
        { d: '浣衣妇的儿子进翠微山采药未归。她求你替他讨个说法。',
          hint: '带 2 枚妖丹回来 —— 那是山中妖兽的凭证。' },
        { d: '妖丹已备齐，可以回青溪镇交给浣衣妇了。',
          hint: '回镇找浣衣妇。' },
        { d: '浣衣妇收下了妖丹，在河边烧了一夜纸钱。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['妖丹'] || 0) >= 2; },
      cost: { '妖丹': 2 },
      reward: { stone: 150, items: { '回春丹': 2 } },
      out: '“……多谢。这点钱你拿着，山里的路不好走。”'
    }),
    S({
      id: 'sq_woodman', n: '老樵夫的药方', giver: 'woodman',
      intro: '“老骨头不中用了。你若手头有回春丹，匀我几粒？”',
      steps: [
        { d: '老樵夫的老寒腿犯了，需要回春丹压一压。',
          hint: '凑 3 粒回春丹（杂货铺可买、妖兽也会掉）。' },
        { d: '回春丹凑齐了。', hint: '回镇交给老樵夫。' },
        { d: '老樵夫把压箱底的符箓塞给了你。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['回春丹'] || 0) >= 3; },
      cost: { '回春丹': 3 },
      reward: { items: { '解封符': 2 }, rep: 30 },
      out: '“好孩子。这符是我年轻时从一位游方道人手里换的，你带着。”'
    }),
    S({
      id: 'sq_keeper', n: '刘掌柜的旧账', giver: 'market',
      intro: '“刘记的旧账册丢在秘境里了。你若有本事进去，替老朽取回来？”',
      steps: [
        { d: '刘掌柜的旧账册落在了秘境里，他想讨回来。',
          hint: '通关任意一个秘境副本。' },
        { d: '你在秘境深处翻出了那本账册。', hint: '回镇交给刘掌柜。' },
        { d: '刘掌柜翻着账册，半晌没说话。', hint: '（已完成）' }
      ],
      ready: function (s) { return (s.dungeonSlot || 0) > 0 || (s.dungeonFarm || 0) > 0; },
      /* `free: true` = **无物品代价**（判定靠别的系统，如副本进度）。
         不写这个标记、又只给 ready 不给 cost，会被契约判成"白送"（见 smoke 的 sidequest.contract）。 */
      free: true, cost: null,
      reward: { stone: 200, items: { '聚气散': 1 } },
      out: '“多谢。往后你在我这儿买东西，记你一份人情。”'
    })
  ];

  var index = {};
  LIST.forEach(function (q) { index[q.id] = q; });

  G.Data = G.Data || {};
  G.Data.sideQuests = {
    list: LIST,
    byId: function (id) { return index[id] || null; },
    /* 按 giver NPC id 找支线（一个 NPC 一条） */
    byGiver: function (giverId) {
      return LIST.filter(function (q) { return q.giver === giverId; })[0] || null;
    },
    /* 当前步（0 = 未接） */
    stepOf: function (save, id) { return ((save.side || {})[id] | 0); },
    /* 能不能交（step 2 且 ready） */
    canTurnIn: function (save, q) {
      if (this.stepOf(save, q.id) !== 2) return false;
      try { return !!q.ready(save); } catch (e) { return false; }
    },
    /* 交付：扣 cost → 发 reward → step = 3。返回 {ok, reason, text} */
    turnIn: function (save, q) {
      if (!this.canTurnIn(save, q)) return { ok: false, reason: '条件未满足' };
      var cost = q.cost || {};
      Object.keys(cost).forEach(function (k) {
        if (((save.items || {})[k] || 0) < cost[k]) { cost = null; }
      });
      if (cost === null) return { ok: false, reason: '物品不足' };
      Object.keys(cost).forEach(function (k) { save.items[k] -= cost[k]; });

      var r = q.reward || {};
      if (r.stone) save.stone = (save.stone || 0) + r.stone;
      if (r.rep && G.Player.addRep) G.Player.addRep(save, r.rep);
      Object.keys(r.items || {}).forEach(function (k) {
        save.items = save.items || {};
        save.items[k] = (save.items[k] || 0) + r.items[k];
      });
      save.side = save.side || {};
      save.side[q.id] = 3;
      if (G.Player.chronicle) G.Player.chronicle(save, 'side:' + q.id, '了却一桩：' + q.n);
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, text: q.out, reward: r };
    },
    /* 接取：step = 1 */
    accept: function (save, q) {
      save.side = save.side || {};
      if (save.side[q.id]) return false;
      save.side[q.id] = 1;
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return true;
    },
    /* 把 step 1 → 2（条件达成时由 tick 调） */
    tick: function (save) {
      var self = this, changed = false;
      LIST.forEach(function (q) {
        if (self.stepOf(save, q.id) !== 1) return;
        var ok = false;
        try { ok = !!q.ready(save); } catch (e) { ok = false; }
        if (ok) { save.side[q.id] = 2; changed = true; }
      });
      return changed;
    }
  };
})();
