/* 转世：灵根推演 → 单项先天禀赋 → 入世。
   灵根与天赋存在当前槽 meta.pendingBirth，返回/刷新不重抽。
   幼年可玩流程与新动画尚待后续实现，当前仍从 16 岁入世。 */
(function () {
  function has(s, n) { return ((s.items || {})[n] || 0) > 0; }
  function take(s, n, k) { k = k || 1; s.items[n] = (s.items[n] || 0) - k; if (s.items[n] <= 0) delete s.items[n]; }

  var elemInfo = {
    '金': { n: '金', c: '#d8c36a' }, '木': { n: '木', c: '#6fae6f' },
    '水': { n: '水', c: '#5b9fd6' }, '火': { n: '火', c: '#d97448' },
    '土': { n: '土', c: '#b89a5a' }, '光': { n: '光', c: '#f0e0a0' },
    '雷': { n: '雷', c: '#b89ce0' }, '风': { n: '风', c: '#8fc8b8' },
    '暗': { n: '暗', c: '#9c8ab8' }
  };
  var WUXING = ['金', '木', '水', '火', '土'];
  var SIXIANG = ['光', '雷', '风', '暗'];

  function defaultMeta() {
    return {
      lives: 0, xianli: 0, totalXianli: 0,
      perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
      progress: G.Storage.defaultProgress(),
      pity: 0, achieve: {},
      heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
      past: []
    };
  }

  var scene = {
    smooth: true,
    step: 'linggen',
    originSel: -1,
    linggen: null,
    talentCards: [],
    _finished: false,

    _birthDraft: function () {
      var meta = G.game.meta;
      var life = ((meta.past || []).length || 0) + 1;
      if (!meta.pendingBirth || meta.pendingBirth.life !== life) {
        meta.pendingBirth = { life: life,
          seed: G.RNG.hash(Date.now() + ':' + Math.random() + ':' + life) };
        G.Storage.saveMeta(meta);
      }
      return meta.pendingBirth;
    },

    enter: function () {
      if (!G.game.meta) {
        G.game.meta = defaultMeta();
        G.Storage.saveMeta(G.game.meta);
      }
      this.step = 'linggen'; this._finished = false;
      this.linggen = null; this.talentCards = [];
      this.rollLinggenOnce();
      this.drawTalents();
      this._buildButtons();
    },

    _buildButtons: function () {
      var self = this;
      this.buttons = [];
      function back(label, fn) {
        self.buttons.push(new G.UI.Btn({ x: 16, y: 232, w: 86, h: 26, label: label,
          small: true, variant: 'ghost', onClick: fn }));
      }
      function primary(label, fn, disabled) {
        self.buttons.push(new G.UI.Btn({ x: 366, y: 232, w: 98, h: 26, label: label,
          small: true, variant: 'gold', disabled: disabled, onClick: fn }));
      }
      function normal(x, label, fn, disabled) {
        self.buttons.push(new G.UI.Btn({ x: x, y: 232, w: 98, h: 26, label: label,
          small: true, disabled: disabled, onClick: fn }));
      }

      if (this.step === 'linggen') {
        back('返回标题', function () { G.game.changeScene('title'); });
        primary('下一步', function () {
          self.step = 'talent';
          self.drawTalents();
          self._buildButtons();
        });
      } else {
        back('返回灵根', function () { self.step = 'linggen'; self._buildButtons(); });
        /* 每世仅一项先天禀赋，返回、刷新均不能重新抽取。 */
        primary('入世', function () { self.finish(); });
      }
    },

    /* 灵根只抽一次：当前槽 pendingBirth 持久保存种子与结果，返回/刷新不重抽。
       使用独立 G.RNG，不消耗玩法的全局随机序列。 */
    rollLinggenOnce: function () {
      var draft = this._birthDraft();
      if (draft.linggen) { this.linggen = JSON.parse(JSON.stringify(draft.linggen)); return; }
      var rng = new G.RNG(G.RNG.hash(draft.seed + ':linggen'));
      var entries = [];
      function add(elems, w, kind) { entries.push({ elems: elems, w: w, kind: kind }); }
      var i, j, comb;
      /* 五行各组合（权重为类别总权，均摊到组合） */
      function combos(n) {
        var out = [], cur = [];
        (function rec(start) {
          if (cur.length === n) { out.push(cur.slice()); return; }
          for (var k = start; k < WUXING.length; k++) { cur.push(WUXING[k]); rec(k + 1); cur.pop(); }
        })(0);
        return out;
      }
      var wSingle = 7.0 / 5, wDouble = 17.5 / 10, wTriple = 24.5 / 10,
        wFour = 14.0 / 5, wFive = 7.0;
      combos(1).forEach(function (c) { add(c, wSingle, '五行'); });
      combos(2).forEach(function (c) { add(c, wDouble, '五行'); });
      combos(3).forEach(function (c) { add(c, wTriple, '五行'); });
      combos(4).forEach(function (c) { add(c, wFour, '五行'); });
      add(WUXING.slice(), wFive, '五行');
      SIXIANG.forEach(function (e) { add([e], 7.5, '四象'); });

      var pick = entries[rng.weighted(entries)];
      var lg = { kind: pick.kind, elems: pick.elems, coef: {}, stoneBonus: 0 };
      if (pick.kind === '四象') {
        pick.elems.forEach(function (e) {
          lg.coef[e] = (e === '光' || e === '暗') ? 2.5 : 2.0;
          lg.stoneBonus = (e === '光' || e === '暗') ? .25 : .15;
        });
      } else {
        var map = { 1: 1.5, 2: 1.2, 3: 1.0, 4: 0.8, 5: 0.6 };
        var cv = map[pick.elems.length];
        pick.elems.forEach(function (e) { lg.coef[e] = cv; });
        if (pick.elems.indexOf('金') >= 0) lg.stoneBonus = .15;
      }
      draft.linggen = JSON.parse(JSON.stringify(lg));
      G.Storage.saveMeta(G.game.meta);
      this.linggen = lg;
    },

    /* 保留旧驱动入口，但重复调用只取本世锁定结果。 */
    rollLinggen: function () { this.rollLinggenOnce(); },

    /* 每世一种天赋：独立随机流、结果落盘，不受仙力/怜悯影响。 */
    drawTalents: function () {
      var draft = this._birthDraft();
      var talent = draft.talentId && G.Data.talentById(draft.talentId);
      if (!talent) {
        var rng = new G.RNG(G.RNG.hash(draft.seed + ':talent'));
        var weights = { '仙': 1, '上': 3, '良': 6, '凡': 10 };
        var groups = {}, tiers = [];
        G.Data.talents.forEach(function (t) {
          if (!groups[t.t]) { groups[t.t] = []; tiers.push(t.t); }
          groups[t.t].push(t);
        });
        var tier = tiers[rng.weighted(tiers.map(function (t) { return { w: weights[t] }; }))];
        talent = rng.pick(groups[tier]);
        draft.talentId = talent.id;
        G.Storage.saveMeta(G.game.meta);
      }
      this.talentCards = [talent];
    },

    /* ===== 结算：生成当世档 ===== */
    finish: function () {
      if (this._finished) return;
      var meta = G.game.meta;
      var life = ((meta.past || []).length || 0) + 1;
      var anchor = life === 1;
      var seed = anchor ? 20260924 : (Date.now() & 0x7fffffff);
      var world = G.Data.generateWorld(seed, anchor);

      /* 开局物品与灵石；出身与天赋都只往这两个口袋里加东西 */
      var items = {}, stone = 50;
      var zeroStone = false;

      /* 不再授予出身额外资源或百分比加成。 */

      /* 天赋 */
      var talentIds = this.talentCards.map(function (t) { return t.id; });
      this.talentCards.forEach(function (t) {
        var e = t.e || {};
        if (e.items) Object.keys(e.items).forEach(function (k) { items[k] = (items[k] || 0) + e.items[k]; });
        if (e.stone) stone += e.stone;
        if (e.zeroStone) zeroStone = true;
      });
      if (zeroStone) stone = 0;

      /* ===== 功法：**入世不带任何功法**（v0.25.0）=====
         用户口径：「主角轮回转世，是没有功法的；功法只能通过完成散修任务或者宗门任务去获得，
         不是每次都随机三个功法」。
         所以这里给空表 —— 第一门功法由 **m0-1「拜入药铺」复命时沈伯传授**
         （见 town.js 的 shenbo 分支），那就是"散修线的第一个任务奖励"。
         ⚠️ 空表是**有意为之**，不是漏了：`skills.contract` 会断言入世为空。 */
      var skills = {};
      var equip = [];

      /* 轮回殿灌注：把上一世积累的仙力兑现成开局资源。
         body 不在这里处理——它由 Player.computeStats 直接读 meta.perfusion.body。 */
      var pf = meta.perfusion || {};
      var addQi = (pf.qi || 0) * 120;
      var addPo = (pf.po || 0) * 12;
      var addStone = (pf.stone || 0) * 60;
      var addRescue = pf.rescue || 0;

      /* 四界区域层（《四界区域与副本落位设计 v1.1》§2.1 / §6.1）：
         锚世（第 1 世）固定凡界、走剧情锚定副本、不抽随机池；
         浮世由**天道抽定本世起始界**（未通关界优先），并把 5 个副本入口撒进该界区域。
         **当前界只有一个真相源 = `meta.progress.activeWorld`**（飞升时由 Player.ascend 上移），
         所以这里不另存 `save.mainWorld`；`save.entrances` 按界分桶，回访下界时落位仍在。 */
      meta.progress = meta.progress || {};
      var mainWorld;
      if (anchor) mainWorld = 'fan';
      else {
        /* 轮回殿「飞升台」指定的下一世主界优先（设计 v3.2 §10.3）。
           只认已解锁的界 —— 未解锁 / 越界的值一律忽略、回落天道抽取，
           免得旧档或手改档把玩家扔进还没开的世界。
           道界（dao）自 v0.9.0 起**可选**：条件是三枚碎片齐（daoKey）——
           它已由道则回廊九关撑起完整内容（缺口 U4），不再是有区域没主线的空界。 */
        var pick = meta.progress.nextWorld;
        var wd = meta.progress.worlds || {};
        if (pick === 'dao' && meta.progress.daoKey) mainWorld = 'dao';
        else if (pick && pick !== 'dao' && (pick === 'fan' || wd[pick])) mainWorld = pick;
        else mainWorld = G.Data.regions.rollMainWorld(meta);
      }
      meta.progress.activeWorld = mainWorld;

      /* 降世起始境界（《闭环报告 v3.2》G7「降世选界」）：
         境界从该界的**起始 gl** 起算（凡 1 / 灵 64 / 仙 91 / 道 145），
         否则"选灵界降世"却从淬体一段开始，等于把玩家扔进 64 级的野外。 */
      var startGL = G.Player.worldById(mainWorld).start;

      var save = {
        life: life, worldSeed: seed, world: world,
        origin: null, originFx: {}, homeOwned: false,
        linggen: this.linggen, talents: talentIds,
        skills: skills, skillEquip: equip,
        items: items, stone: stone + addStone, qi: 100 + addQi, po: addPo,
        /* 直接 16 岁入世：幼年阶段（1-15 岁事件卡）已整体删除 */
        globalLevel: startGL, age: 16,
        watch: 0, whispers: 0, escapeLeft: 3 + addRescue,
        quest: { step: 'm0-1', flags: {}, line: 'free' },
        /* 宗门与散修（《宗门与散修体系设计 v1.0》§7.2）：入世默认散修 */
        cult: 'free', sectId: null, sectRep: 0, sectRank: 'outer', cultSwitchUsed: false,
        stipendAge: 0,                             /* 岁俸：上次结算的年龄 */
        wildKills: 0,                              /* 野外击杀数（散修线「云游四方」判据） */
        askedRealms: {},
        side: {},                                  /* 支线进度：{ <id>: 1进行/2可交/3完成 } */
        fly: false,                                /* 御剑飞行开关（金丹境起可用） */
        equip: { weapon: null, armor: null, accessory: null },  /* 法宝三槽 */
        scene: 'town', map: 'town',
        pos: { x: G.Data.maps.town.spawn.x, y: G.Data.maps.town.spawn.y },
        chestsOpened: [], bossKilled: false,
        /* 剧情战斗触发格已打完的节点（M1 §5.1 血煞据点）。键 = mapId + ':' + nodeId。
           老存档没这个字段 → explore.js 用 `|| (… = [])` 就地补，不写迁移。 */
        scriptBattlesDone: [],
        /* 仙力结算与寿元（轮回 v0.4 §3.2 / §4） */
        maxGlobalLevel: startGL, bossKills: 0, chronicle: [],
        /* 世界时钟（v0.61.0）：gt = 本世累计**游戏分钟**（寿元的唯一账本），
           ageBonus = 突破这类"顿悟"的一次性加龄，lastSeen = 现实时间戳（离线打坐用）。
           ⚠️ `_ageTick` 已废（旧的分段余数），别再往新档里写。 */
        gt: 0, ageBonus: 0, lastSeen: Date.now(),
        /* 资源分级（用户第 11 点）：灵晶 / 仙晶 的持有量（下品计）。
           灵石走 `stone`、道晶走 `daoCrystal`（老字段，不动）。 */
        lingjing: 0, xianjing: 0,
        /* 主线章节链与道心（v0.63.0）：`chapters` = 已完成的章节 id 数组，
           `daoHeart` = 章节抉择累计的道心（-10..+10，**三结局的唯一分水岭**）。 */
        chapters: [], daoHeart: 0,
        /* 副本（v3.3）：本世秘境序列随入世抽取。**种子化**（缺口 U8）——
           `dungeonSet` 与区域入口落位必须来自**同一条序列**（缺口 G20），
           否则区域裂隙显示的副本与秘境枢纽的槽位对不上。 */
        dungeonSet: G.Data.dungeons.rollSet(seed + ':set'),
        dungeonSlot: 0, dungeonRun: null, dungeonFarm: 0,
        dungeonPity: { mid: 0, clear: 0 },
        secrets: {}, daoCrystal: 0, daoCleared: [],
        /* 区域层：入口落位按界分桶（锚世不抽池）/ 到访记录 / 已进建筑 */
        entrances: { fan: [], ling: [], xian: [], dao: [] },
        visited: {}, indoor: {},
        /* 灵兽（《灵兽 v1.1》§12）：开局空兽栏、未学骑术 */
        beasts: [], beastTeam: [], riding: null, rideSkill: { land: false, air: false }
      };
      /* 锚世不抽随机副本池（走剧情锚定副本）；浮世为起始界 roll 一次落位 */
      if (!anchor) {
        save.entrances[mainWorld] =
          G.Data.regions.rollEntrances(mainWorld, seed, save.dungeonSet);
      }

      /* 降世落点 = **主界首区**（《闭环报告 v3.2》G7）：
         以前写死 `scene:'town'`，于是"选灵界降世"也会落在青溪镇 ——
         人站在凡界的地图上，境界却是合体一重（gl64），界面与世界全对不上。
         凡界首区就是 `town`，所以锚世与凡界降世的行为**完全不变**。
         必须放在 entrances 落位之后：RegionGen 生成地图时要把裂隙放进地图里。 */
      var firstR = G.Data.regions.of(mainWorld)[0];
      if (firstR) {
        if (!firstR.map && G.RegionGen) {
          if (G.RegionGen.ensure) G.RegionGen.ensure(save, firstR.id);
          /* 生成型区域还得把**场景**也注册出来，否则 changeScene 会撞上
             "场景未开放"（地图注册 ≠ 场景注册，两件事）。 */
          if (G.RegionGen.sceneFor) G.RegionGen.sceneFor(firstR.id);
          /* 把**本界全部**生成型区域注册成场景（v0.41.0）。
             ⚠️ `registerWorld` 之前全项目无人调用 —— 只建首区的话，
                其余区域在走到出口时才会被懒创建（见 explore._transition 的兜底）。 */
          if (G.RegionGen.registerWorld) {
            G.RegionGen.registerWorld(G.Player.activeWorldId(G.game.meta));
          }
        }
        var startId = G.Data.regions.mapIdOf(firstR.id);
        var smd = G.Data.maps[startId];
        if (smd && smd.spawn) {
          save.scene = startId; save.map = startId;
          save.pos = { x: smd.spawn.x, y: smd.spawn.y };
        }
      }

      /* R5 伴生仙兽：槽中仙兽随轮回同行，境界折算到降世起点（不原样继承） */
      if (meta.companionBeast && meta.companionBeast.id && G.Beasts) {
        try { G.Beasts.add(save, meta.companionBeast.id, { gl: startGL }); } catch (e) {}
      }
      if (addQi || addPo || addStone || addRescue || (pf.body || 0)) {
        var gains = [];
        if (pf.body) gains.push('仙躯 ' + pf.body + ' 层');
        if (addQi) gains.push('灵气 +' + addQi);
        if (addPo) gains.push('灵力 +' + addPo);
        if (addStone) gains.push('灵石 +' + addStone);
        if (addRescue) gains.push('遁走 +' + addRescue);
        G.game.toast('仙力灌注：' + gains.join('　'));
      }
      /* 走马灯第一条：入世。必须在 saveCurrent 之前写，否则落不了盘。
         地名取**主界首区**的名字（凡界 = 青溪镇；灵/仙/道界是各自的首区），
         不能写死"青溪镇" —— 那是凡界锚世才有的地名。 */
      G.Player.chronicle(save, 'birth',
        '入世' + ((firstR && firstR.n) || (world.names && world.names.town) || '青溪镇'));
      G.Storage.saveCurrent(save);
      this._finished = true;
      G.game.save = save;
      /* 新世界的调色板是随机取的（非锚世），地面纹理的缓存键里带调色板 ——
         不预热的话，玩家进第一张地图时要现场烘 10 张 224² 纹理（约 110~145ms）。
         以前靠 15 张幼年事件卡把这段时间铺掉，现在直接入世，所以这里的预热
         只对"后面才去的地图"（山/洞/室内）有效；青溪镇这一张会在进门时现场烘。
         那一下发生在玩家刚点完「入世」的转场瞬间，不打断任何操作，可以接受。 */
      if (G.Art.warmup) G.Art.warmup(world.pal);
      G.game.changeScene(save.scene || 'town');
    },

    onTap: function (p) {
      /* v0.66.0：身份选择已删（`step` 直接从 linggen 起），这里不再处理 origin 分支。
         灵根页的点击由 `renderLinggen` 内的 hover 区域自己管。 */
    },

    /* ===== 渲染 ===== */
    render: function (x) {
      var bg = x.createLinearGradient(0, 0, 0, 272);
      bg.addColorStop(0, '#0c1020'); bg.addColorStop(1, '#141a2e');
      x.fillStyle = bg; x.fillRect(0, 0, 480, 272);

      if (this.step === 'linggen') this.renderLinggen(x);
      else this.renderTalents(x);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    _header: function (x, title, hint) {
      G.UI.text(x, { x: 16, y: 14 }, title, 18, G.UI.C.goldHi);
      G.UI.text(x, { x: 16, y: 40 }, hint, 12, G.UI.C.textDim);
    },

    /* `renderOrigin` 在 v0.66.0 起废弃（无身份卡），整段删去 —— 改成 `renderLinggen` 与
       `renderTalents` 两步。render() 也只调这两个。 */

    renderLinggen: function (x) {
      this._header(x, '降世 · 天生灵根', '本世只抽取一次，返回或重载不会改变；悬停灵根查看说明。');
      var lg = this.linggen;
      if (!lg) return;

      var r = { x: 60, y: 66, w: 360, h: 130 };
      G.UI.panel(x, r, '#131828');
      G.UI.text(x, { x: r.x + 18, y: r.y + 14 },
        lg.kind === '四象' ? '四象灵根（天灵）' : '五行灵根 · ' +
        ['', '单灵根', '双灵根', '三灵根', '四灵根', '五灵根'][lg.elems.length],
        17, lg.kind === '四象' ? G.UI.C.goldHi : G.UI.C.text);

      /* 属性圆牌 */
      var cx0 = r.x + 30;
      for (var i = 0; i < lg.elems.length; i++) {
        var e = lg.elems[i], info = elemInfo[e];
        var cy = r.y + 58 + i * 0, cxx = cx0 + i * 52;
        x.fillStyle = info.c;
        x.beginPath(); x.arc(cxx, r.y + 62, 17, 0, 6.2832); x.fill();
        x.fillStyle = '#10131f';
        x.font = '16px KaiTi, serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(info.n, cxx, r.y + 63);
        G.UI.hover({ x: cxx - 18, y: r.y + 44, w: 36, h: 36 }, G.Player.rootDescription(lg, e));
      }

      /* 系数 */
      var coefText = lg.elems.map(function (e) {
        return e + '系功法 ×' + lg.coef[e].toFixed(1);
      }).join('　');
      var coefLines = G.UI.wrap(x, coefText, 11, r.w - 36);
      coefLines.slice(0, 2).forEach(function (line, n) {
        G.UI.text(x, { x: r.x + 18, y: r.y + 88 + n * 14 }, line, 11, G.UI.C.textDim);
      });
      var stT = '灵石获取 ' + (lg.stoneBonus > 0 ? '+' + Math.round(lg.stoneBonus * 100) + '%' : '无加成');
      G.UI.text(x, { x: r.x + 18, y: r.y + 110 }, stT, 12, G.UI.C.textDim);
    },

    renderTalents: function (x) {
      this._header(x, '降世 · 先天禀赋', '每世随机一种，不可重抽；不是身份选择，也不消耗仙力。');
      var t = this.talentCards[0];
      if (!t) return;
      var r = { x: 54, y: 66, w: 372, h: 158 };
      var border = { '仙': G.UI.C.gold, '上': '#a98ce0', '良': '#6f9fc8', '凡': '#565b6e' }[t.t];
      var detail = G.Data.talentDetail(t);
      G.UI.panel(x, r, '#141927', border);
      G.UI.text(x, { x: r.x + 16, y: r.y + 10 }, t.t + '品 · 本世唯一', 11, border);
      G.UI.text(x, { x: r.x + r.w / 2, y: r.y + 22 }, t.n, 17, G.UI.C.goldHi, 'center');
      var lines = G.UI.wrap(x, detail.text, 11, r.w - 32);
      lines.slice(0, 6).forEach(function (line, i) {
        G.UI.text(x, { x: r.x + 16, y: r.y + 47 + i * 14 }, line, 11, G.UI.C.textDim);
      });
      G.UI.text(x, { x: r.x + 16, y: r.y + 141 }, '悬停查看完整效果、代价与生效状态', 10, G.UI.C.jadeHi);
      G.UI.hover(r, { title: t.n + ' · ' + t.t + '品', text: detail.text });
    }
  };

  G.scenes.reincarnation = scene;
})();
