/* 副本运行场景 v3.3：秘境枢纽 + 关卡推进 + Boss 奖励 + 通关飞升
 * 数据：save.dungeonSet[5] / dungeonSlot / dungeonRun / secrets / dungeonFarm
 * 关卡：大副本九关（第5小Boss、第6休整、第9大Boss）；小副本五关（第5头领）。 */
(function () {
  var ROW = { x: 16, w: 448, h: 32, gap: 8, y0: 42 };
  var BRIEF = { x: 40, y: 46, w: 400, h: 184 };
  /* 区域裂隙 → 副本入口面板（缺口 U6） */
  var ENT = { x: 40, y: 22, w: 400, h: 196 };

  var D = function () { return G.Data.dungeons; };

  /* 地狱难度体系（《四界区域与副本落位设计 v1.1》§2.5）：
     三界地狱难度各通关一次 → 各得一枚道之钥匙碎片，集齐才开道界。 */
  var HELL_TITLE = { fan: '破狱·凡尘', ling: '破狱·灵渊', xian: '破狱·仙穹' };
  var SHARD_WORLDS = ['fan', 'ling', 'xian'];
  var SHARD_NAME = { fan: '凡', ling: '灵', xian: '仙' };

  var scene = {
    smooth: true,
    view: 'hub',
    rows: [],
    briefTitle: '',
    briefLines: [],
    entrance: null,          /* 从区域裂隙进来时的落位 { slot, arch, region } */
    _pending: null,

    enter: function (params) {
      var save = G.game.save, meta = G.game.meta;
      if (!save) { G.game.changeScene('title'); return; }
      /* 防御性补字段（旧档 / 未在转世初始化） */
      if (save.dungeonSet == null) {
        save.dungeonSet = D().rollSet(save.worldSeed == null ? null : save.worldSeed + ':set');
        save.dungeonSlot = 0;
        save.dungeonRun = null;
      }
      save.dungeonPity = save.dungeonPity || { mid: 0, clear: 0 };

      if (params && params.fromBattle) this._afterBattle();
      /* 从区域裂隙进来：直接开**那一处**秘境的入口面板，而不是通用枢纽（缺口 U6） */
      else if (params && params.entrance) this._showEntrance(params.entrance);
      else this._showHub();
    },

    _worldId: function () { return G.Player.activeWorldId(G.game.meta); },
    _diff: function () {
      /* 难度**每界独立**（设计 v1.1 §2.5）：先读本界的 worldDiff，缺省回落到新游戏选的默认档。
         这样"普通通关凡界 → 日后回刷凡界地狱拿碎片"才成立。 */
      var p = G.game.meta && G.game.meta.progress;
      if (!p) return 'normal';
      var wd = p.worldDiff || {};
      return wd[this._worldId()] || p.difficulty || 'normal';
    },
    _slotIndex: function (archId) { return G.game.save.dungeonSet.indexOf(archId); },

    /* ================= 枢纽 ================= */
    _showHub: function () {
      var self = this;
      this.view = 'hub';
      this.rows = [];
      this.buttons = [];
      var world = this._worldId();

      /* 道界无秘境数据 */
      if (world === 'dao') {
        this.buttons.push(new G.UI.Btn({
          x: 190, y: 150, w: 100, h: 26, small: true, variant: 'gold',
          label: '返回', onClick: function () { G.game.changeScene('town'); }
        }));
        return;
      }

      var set = G.game.save.dungeonSet;
      for (var i = 0; i < set.length; i++) {
        var arch = D().archById(set[i]);
        var y = ROW.y0 + i * (ROW.h + ROW.gap);
        var r = { x: ROW.x, y: y, w: ROW.w, h: ROW.h };
        this.rows.push({ r: r, arch: arch, idx: i });

        (function (slot, rect, a) {
          var cur = G.game.save.dungeonSlot;
          var run = G.game.save.dungeonRun;
          var label = null, variant = 'default';
          if (slot < cur) { label = '重刷'; variant = 'ghost'; }
          else if (slot === cur) {
            if (run && run.archId === a.id) { label = '续关'; variant = 'gold'; }
            else { label = '进入'; variant = 'gold'; }
          }
          if (label) {
            self.buttons.push(new G.UI.Btn({
              x: rect.x + rect.w - 72, y: rect.y + 6, w: 64, h: 20,
              small: true, variant: variant, label: label,
              onClick: function () { self._startOrResume(slot); }
            }));
          }
        })(i, r, arch);
      }

      this.buttons.push(new G.UI.Btn({
        x: 10, y: 242, w: 90, h: 22, small: true, variant: 'ghost',
        label: '返回城镇', onClick: function () {
          G.game.changeScene(G.game.save.scene || 'town');
        }
      }));
    },

    /* ================= 区域裂隙 → 副本入口面板（缺口 U6）=================
       `regiongen.onInteract` 早就在裂隙上 changeScene('dungeon', { entrance })，
       但 enter() 只认 fromBattle —— 于是"点了裂隙"跳的是通用枢纽，
       玩家看到的不是他点的那一处秘境（地图上的落位白撒了）。
       这里按落位显示该处秘境：副本 / 推荐境界 / 最终首领 / 签名秘术 / 状态。
       槽位语义与枢纽一致：slot < dungeonSlot 可重刷、= 可挑战、> 封印中。 */
    _showEntrance: function (ent) {
      var self = this;
      this.entrance = ent;
      this.view = 'entrance';
      this.buttons = [];

      var slot = (ent && ent.slot) | 0;
      var arch = this._entranceArch(slot, ent);

      if (!arch) {
        this.buttons.push(new G.UI.Btn({
          x: 130, y: 188, w: 110, h: 26, small: true, variant: 'ghost',
          label: '返　回', onClick: function () { self._leaveEntrance(); }
        }));
        return;
      }

      var cur = G.game.save.dungeonSlot || 0;
      var open = slot <= cur;
      var farm = slot < cur;
      var label = farm ? '重刷秘境' : (slot === cur ? '进入秘境' : '封印中');

      this.buttons.push(new G.UI.Btn({
        x: 130, y: 188, w: 110, h: 26, small: true,
        variant: farm ? 'ghost' : 'gold', disabled: !open, label: label,
        onClick: function () {
          if (!open) { G.game.toast('封印未解：先通关前一秘境'); return; }
          self._startOrResume(slot);
        }
      }));
      this.buttons.push(new G.UI.Btn({
        x: 250, y: 188, w: 100, h: 26, small: true, variant: 'ghost',
        label: '返　回', onClick: function () { self._leaveEntrance(); }
      }));
    },

    /* 裂隙对应的副本原型：**以当世 dungeonSet 为准**（缺口 G20）——
       `ent.arch` 只在兜底时用，否则落位表与枢纽可能来自两条随机序列。 */
    _entranceArch: function (slot, ent) {
      var set = (G.game.save && G.game.save.dungeonSet) || [];
      var id = set[slot] || (ent && ent.arch);
      return id ? D().archById(id) : null;
    },

    _leaveEntrance: function () {
      var ent = this.entrance;
      var mapId = (ent && ent.region && G.Data.regions)
        ? G.Data.regions.mapIdOf(ent.region) : null;
      this.entrance = null;
      G.game.changeScene(mapId || (G.game.save.scene || 'town'));
    },

    onKey: function (code) {
      if (code === 'Escape' && this.view === 'entrance') this._leaveEntrance();
    },

    _startOrResume: function (slot) {
      var save = G.game.save, set = save.dungeonSet;
      var run = save.dungeonRun;
      if (slot === save.dungeonSlot && run && run.archId === set[slot]) {
        this._enterStage();
        return;
      }
      save.dungeonRun = {
        archId: set[slot], stage: 1,
        midBeaten: false, bigBeaten: false, restDone: false,
        farm: slot < save.dungeonSlot
      };
      G.Storage.saveCurrent(save);
      this._enterStage();
    },

    /* ================= 进入关卡 ================= */
    _enterStage: function () {
      var save = G.game.save, run = save.dungeonRun;
      var arch = D().archById(run.archId);
      var world = this._worldId();
      if (world === 'dao') { this._showHub(); return; }
      var slot = this._slotIndex(run.archId);
      var type = D().stageType(arch, run.stage);

      if (type === 'rest') { this._doRest(); return; }

      var st = D().makeStage(arch, world, slot, this._diff(), run.stage);
      G.Storage.saveCurrent(save);
      G.game.changeScene('battle', {
        mapId: 'dungeon',
        dungeon: { archId: run.archId, worldId: world, slot: slot,
          diff: this._diff(), stage: run.stage },
        enemies: st.enemies
      });
    },

    /* ================= 休整关（大副本第6关）================= */
    _doRest: function () {
      var save = G.game.save, run = save.dungeonRun;
      this.view = 'brief';
      this.briefTitle = '第 6 关 · 休整';
      var lines = [];
      if (!run.restDone) {
        run.restDone = true;
        var st = G.Player.computeStats(save);
        save.hp = st.maxhp;
        var poGain = 10 + G.rng.int(0, 20);
        save.po = (save.po || 0) + poGain;
        var stone = 20 + G.rng.int(0, 30);
        save.stone += stone;
        lines.push('灵泉汩汩，气血尽复，灵力 +' + poGain);
        lines.push('开启宝箱，灵石 +' + stone);
      } else {
        lines.push('灵泉已涸，宝箱已空');
      }
      run.stage = 7;
      this.briefLines = lines;
      this._pending = null;
      G.Storage.saveCurrent(save);
      this._buildBriefButtons('继续前行');
    },

    /* ================= 战斗返回 ================= */
    _afterBattle: function () {
      var save = G.game.save, run = save.dungeonRun;
      if (!run) { this._showHub(); return; }
      var arch = D().archById(run.archId);
      var type = D().stageType(arch, run.stage);
      var lines = [];

      this.view = 'brief';
      this.briefTitle = '第 ' + run.stage + ' 关 · ' + this._typeName(type);

      if (type === 'mid') {
        run.midBeaten = true;
        lines = this._rewardMid(arch, run, run.farm);
      } else if (type === 'big' || type === 'leader') {
        run.bigBeaten = true;
        lines = this._rewardClear(arch, run, run.farm);
      } else {
        lines = ['杂兵已清，前路可进'];
      }

      /* 推进关卡 / 准备通关 */
      var isFinal = run.stage >= arch.stages;
      if (isFinal) {
        var slot = this._slotIndex(run.archId);
        var ascendTo = this._planAscend(slot, run, arch);
        this._pending = { complete: true, slot: slot, ascendTo: ascendTo };
      } else {
        run.stage += 1;
        this._pending = null;
      }

      this.briefLines = lines;
      G.Storage.saveCurrent(save);
      this._buildBriefButtons(isFinal ? '通关结算' : '继续前行');
    },

    _typeName: function (t) {
      return { trash: '杂兵', elite: '精英', mid: '小 Boss',
        big: '大 Boss', leader: '头领', rest: '休整' }[t] || t;
    },

    /* ================= 奖励：小 Boss ================= */
    _rewardMid: function (arch, run, farm) {
      var save = G.game.save, L = D().anchorGL(this._worldId(), this._slotIndex(arch.id)) - 2;
      var rf = D().DIFF[this._diff()].res;
      var lines = [];
      save.dungeonPity = save.dungeonPity || { mid: 0, clear: 0 };

      if (!farm) {
        var stone = Math.round(12 * L * rf), qi = Math.round(160 * L * rf);
        save.stone += stone; save.qi += qi;
        this._addDan(1);
        lines.push('灵石 +' + stone + '　灵气 +' + qi + '　妖丹 ×1');
        lines.push('半场考验，未得签名秘术');
        return lines;
      }
      /* 重复刷：资源包；10% 尚缺秘术，每 8 次保底 */
      save.dungeonPity.mid += 1;
      var missing = this._missingSecrets();
      var giveSecret = (save.dungeonPity.mid >= 8 && missing.length)
        || (Math.random() < 0.10 && missing.length);
      if (giveSecret) {
        var id = missing[G.rng.int(0, missing.length - 1)];
        save.secrets[id] = D().secretGrade(this._worldId());
        save.dungeonPity.mid = 0;
        lines.push('寻得尚缺秘术：' + D().SECRETS[id]);
      } else {
        var st2 = Math.round(8 * L * rf), q2 = Math.round(100 * L * rf);
        save.stone += st2; save.qi += q2;
        lines.push('灵石 +' + st2 + '　灵气 +' + q2);
      }
      return lines;
    },

    /* ================= 奖励：通关（大 Boss / 头领）================= */
    _rewardClear: function (arch, run, farm) {
      var save = G.game.save, meta = G.game.meta;
      var L = D().anchorGL(this._worldId(), this._slotIndex(arch.id));
      var rf = D().DIFF[this._diff()].res;
      var lines = [];
      save.dungeonPity = save.dungeonPity || { mid: 0, clear: 0 };

      /* 地狱难度首杀 → 称号 + 跨世永久全属性 +10% + 道之钥匙碎片（设计 v1.1 §2.5）
         取代旧规则"地狱通关仙界掉整把钥匙"：现在是**三界各一枚碎片，集齐才开道界**。 */
      if (!farm && this._diff() === 'hell') {
        this.grantHell(meta, this._worldId()).forEach(function (l) { lines.push(l); });
      }

      if (!farm) {
        var stone = Math.round(25 * L * rf), qi = Math.round(320 * L * rf);
        save.stone += stone; save.qi += qi;
        this._addDan(2);
        lines.push('灵石 +' + stone + '　灵气 +' + qi + '　妖丹 ×2');
        var sec = D().secretById(arch.drop);
        if (sec && !save.secrets[sec.id]) {
          save.secrets[sec.id] = D().secretGrade(this._worldId());
          lines.push('签名秘术入囊：' + sec.n);
        } else {
          this._addDan(2);
          lines.push('秘术已习，折算妖丹 ×2');
        }
        return lines;
      }

      /* 重复刷：60% 资源 / 15% 尚缺秘术 / 稀有；5 次保底 */
      save.dungeonPity.clear += 1;
      var missing = this._missingSecrets();
      var roll = Math.random();
      var forceSecret = save.dungeonPity.clear >= 5 && missing.length;
      if (forceSecret || (roll < 0.15 && missing.length)) {
        var id2 = missing[G.rng.int(0, missing.length - 1)];
        save.secrets[id2] = D().secretGrade(this._worldId());
        save.dungeonPity.clear = 0;
        lines.push('寻得尚缺秘术：' + D().SECRETS[id2]);
      } else if (roll < 0.75 || !missing.length) {
        var s3 = Math.round(15 * L * rf), q3 = Math.round(200 * L * rf);
        save.stone += s3; save.qi += q3; this._addDan(1);
        lines.push('灵石 +' + s3 + '　灵气 +' + q3 + '　妖丹 ×1');
      } else {
        this._addDan(3);
        lines.push('稀有收获：妖丹 ×3');
      }
      return lines;
    },

    /* 地狱难度奖励发放（**纯逻辑**，无渲染依赖，便于无头测试）：
       给该界的称号 + hellCleared 标记 + 道之钥匙碎片；三枚齐则 daoKey = true。
       **幂等**：同一界只发一次（meta 去重），所以已通关的界回刷地狱不会重复发。 */
    grantHell: function (meta, world) {
      var lines = [];
      if (!meta || !HELL_TITLE[world]) return lines;
      meta.hellCleared = meta.hellCleared || {};
      meta.titles = meta.titles || [];
      meta.progress = meta.progress || {};
      meta.progress.daoShards = meta.progress.daoShards || { fan: false, ling: false, xian: false };

      if (!meta.hellCleared[world]) {
        meta.hellCleared[world] = true;
        if (meta.titles.indexOf(HELL_TITLE[world]) < 0) meta.titles.push(HELL_TITLE[world]);
        lines.push('踏破地狱 —— 得称号「' + HELL_TITLE[world] + '」（全属性 +10%，飞升后永久生效）');
      }
      if (!meta.progress.daoShards[world]) {
        meta.progress.daoShards[world] = true;
        var got = SHARD_WORLDS.filter(function (w) { return meta.progress.daoShards[w]; }).length;
        lines.push('得「道之钥匙碎片·' + SHARD_NAME[world] + '」（' + got + '/' + SHARD_WORLDS.length + '）');
        if (got >= SHARD_WORLDS.length && !meta.progress.daoKey) {
          meta.progress.daoKey = true;
          lines.push('三枚碎片共鸣 —— 「道之钥匙」已成，道界之门开启！');
        }
      }
      return lines;
    },

    _addDan: function (n) {
      var save = G.game.save;
      save.items = save.items || {};
      save.items['妖丹'] = (save.items['妖丹'] || 0) + n;
    },
    _missingSecrets: function () {
      var save = G.game.save, have = save.secrets || {};
      return Object.keys(D().SECRETS).filter(function (id) { return !have[id]; });
    },

    /* ================= 通关 / 飞升规划 ================= */
    _planAscend: function (slot, run, arch) {
      if (run.farm) return null;
      if (slot !== 4) return null;            /* 仅第 5 槽大 Boss 给飞升 */
      if (arch.kind !== 'big') return null;
      var world = this._worldId();
      var next = { fan: 'ling', ling: 'xian' }[world];
      if (next) return next;
      if (world === 'xian') {
        var p = G.game.meta.progress;
        if (p && p.daoKey && p.worlds && p.worlds.dao) return 'dao';
      }
      return null;
    },

    _continue: function () {
      if (this._pending && this._pending.complete) { this._completeDungeon(); return; }
      this._enterStage();
    },

    _completeDungeon: function () {
      var save = G.game.save, meta = G.game.meta, pend = this._pending;
      var run = save.dungeonRun;

      if (!run.farm && pend.slot === save.dungeonSlot) {
        save.dungeonSlot += 1;
      }
      save.dungeonFarm = (save.dungeonFarm || 0) + (run.farm ? 1 : 0);

      if (pend.ascendTo) {
        var toId = pend.ascendTo;
        meta.progress.worlds[toId] = true;
        var r = G.Player.ascend(save, meta, toId);
        if (r.ok) {
          /* 新界重抽秘境序列；该界的**天道入口落位**按界分桶写入（设计 v1.1 §6.1）。
             当前界由 Player.ascend 写 meta.progress.activeWorld，这里不另存副本。
             序列与落位**共用同一条序列**（缺口 G20），否则裂隙与枢纽对不上。 */
          save.dungeonSet = D().rollSet(save.worldSeed + ':set:' + toId);
          save.dungeonSlot = 0;
          save.dungeonRun = null;
          if (G.Data.regions) {
            save.entrances = save.entrances || {};
            save.entrances[toId] = G.Data.regions.rollEntrances(toId, save.worldSeed, save.dungeonSet);
          }
          G.Storage.saveCurrent(save);
          G.game.toast('飞升 ' + G.Player.worldById(toId).n);
          this._pending = null;
          this._showHub();
          return;
        }
      }

      save.dungeonRun = null;
      G.Storage.saveCurrent(save);
      this._pending = null;
      this._showHub();
    },

    /* ================= 简报按钮 ================= */
    _buildBriefButtons: function (mainLabel) {
      var self = this;
      this.buttons = [
        new G.UI.Btn({
          x: 150, y: BRIEF.y + BRIEF.h - 34, w: 110, h: 26, small: true,
          variant: 'gold', label: mainLabel,
          onClick: function () { self._continue(); }
        }),
        new G.UI.Btn({
          x: 272, y: BRIEF.y + BRIEF.h - 34, w: 100, h: 26, small: true,
          variant: 'ghost', label: '返回入口',
          onClick: function () { self._pending = null; self._showHub(); }
        })
      ];
    },

    /* ================= 渲染 ================= */
    render: function (x) {
      var g = x.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, '#080c18');
      g.addColorStop(1, '#141a2c');
      x.fillStyle = g; x.fillRect(0, 0, 480, 272);

      if (this.view === 'hub') this._renderHub(x);
      else if (this.view === 'entrance') this._renderEntrance(x);
      else this._renderBrief(x);

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    /* 区域裂隙的副本入口面板 */
    _renderEntrance: function (x) {
      var save = G.game.save, world = this._worldId(), P = ENT;
      var slot = (this.entrance && this.entrance.slot) | 0;
      var arch = this._entranceArch(slot, this.entrance);

      G.Overlays.dim(x);
      G.UI.frame(x, P, '秘 境 入 口', { paper: true });

      if (!arch) {
        G.UI.text(x, { x: 240, y: P.y + 74 }, '此处秘境尚未成形', 13, '#aab0c0', 'center');
        return;
      }

      var dn = D().DIFF[this._diff()].n;
      var ri = G.Player.realmInfo(D().anchorGL(world, slot));
      var spec = arch.big || arch.mid || arch.leader;
      var bossTitle = (spec && spec.title && (spec.title[world] || spec.title.fan)) || '—';
      var secId = arch.drop, secName = D().SECRETS[secId] || '—';
      var owned = !!(save.secrets && save.secrets[secId]);
      var cur = save.dungeonSlot || 0;
      var status = slot < cur ? '已通关 · 可重刷'
        : (slot === cur ? '可挑战' : '封印中 · 需先通关前一秘境');

      G.UI.text(x, { x: P.x + 20, y: P.y + 32 }, arch.n, 17, '#f0e2b0');
      G.UI.text(x, { x: P.x + 20, y: P.y + 54 },
        (arch.kind === 'big' ? '大副本' : '小副本') + ' · ' + arch.elem
        + '属性 · ' + arch.stages + ' 关', 11, '#9aa0b0');

      var rows = [
        ['所在界域', G.Player.worldById(world).n + '　' + dn + '难度'],
        ['推荐境界', ri.n],
        ['最终首领', bossTitle],
        ['签名秘术', secName + (owned ? '（已习）' : '（未习）')],
        ['状　　态', status]
      ];
      rows.forEach(function (r, i) {
        var yy = P.y + 74 + i * 19;
        G.UI.text(x, { x: P.x + 20, y: yy }, r[0], 11.5, '#8f95a6');
        G.UI.text(x, { x: P.x + 96, y: yy }, r[1], 11.5,
          (i === 4 && slot <= cur) ? '#e0c878' : '#d8d2c0');
      });
    },

    _renderHub: function (x) {
      var world = this._worldId();
      var wn = G.Player.worldById(world).n;
      var dn = D().DIFF[this._diff()].n;

      G.UI.textOut(x, { x: 240, y: 14 }, '秘 境 接 引 · ' + wn, 18,
        '#f0e2b0', 'center', 'rgba(6,8,14,0.7)', 3);
      G.UI.text(x, { x: 240, y: 32 }, '难度 ' + dn
        + '　通关进度 ' + Math.min(5, G.game.save.dungeonSlot) + '/5',
        10, '#8f95a6', 'center');

      if (world === 'dao') {
        G.UI.text(x, { x: 240, y: 120 }, '道界道则回廊尚未开放', 13,
          '#aab0c0', 'center');
        return;
      }

      for (var i = 0; i < this.rows.length; i++) {
        var row = this.rows[i], a = row.arch, r = row.r;
        var cur = G.game.save.dungeonSlot;
        G.UI.panel(x, r, 'rgba(20,26,40,0.92)', 'rgba(120,140,180,0.35)', 4);

        var kindCol = a.kind === 'big' ? '#e0a070' : '#80c89a';
        var kindTag = a.kind === 'big' ? '大副本' : '小副本';
        G.UI.text(x, { x: r.x + 10, y: r.y + 4 },
          (i + 1) + '. ' + a.n, 13, '#e8e2d0');
        G.UI.text(x, { x: r.x + 10, y: r.y + 19 },
          kindTag + ' · ' + a.elem + '属性', 9.5, kindCol);

        var status;
        if (i < cur) status = '已通关';
        else if (i === cur) {
          var run = G.game.save.dungeonRun;
          status = (run && run.archId === a.id) ? '续关 · 第 ' + run.stage + ' 关' : '可挑战';
        } else status = '封印中';
        var stCol = status === '封印中' ? '#6a7080'
          : (status === '可挑战' ? '#e0c878' : '#9aa0b0');
        G.UI.text(x, { x: r.x + r.w - 84, y: r.y + 10 }, status, 10, stCol, 'right');
      }
    },

    _renderBrief: function (x) {
      G.Overlays.dim(x);
      G.UI.frame(x, BRIEF, this.briefTitle, { paper: true });
      for (var i = 0; i < this.briefLines.length; i++) {
        G.UI.text(x, { x: BRIEF.x + 22, y: BRIEF.y + 48 + i * 20 },
          this.briefLines[i], 12, '#d8d2c0');
      }
    }
  };

  G.scenes.dungeon = scene;
})();
