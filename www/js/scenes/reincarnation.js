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
    /* 入世成长演出（v0.71.0）：0 → 未开始；开始后按 t 走三拍 6→10→16 岁。 */
    grow: 0,
    growT: 0,

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
      this.arcChoice = null;
      this.linggen = null; this.talentCards = [];
      this.grow = 0; this.growT = 0; this._growSkip = false;
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
      } else if (this.step === 'arcpath') {
        back('返回禀赋', function () { self.step = 'talent'; self._buildButtons(); });
        var nextArc = G.Arcs.next(G.game.meta);
        self.buttons.push(new G.UI.Btn({ x: 150, y: 150, w: 168, h: 40,
          variant: 'gold',
          label: '天道命定 · ' + nextArc.n,
          onClick: function () {
            self.arcChoice = nextArc.id;
            self._beginGrow();
          } }));
        self.buttons.push(new G.UI.Btn({ x: 330, y: 150, w: 120, h: 40,
          label: '浮世轮回',
          onClick: function () {
            self.arcChoice = null;
            self._beginGrow();
          } }));
      } else if (this.step === 'grow') {
        /* 成长演出期间无按钮（点任意处加速，见 onTap） */
      } else {
        back('返回灵根', function () { self.step = 'linggen'; self._buildButtons(); });
        /* 每世仅一项先天禀赋，返回、刷新均不能重新抽取。 */
        primary(G.Arcs.next(G.game.meta) ? '择命途' : '入世', function () {
          var next = G.Arcs.next(G.game.meta);
          if (next) { self.step = 'arcpath'; self._buildButtons(); return; }
          self._beginGrow();
        });
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
      /* 灵根只给**属性匹配系数**（coef），不再给灵石加成（v0.75.0，用户口径
         「灵根不能增加灵石获取，只有天赋可以」）。
         ⚠️ 保留 `stoneBonus: 0` 字段：老档与别处代码仍会读它，
            删字段会让反序列化后的判空逻辑各处开花（而它恒为 0 = 无加成）。 */
      var lg = { kind: pick.kind, elems: pick.elems, coef: {}, stoneBonus: 0 };
      if (pick.kind === '四象') {
        pick.elems.forEach(function (e) {
          lg.coef[e] = (e === '光' || e === '暗') ? 2.5 : 2.0;
        });
      } else {
        var map = { 1: 1.5, 2: 1.2, 3: 1.0, 4: 0.8, 5: 0.6 };
        var cv = map[pick.elems.length];
        pick.elems.forEach(function (e) { lg.coef[e] = cv; });
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

    _beginGrow: function () {
      this.step = 'grow'; this.grow = 0; this.growT = 0;
      this._buildButtons();
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

      /* ===== 命定之世（情感主线）=====
         第 1 世强制 arc1 白鹿礁；其后几世由转世流程的「命途」步选择
         （this.arcChoice，E-C 批次接入）。命定之世不进区域地图，
         直接走 arc 场景；save 其余字段照常建立，无害。
         ⚠️ v0.90.1：加 `freeLife` 逃生门 —— 玩家在「命途」步点「浮世轮回」时
            `arcChoice = null`，但那与"还没选"无法区分，于是第 1 世照样被拖进 arc1。
           回归脚本（playthrough / rebirth / dungeon-run）要验的是**区域地图链路**，
           必须先明示"这一世走浮世"。所以：`freeLife === true` 时**跳过 arc**，
           连第 1 世也放行。UI 侧不受影响（它不走这条），只在自动化里用。 */
      var arcId = null;
      if (this.freeLife) arcId = null;              /* 显式走浮世：连第 1 世也跳过命定 */
      else if (life === 1) arcId = 'arc1';
      else if (this.arcChoice) arcId = this.arcChoice;
      var arcDef = arcId ? G.Arcs.byId(arcId) : null;

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

      /* 降世落点 = 主界首区 —— 但命定之世直接进 arc 场景，不进地图。 */
      if (arcDef) {
        G.Arcs.begin(save, meta, arcDef);
        G.Player.chronicle(save, 'birth', '入世·' + arcDef.n);
        G.Storage.saveCurrent(save);
        this._finished = true;
        this.arcChoice = null;
        G.game.save = save;
        G.game.changeScene('arc');
        return;
      }
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
      /* 成长演出（v0.71.0）：点一下 → 跳到下一拍（不让急性子干等 6 秒）。 */
      if (this.step === 'grow') this._growSkip = true;
    },

    /* 成长演出（v0.71.0）：三拍 6→10→16 岁，每拍 GROW_DUR 秒，
       最后一拍结束自动入世。skip（点击）直接把当前拍推完，不跳过年份。 */
    GROW_DUR: 2.0,
    /* 入世演出的立绘**展示倍率**（v0.90.0）。
       为什么需要它：heroAgeStage 的老几何按地图格尺寸（逻辑 28×42）设计，
       放进 480×272 的演出画面显得很小。素材已自带三档身高差，
       所以只乘这一个统一倍率即可，不要再叠 AGE_STAGE_R（那会让 6 岁小到看不清）。 */
    GROW_SCALE: 2.6,

    update: function (dt) {
      if (this.step !== 'grow') return;
      var d = this.GROW_DUR;
      this.growT += dt * (this._growSkip ? 4 : 1);
      this._growSkip = false;
      if (this.growT >= d) {
        this.growT -= d;
        this.grow += 1;
        /* grow 0=6岁 1=10岁 2=16岁；播完第 3 拍即入世。
           ⚠️ 必须**先把 step 改掉再 finish**：finish() 会 changeScene 切走，
           但它**不会**回头改旧场景对象的 step —— 留着 'grow' 会让"是否还在演出"
           的判据永远为真（契约里 while(R.step==='grow') 会空转到上限）。 */
        if (this.grow >= 3) {
          this.grow = 3; this.growT = 0; this.step = 'done';
          this.finish();
        }
      }
    },

    /* ===== 渲染 ===== */
    render: function (x) {
      var bg = x.createLinearGradient(0, 0, 0, 272);
      bg.addColorStop(0, '#0c1020'); bg.addColorStop(1, '#141a2e');
      x.fillStyle = bg; x.fillRect(0, 0, 480, 272);

      if (this.step === 'linggen') this.renderLinggen(x);
      else if (this.step === 'grow') this.renderGrow(x);
      else if (this.step === 'arcpath') this.renderArcPath(x);
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
      /* v0.75.0：不再显示"灵石获取"（灵根不给灵石，只有天赋给）。
         改为把**修行方向**讲清楚 —— 用户口径：「灵根的属性就决定主角本世应该
         往哪个方向收集功法和提升战力……去拜师相应属性的宗门或选择相应属性的悬赏任务」。 */
      var firsE = lg.elems[0];
      var dirT = '修行方向：' + firsE + '系功法 / 宗门 / 悬赏（同属加成最高）';
      G.UI.text(x, { x: r.x + 18, y: r.y + 110 }, dirT, 11, G.UI.C.goldHi);
    },

    /* ===== 入世成长演出（v0.71.0）=====
       三拍：6 岁 → 10 岁 → 16 岁。每拍画一档形象 + 落地那年的一句纪年 + 一道光柱"拔高"。
       为什么用程序化形象而不是素材：素材（char.hero.*）只有十六岁一档，
       读素材三拍全一个样，等于没做。`heroAgeStage` 与地图兜底同一套画法，画风天然一致。
       演出结束调用 `finish()`，与旧路径唯一差别就是多播了这 6 秒。 */
    renderGrow: function (x) {
      var AGES = [6, 10, 16];
      var idx = Math.min(this.grow, 2);
      var age = AGES[idx];
      var d = this.GROW_DUR;
      var ph = Math.max(0, Math.min(1, this.growT / d));   /* 本拍进度 0→1 */

      /* 背景：随年龄由暮色转晨曦（越长大越亮），三拍连起来像"天亮了" */
      var k = idx + ph;
      var bg = x.createLinearGradient(0, 0, 0, 272);
      bg.addColorStop(0, this._mix('#0a0d18', '#16243c', k / 3));
      bg.addColorStop(1, this._mix('#141a2e', '#2a3a52', k / 3));
      x.fillStyle = bg; x.fillRect(0, 0, 480, 272);

      /* 人物：脚底钉在 y=214 的地面线上（三档一致 → 视觉上是"长高"）。 */
      var GY = 214, CX = 240;
      /* 光柱：本拍前 35% 从地面升起，末 20% 淡出 */
      var beamA = Math.min(1, ph / 0.35) * Math.min(1, (1 - ph) / 0.2 + 0.35);
      var bh = 200 * (0.4 + 0.6 * Math.min(1, ph / 0.4));
      var g2 = x.createLinearGradient(0, GY - bh, 0, GY);
      g2.addColorStop(0, 'rgba(216,183,104,0)');
      g2.addColorStop(0.55, 'rgba(216,183,104,' + (0.13 * beamA).toFixed(3) + ')');
      g2.addColorStop(1, 'rgba(245,227,168,' + (0.20 * beamA).toFixed(3) + ')');
      x.fillStyle = g2;
      x.fillRect(CX - 46, GY - bh, 92, bh);

      /* 脚下的影/地线 */
      x.fillStyle = 'rgba(0,0,0,0.28)';
      x.beginPath(); x.ellipse(CX, GY, 20, 5, 0, 0, 6.2832); x.fill();
      x.strokeStyle = 'rgba(216,183,104,0.18)';
      x.lineWidth = 1;
      x.beginPath(); x.moveTo(CX - 150, GY + 0.5); x.lineTo(CX + 150, GY + 0.5); x.stroke();

      /* 人物本体：入场时从地面"长出来"（纵向 clip 由下往上揭开）
         ⚠️ v0.90.0 两条要点：
           ① 绘制尺寸用**逻辑尺寸**（位图是 K 倍物理像素，直接当逻辑用会放大 K 倍且模糊）；
           ② **素材命中时按演出倍率放大**：`heroAgeStage` 的老几何是给"16×24 地图格"
              设计的（28×42 逻辑），放进 480×272 的演出画面就显得很小。
              素材本身已自带三档身高差，所以这里只乘一个统一的**展示倍率**，
              不再叠加 AGE_STAGE_R（那会让 6 岁小到看不清）。 */
      var spr = G.Sprites.heroAgeStage(age, 'down', 0);
      var lg = G.Sprites.AGE_STAGE_LOGICAL || { w: 28, h: 42 };
      var gscale = this.GROW_SCALE || 1;
      var SW = lg.w * gscale, SH = lg.h * gscale;
      var dx = Math.round(CX - SW / 2), dy = Math.round(GY - SH);
      x.save();
      var reveal = Math.min(1, ph / 0.45);
      if (reveal < 1) {
        x.beginPath();
        x.rect(0, GY - SH * reveal, 480, SH * reveal + 4);
        x.clip();
      }
      x.drawImage(spr, dx, dy, SW, SH);
      x.restore();

      /* 头顶的四向小演练：让"这是个会走的人"而不是一张立绘 */
      if (ph > 0.55) {
        var step = Math.floor((ph - 0.55) * 20) % 3;
        var m = G.Sprites.heroAgeStage(age, 'down', step);
        x.globalAlpha = 0.999;
        x.drawImage(m, dx, dy, SW, SH);                /* 同位置叠走帧 → 有轻微迈步感 */
      }

      /* 年份大字 + 纪年小字 */
      var ageTxt = age + ' 岁';
      G.UI.textOut(x, { x: 240, y: 34 }, ageTxt, 34, G.UI.C.goldHi, 'center', 'rgba(8,10,16,0.9)', 4);
      var line = {
        6: '幼年 · 在青溪镇外的破屋里，你第一次记住了自己的名字。',
        10: '少年 · 你已能独自上山拾柴，指尖偶尔会流动一丝微光。',
        16: '及冠 · 你决定离开这座小镇，去寻自己的道。'
      }[age];
      var lines = G.UI.wrap(x, line, 12.5, 380);
      lines.slice(0, 2).forEach(function (l, i) {
        G.UI.text(x, { x: 240, y: 236 + i * 17 }, l, 12.5, G.UI.C.textDim, 'center');
      });

      /* 三拍进度点（6 · 10 · 16） */
      for (var i = 0; i < 3; i++) {
        var px = 240 + (i - 1) * 22;
        x.beginPath(); x.arc(px, 205, 3.2, 0, 6.2832);
        x.fillStyle = i < idx ? G.UI.C.gold
          : (i === idx ? 'rgba(245,227,168,' + (0.5 + 0.5 * Math.sin(G.game.time * 6)).toFixed(2) + ')' : 'rgba(216,183,104,0.25)');
        x.fill();
      }

      G.UI.text(x, { x: 240, y: 258 }, '点击继续', 9.5, G.UI.C.textDim, 'center');
    },

    /* 颜色插值（#rrggbb → #rrggbb），只给成长演出的背景用 */
    _mix: function (a, b, t) {
      t = Math.max(0, Math.min(1, t));
      function hex(s, i) { return parseInt(s.slice(1 + i * 2, 3 + i * 2), 16); }
      function h2(v) { v = Math.round(v); return (v < 16 ? '0' : '') + v.toString(16); }
      var r = hex(a, 0) + (hex(b, 0) - hex(a, 0)) * t;
      var g = hex(a, 1) + (hex(b, 1) - hex(a, 1)) * t;
      var bl = hex(a, 2) + (hex(b, 2) - hex(a, 2)) * t;
      return '#' + h2(r) + h2(g) + h2(bl);
    },

    renderArcPath: function (x) {
      var next = G.Arcs.next(G.game.meta);
      this._header(x, '降世 · 命途', '命定之世沿天道因果而行；浮世轮回则此世随机、无主线牵挂。');
      x.save();
      x.fillStyle = 'rgba(216,183,104,0.12)';
      G.UI.rr(x, 150, 150, 168, 40, 6); x.fill();
      x.fillStyle = 'rgba(120,150,190,0.1)';
      G.UI.rr(x, 330, 150, 120, 40, 6); x.fill();
      G.UI.text(x, { x: 234, y: 208 }, '命定：' + next.n + '（' + next.theme + '）', 11, G.UI.C.goldHi, 'center');
      var hint = '命定之世有固定牵挂与失去，是主线必经之途。';
      G.UI.wrap(x, hint, 10, 150).slice(0, 2).forEach(function (l, i) {
        G.UI.text(x, { x: 234, y: 222 + i * 12 }, l, 10, G.UI.C.textDim, 'center');
      });
      G.UI.text(x, { x: 390, y: 208 }, '随机世界 · 自由修行', 10, G.UI.C.text, 'center');
      G.UI.text(x, { x: 390, y: 224 }, '无主线，死后照常结算仙力。', 9.5, G.UI.C.textDim, 'center');
      x.restore();
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
