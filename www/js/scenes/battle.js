/* 战斗场景 v3：侧视回合制（我方左 / 敌方右，1v1~1v3）
   ─ 有效速度定序（含麻痹 ×0.7）→ 指令 → 目标 → 演出 → 结算
   ─ 状态系统按战斗规格 v0.2 §8 真生效；蓄力技提前一回合预告（§9）
   ─ 奖励按经济表 v0.2 §4；剧情分支 killer / wolfKing / heartDemon */
(function () {
  var HERO_POS = { x: 122, y: 158, s: 58 };

  /* 敌方槽位：索引 0 = 前排（离主角最近），越靠后越远 */
  var E_SLOTS = [
    { x: 300, y: 172, s: 54 },
    { x: 366, y: 150, s: 54 },
    { x: 424, y: 134, s: 46 }
  ];
  var SOLO_SLOT = { x: 356, y: 152, s: 58 };
  var BOSS_SLOT = { x: 356, y: 148, s: 72 };
  /* 多敌站位：由近及远的一条斜线（近 = 离主角近 = 前排，v0.2 §5）。
     纵向间距必须大于名牌高度（24），否则相邻两只的名牌会叠在一起。 */
  var MULTI_SLOTS = [
    { x: 268, y: 178, s: 52 },
    { x: 364, y: 148, s: 54 },
    { x: 448, y: 116, s: 46 }
  ];

  var MAX_E = 3;

  var SPECIES_SPRITE = {
    '青纹蛇': 'snake', '赤炎狼': 'wolf', '树精': 'tree',
    '赤炎狼王': 'wolfking', '杀手': 'killer', '心魔': 'heartDemon',
    /* M1：血煞教（设计 M1 v1.0 §5.3）。心魔残影与心魔同形象（本就是它的影）。 */
    '血煞教徒': 'cultist', '血蝠': 'bloodbat', '血面': 'xuemian', '心魔残影': 'heartDemon'
  };

  /* M0 功法装配位上限（v0.3 §10） */
  var SKILL_SLOTS = 3;
  /* 逃跑：每场最多尝试次数（战斗规格 v0.2 §10） */
  var MAX_FLEE = 3;

  /* 消耗品（丹药治疗 = 目标最大 HP × 百分比） */
  var CONSUM = {
    '回春丹': { heal: 0.40, d: '回复四成气血' },
    '大还丹': { heal: 0.75, d: '回复七成五气血' },
    '聚气散': { qi: 500, d: '灵气 +500' },
    '醒神散': { cure: true, d: '解除异常状态' }
  };

  var scene = {
    smooth: true,
    params: null,
    mapId: 'field',

    /* ===== 生命周期 ===== */
    enter: function (params) {
      this.params = params || {};
      this.mapId = this.params.mapId || 'field';
      this.bg = null;
      this.round = 1;
      this.cue = []; this.cueDone = null;
      this.floaters = [];
      this.logs = [];
      this.shake = 0;
      this.lunge = {}; this.lungeT = {};
      this.flash = {};
      this.chargeMark = {};
      this.miss = {};                 /* 连续失手计数（命中保底） */
      this.auto = false;
      this.over = false;
      this.t = 0;
      this.pSkill = null;
      this.pTarget = null;
      this.fleeTries = 0;
      this.summonDone = false;
      this.enraged = false;

      this._initUnits();
      if (this.params.script === 'heartDemon') {
        this._log('服下突破丹，气机冲关——心魔现前。');
        this._log('心魔（' + G.Player.realmInfo(this.es[0].level).n + '）：照见的是你自己。');
      } else if (this.es.length > 1) {
        this._log('遭遇 ' + this.es.map(function (e) { return e.name; }).join('、'));
      } else {
        this._log('遭遇 ' + this.es[0].name + '（' + this.es[0].level + ' 级）');
      }
      this._log('请选择行动。');
      this.phase = 'command';
      this._buildCommand();
    },

    _initUnits: function () {
      var save = G.game.save;
      var st = G.Player.computeStats(save);

      /* 我方主动技：M0 装配上限 3（攻击功法优先，其次带主动的仙术） */
      var atkSkills = [], healSkills = [];
      Object.keys(save.skills || {}).forEach(function (id) {
        var sd = G.Data.skills[id];
        if (!sd) return;
        if (sd.kind === '攻击' && sd.mult) {
          atkSkills.push({ id: id, n: sd.n, mult: sd.mult, cd: sd.cd || 0, cdLeft: 0,
            hit: sd.hit, elem: sd.elem, status: sd.status, target: sd.target, kind: 'atk' });
        } else if (sd.active) {
          healSkills.push({ id: id, n: sd.active.n, mult: 0, heal: sd.active.heal,
            cd: sd.active.cd || 0, cdLeft: 0, hit: sd.active.hit, elem: sd.elem, kind: 'heal' });
        }
      });
      var skills = atkSkills.concat(healSkills).slice(0, SKILL_SLOTS);
      if (!skills.length) {
        skills.push({ id: 'basic', n: '凝气拳', mult: 1.0, cd: 0, cdLeft: 0,
          elem: st.attackElem, kind: 'atk' });
      }

      this.p = {
        name: '陆尘', side: 'left',
        level: save.globalLevel,
        maxhp: st.maxhp, hp: Math.max(1, save.hp),
        atk: st.atk, def: st.def, spd: st.spd,
        crit: st.crit, critDmg: st.critDmg,
        elem: st.attackElem, im: st.im,
        skills: skills, buffs: { atk: 0, turns: 0 },
        guard: false, statuses: {}, shield: 0
      };
      this._applySecretPassives();

      /* 敌方：脚本分支优先，其次参数里的敌群/单敌 */
      var p = this.params, list;
      if (p.script === 'killer') list = [G.Data.makeKiller()];
      else if (p.script === 'wolfKing') {
        list = [G.Data.makeWolfKing(save.world && save.world.names ? save.world.names.beastKing : null)];
      } else if (p.script === 'heartDemon') {
        list = [G.Data.makeHeartDemon({
          level: save.globalLevel, maxhp: st.maxhp,
          atk: st.atk, def: st.def, spd: st.spd
        })];
      } else if (p.enemies && p.enemies.length) list = p.enemies.slice();
      else list = [p.enemy || G.Data.makeEnemy('青纹蛇', 3, '青纹蛇')];

      this.es = list.slice(0, MAX_E);
      this.es.forEach(function (e, i) {
        e.key = 'E' + i;
        e.hp = e.maxhp;
        e.buffs = e.buffs || { atk: 0, turns: 0 };
        e.guard = false;
        e.statuses = e.statuses || {};
        e.im = e.im || [];
        e.charge = null;
        e.shield = e.shield || 0;
        e._phDone = {};
        e.skills = e.skills || [];
        e.skills.forEach(function (s) { if (s.cdLeft == null) s.cdLeft = 0; });
      });

      this._layout();
      this._resetTrackers();
    },

    /* 按敌人数与 Boss 存在与否分配站位；召唤后重排。
       单敌：站中景（Boss 略大）。多敌：排成一条由近及远的斜线，
       最末一只为「后排」，其余为「前排」——对应 v0.2 §5「双方均分前后排」。 */
    _layout: function () {
      var es = this.es, n = es.length;
      if (n === 1) {
        es[0].pos = es[0].boss ? BOSS_SLOT : SOLO_SLOT;
        es[0].front = true;
        return;
      }
      for (var i = 0; i < n; i++) {
        var e = es[i];
        var base = MULTI_SLOTS[Math.min(i, MULTI_SLOTS.length - 1)];
        /* Boss 在多敌中仍保持体型优势，位置沿用所在槽 */
        e.pos = e.boss ? { x: base.x, y: base.y - 8, s: Math.max(base.s, 62) } : base;
        e.front = i < n - 1;
      }
    },

    _resetTrackers: function () {
      var self = this;
      this.shown = {};
      this.lunge = {}; this.lungeT = {}; this.flash = {}; this.chargeMark = {};
      this._keys().forEach(function (k) {
        var u = self._unit(k);
        self.shown[k] = u.hp;
        self.lunge[k] = 0; self.lungeT[k] = 0; self.flash[k] = 0; self.chargeMark[k] = null;
      });
    },

    /* ===== 秘术·战斗被动（神术）初始化 =====
       血海=全局吸血 / 诛邪=命中概率封印 / 枯荣=受击回血次数 / 四象=开局护盾 */
    _applySecretPassives: function () {
      var save = G.game.save, Dg = G.Data.dungeons, p = this.p;
      p.shield = 0; p._secretVamp = 0; p._zhuxie = 0;
      p._kurongLeft = 0; p._kurong = null; p._mangshan = 0; p._secretUsed = {};
      var secs = save.secrets || {};
      Object.keys(secs).forEach(function (id) {
        var ef = Dg.secretEffectById(id);
        if (!ef) return;
        var g = Dg.gradeOf(save, id);
        if (ef.vamp) p._secretVamp += ef.vamp * g;
        if (ef.zhuxie) p._zhuxie = Math.max(p._zhuxie, ef.zhuxie);
        if (ef.kurong) {
          p._kurongLeft = Math.max(p._kurongLeft, ef.kurong.max);
          p._kurong = { chance: ef.kurong.chance, pct: ef.kurong.pct * g };
        }
        if (ef.mangshan) p._mangshan = Math.max(p._mangshan, Math.round(ef.mangshan * g));
        if (ef.startShield) {
          p.shield = Math.max(p.shield, Math.round(p.maxhp * ef.startShield * g));
        }
      });
    },

    /* ===== 单位寻址 ===== */
    _keys: function () {
      var ks = ['P'];
      for (var i = 0; i < this.es.length; i++) ks.push('E' + i);
      return ks;
    },
    _unit: function (key) {
      if (!key) return null;
      if (key === 'P') return this.p;
      var i = parseInt(String(key).slice(1), 10);
      if (isNaN(i)) return null;
      return this.es[i] || null;
    },
    _pos: function (key) {
      if (key === 'P') return HERO_POS;
      var u = this._unit(key);
      return (u && u.pos) || SOLO_SLOT;
    },
    _aliveEs: function () {
      var a = [];
      for (var i = 0; i < this.es.length; i++) if (this.es[i].hp > 0) a.push(this.es[i]);
      return a;
    },
    /* 我方存活单位（敌方全体技的目标；未来扩展队友时在此归并） */
    _alivePlayer: function () {
      return this.p.hp > 0 ? [this.p] : [];
    },

    /* ===== 指令区（v0.3 §10 裁剪：攻击 / 功法 / 道具 / 防御 / 逃跑） ===== */
    _buildCommand: function () {
      var self = this;
      var labels = ['攻击', '功法', '道具', '防御', '逃跑', '自动'];
      var btns = [];
      labels.forEach(function (lb, i) {
        var col = i % 3, row = Math.floor(i / 3);
        var b = new G.UI.Btn({
          x: 14 + col * 152, y: 208 + row * 32, w: 142, h: 28,
          small: true,
          variant: i === 0 ? 'gold' : (lb === '逃跑' ? 'danger' : 'default'),
          label: lb,
          onClick: function () { self._cmd(lb, this); }
        });
        b._key = lb;
        btns.push(b);
      });
      this.buttons = btns;
      this._syncCmdState();
    },

    _syncCmdState: function () {
      for (var i = 0; i < this.buttons.length; i++) {
        var b = this.buttons[i];
        if (!b._key) continue;
        if (b._key === '逃跑') {
          b.disabled = this._noFlee() || this.fleeTries >= MAX_FLEE;
          b.label = this.fleeTries >= MAX_FLEE ? '逃跑(尽)' : '逃跑';
        }
        if (b._key === '自动') b.label = this.auto ? '自动中' : '自动';
      }
    },

    /* Boss / 剧情战 / 心魔战禁用逃跑（v0.2 §10） */
    _noFlee: function () {
      if (this.params.script) return true;
      for (var i = 0; i < this.es.length; i++) if (this.es[i].boss) return true;
      return false;
    },

    _cmd: function (lb) {
      var self = this;
      if (lb === '攻击') { this._pickTarget(null); return; }
      if (lb === '功法') {
        if (this.p.statuses['封']) { this._log('封印未解，功法无从施展。'); return; }
        this._openSkill(); return;
      }
      if (lb === '道具') { this._openItem(); return; }
      if (lb === '防御') {
        this.p.guard = true;
        this._log('陆尘凝神守御，本回合减伤。');
        this._playerAction({ n: '防御', kind: 'guard' }, 'P');
        return;
      }
      if (lb === '逃跑') {
        if (this._noFlee()) { this._log('此战避无可避。'); return; }
        if (this.fleeTries >= MAX_FLEE) { this._log('已被缠住，走不脱了。'); return; }
        this.fleeTries += 1;
        /* 成功率 = 我方均速 ÷ (我方均速 + 敌方均速)，下限 10%、上限 90% */
        var my = this._effSpd(this.p);
        var alive = this._aliveEs();
        var sum = 0;
        for (var i = 0; i < alive.length; i++) sum += this._effSpd(alive[i]);
        var en = alive.length ? sum / alive.length : 0;
        var ch = en <= 0 ? 0.9 : my / (my + en);
        ch = Math.max(0.10, Math.min(0.90, ch));
        if (Math.random() < ch) {
          this._log('你抽身而退。');
          this._cut([[0.5, function () { self._leave(); }]]);
        } else {
          this._log('逃走失败！（第 ' + this.fleeTries + '/' + MAX_FLEE + ' 次）');
          this._playerAction(null, this._aliveEs()[0].key);
        }
        return;
      }
      if (lb === '自动') { this.auto = !this.auto; this._syncCmdState(); return; }
    },

    _openSkill: function () {
      var self = this;
      var btns = [];

      /* 装配功法 + 仙术主动秘术，合并为最多 8 项（4 行 × 2 列） */
      var entries = [];
      this.p.skills.slice(0, 4).forEach(function (sk) {
        entries.push({ kind: 'skill', sk: sk });
      });
      var Dg = G.Data.dungeons, save = G.game.save;
      Object.keys(save.secrets || {}).forEach(function (id) {
        var ef = Dg.secretEffectById(id);
        if (ef && ef.cat === '仙') entries.push({ kind: 'secret', id: id, ef: ef });
      });
      entries = entries.slice(0, 8);

      entries.forEach(function (en, i) {
        var x = 22 + (i % 2) * 218, y = 58 + Math.floor(i / 2) * 26;
        if (en.kind === 'skill') {
          var sk = en.sk, ready = sk.cdLeft <= 0;
          var ec = sk.elem && sk.elem !== '无' ? '　' + sk.elem : '';
          btns.push(new G.UI.Btn({
            x: x, y: y, w: 206, h: 24, small: true, disabled: !ready,
            label: sk.n + ec + (sk.cdLeft > 0 ? '（冷却 ' + sk.cdLeft + '）'
              : (sk.cd > 0 ? '（CD ' + sk.cd + '）' : '')),
            onClick: function () {
              if (sk.kind === 'heal') { self._playerAction(sk, 'P'); return; }
              self._pickTarget(sk);
            }
          }));
        } else {
          var used = self.p._secretUsed[en.id];
          btns.push(new G.UI.Btn({
            x: x, y: y, w: 206, h: 24, small: true, disabled: !!used,
            variant: 'gold',
            label: Dg.SECRETS[en.id] + (used ? '（已用）' : '　秘术'),
            onClick: function () { self._castSecret(en.id); }
          }));
        }
      });

      btns.push(new G.UI.Btn({
        x: 190, y: 164, w: 100, h: 22, small: true, variant: 'ghost', label: '返回',
        onClick: function () { self.phase = 'command'; self._buildCommand(); }
      }));
      this.buttons = btns;
      this.phase = 'skill';
    },

    /* 施放仙术主动秘术：按 cast.target 路由（self 治疗 / single 选目标 / all 直接出手）。
       数值随品阶 grade；每场每道限一次。 */
    _castSecret: function (id) {
      var self = this, Dg = G.Data.dungeons, save = G.game.save;
      var ef = Dg.secretEffectById(id), c = ef.cast, grade = Dg.gradeOf(save, id);
      this.p._secretUsed[id] = true;

      var sk = {
        n: Dg.SECRETS[id], elem: c.elem || '无', kind: 'atk',
        _secret: true
      };
      if (c.mult) sk.mult = +(c.mult * grade).toFixed(2);
      if (c.status) sk.status = c.status;
      if (c.pierce) sk.pierce = c.pierce;

      if (c.target === 'self') {
        sk.kind = 'healSelf';
        sk.healSelf = +(c.healSelf * grade).toFixed(2);
        this._playerAction(sk, 'P');
        return;
      }
      sk.target = c.target === 'all' ? '全体' : (c.target || 'single');
      if (sk.target === '全体') {
        var alive = this._aliveEs();
        if (!alive.length) { this._victory(); return; }
        this._playerAction(sk, alive[0].key);
        return;
      }
      this._pickTarget(sk);
    },

    _openItem: function () {
      var self = this;
      var save = G.game.save;
      var names = Object.keys(save.items || {}).filter(function (k) {
        return CONSUM[k] && save.items[k] > 0;
      }).slice(0, 6);
      var btns = [];
      if (!names.length) this._log('囊中并无可用之物。');
      names.forEach(function (nm, i) {
        btns.push(new G.UI.Btn({
          x: 22 + (i % 2) * 218, y: 58 + Math.floor(i / 2) * 26, w: 206, h: 24,
          small: true, variant: 'default',
          label: nm + ' ×' + save.items[nm],
          onClick: function () { self._useItem(nm); }
        }));
      });
      btns.push(new G.UI.Btn({
        x: 190, y: 164, w: 100, h: 22, small: true, variant: 'ghost', label: '返回',
        onClick: function () { self.phase = 'command'; self._buildCommand(); }
      }));
      this.buttons = btns;
      this.phase = 'item';
    },

    /* 目标选择：单敌自动锁定；多敌进入选目标浮层。
       技能若写死 target='前排'/'后排'，则只在该行内选（该行为空时退回全体存活）；
       M0 玩家功法无「全体」技，故不在此处理全体（v0.2 §6.2）。 */
    _pickTarget: function (sk) {
      var alive = this._aliveEs();
      if (!alive.length) return;
      var pool = alive;
      var row = sk && sk.target;
      if (row === '前排' || row === '后排') {
        var f = alive.filter(function (e) { return row === '前排' ? e.front : !e.front; });
        if (f.length) pool = f;
      }
      if (pool.length === 1) { this._playerAction(sk, pool[0].key); return; }
      var self = this, btns = [];
      pool.forEach(function (e, i) {
        btns.push(new G.UI.Btn({
          x: 22 + (i % 2) * 218, y: 58 + Math.floor(i / 2) * 26, w: 206, h: 24,
          small: true,
          label: e.name + (e.front ? '·前排' : '·后排') + '　'
            + Math.max(0, Math.round(e.hp)) + '/' + e.maxhp,
          onClick: function () { self._playerAction(sk, e.key); }
        }));
      });
      btns.push(new G.UI.Btn({
        x: 190, y: 164, w: 100, h: 22, small: true, variant: 'ghost', label: '返回',
        onClick: function () { self.phase = 'command'; self._buildCommand(); }
      }));
      this.buttons = btns;
      this.phase = 'target';
    },

    _useItem: function (nm) {
      var self = this, save = G.game.save;
      var it = CONSUM[nm];
      save.items[nm] -= 1;
      if (save.items[nm] <= 0) delete save.items[nm];
      G.Storage.saveCurrent(save);
      this.pSkill = { n: nm, kind: 'item' };
      this.pTarget = 'P';
      this.phase = 'exec';
      this.buttons = [];
      var steps = [];
      if (it.heal) {
        var amt = Math.round(this.p.maxhp * it.heal);
        steps.push([0.35, function () {
          self._heal('P', amt);
          self._log('服下 ' + nm + '，回复 ' + amt + ' 气血。');
        }]);
      } else if (it.qi) {
        save.qi = (save.qi || 0) + it.qi;
        steps.push([0.3, function () { self._log('服下 ' + nm + '，灵气 +' + it.qi + '。'); }]);
      } else {
        steps.push([0.3, function () { self.p.statuses = {}; self._log('服下 ' + nm + '，异常尽解。'); }]);
      }
      this._cut(steps, function () { self._resolve(); });
    },

    /* ===== 行动流程 =====
       一回合 = 我方 + 存活敌方的有效速度归并排序 → 各自"行动开始结算" → 出手 → 回合结束 */
    _effSpd: function (u) {
      return (u.spd || 0) * (u.statuses && u.statuses['麻'] ? 0.7 : 1);
    },

    _playerAction: function (skill, targetKey) {
      this.pSkill = skill;
      this.pTarget = targetKey || 'P';
      this._resolve();
    },

    _resolve: function () {
      var self = this;
      this.phase = 'exec';
      this.buttons = [];

      var actors = [{ key: 'P', u: this.p }];
      this.es.forEach(function (e, i) {
        if (e.hp > 0) actors.push({ key: 'E' + i, u: e });
      });
      actors.sort(function (a, b) {
        return self._effSpd(b.u) - self._effSpd(a.u);
      });

      var i = 0;
      function next() {
        if (self.over) return;
        if (self.p.hp <= 0) { self._defeat(); return; }
        if (!self._aliveEs().length) { self._victory(); return; }
        if (i >= actors.length) { self._endRound(); return; }
        var a = actors[i++];
        var u = a.u;
        if (u.hp <= 0) { next(); return; }

        /* Boss 阶段技：血量过线时召唤 / 狂暴 */
        if (u.boss) self._bossPhase(u);

        /* 行动开始：先结算 DOT，再判睡眠；DOT 致死则跳过本回合行动 */
        var canAct = self._tickStatus(u, a.key);
        if (u.hp <= 0) { next(); return; }
        if (!canAct) { next(); return; }

        if (a.key === 'P') {
          var sk = self.pSkill;
          self.pSkill = null;
          if (sk && (sk.kind === 'item' || sk.kind === 'guard')) {
            self._cut([[0.12, function () {}]], next);
            return;
          }
          var tgt = self._unit(self.pTarget);
          if (!tgt || tgt.hp <= 0) {
            var alive = self._aliveEs();
            if (!alive.length) { self._victory(); return; }
            tgt = alive[0];
          }
          self._act(self.p, tgt, 'P', tgt.key, sk, next);
        } else {
          self._act(u, self.p, a.key, 'P', self._enemyPick(u), next);
        }
      }
      next();
    },

    /* Boss 血量阈值技：有 phases 配置走通用引擎，否则退回 M0 狼王写死逻辑。 */
    _bossPhase: function (boss) {
      if (boss.phases && boss.phases.length) { this._genericPhases(boss); return; }
      this._wolfPhases(boss);
    },

    /* 通用阶段：每条 phase 血量过线一次（done 标记挂在单位上，各 Boss 独立）。 */
    _genericPhases: function (boss) {
      for (var i = 0; i < boss.phases.length; i++) {
        var ph = boss.phases[i];
        if (boss._phDone[i]) continue;
        if (boss.hp > 0 && boss.hp <= boss.maxhp * ph.trig) {
          boss._phDone[i] = true;
          this._runPhase(boss, ph);
        }
      }
    },

    _runPhase: function (boss, ph) {
      var self = this, n;
      if (ph.kind === 'summon') {
        n = Math.min(MAX_E - this.es.length, ph.n || 1);
        for (var i = 0; i < n; i++) {
          this._addEnemy(G.Data.dungeons.makeSummon(ph.spec, boss.level));
        }
        this._log(boss.name + ' 召来「' + ph.spec.name + '」×' + n + '！');
      } else if (ph.kind === 'clone') {
        n = Math.min(MAX_E - this.es.length, ph.n || 2);
        for (var j = 0; j < n; j++) this._addEnemy(this._makeClone(boss, ph.pct || .45));
        this._log(boss.name + ' 分裂出影身 ×' + n + '！');
      } else if (ph.kind === 'enrage') {
        boss._rage = (boss._rage || 1) * (1 + (ph.atk || 0));
        if (ph.cdCut) ph.cdCut.forEach(function (c) {
          boss.skills.forEach(function (s) {
            if (s && c.match && s.n.indexOf(c.match) >= 0) s.cd = c.cd;
          });
        });
        this._log(boss.name + ' 凶性大发，攻势暴涨 ' + Math.round((ph.atk || 0) * 100) + '%！');
      } else if (ph.kind === 'heal') {
        var amt = Math.round(boss.maxhp * (ph.pct || .2));
        this._heal(boss.key, amt);
        this._log(boss.name + ' 运转玄功，回复 ' + amt + ' 气血！');
      }
    },

    _makeClone: function (boss, pct) {
      function r(v) { return Math.max(1, Math.round(v * pct)); }
      var hp = r(boss.maxhp);
      return {
        name: boss.name + '·影', species: boss.species, artKey: null, sprite: boss.sprite,
        level: boss.level, maxhp: hp, hp: hp,
        atk: r(boss.atk), def: r(boss.def), spd: boss.spd,
        elem: boss.elem, boss: false,
        skills: boss.skills.map(function (s) { return JSON.parse(JSON.stringify(s)); }),
        phases: [], shield: 0, buffs: { atk: 0, turns: 0 },
        guard: false, statuses: {}, im: [], charge: null
      };
    },

    /* 战中增员：补全字段 → 入列 → 重排 → 初始化演出追踪。 */
    _addEnemy: function (u) {
      u.key = 'E' + this.es.length;
      u.hp = (u.hp != null) ? u.hp : u.maxhp;
      u.buffs = u.buffs || { atk: 0, turns: 0 };
      u.guard = false; u.statuses = u.statuses || {}; u.im = u.im || [];
      u.charge = null; u.shield = u.shield || 0; u._phDone = {};
      u.skills = u.skills || [];
      u.skills.forEach(function (s) { if (s.cdLeft == null) s.cdLeft = 0; });
      this.es.push(u);
      this._layout();
      this.shown[u.key] = u.hp;
      this.lunge[u.key] = 0; this.lungeT[u.key] = 0;
      this.flash[u.key] = 0; this.chargeMark[u.key] = null;
    },

    /* M0 狼王：<50% 召唤群狼（仅 1 次）；<30% 烈焰风暴 CD 缩短 */
    _wolfPhases: function (boss) {
      if (!this.summonDone && boss.hp > 0 && boss.hp < boss.maxhp * 0.5) {
        this.summonDone = true;
        if (this.es.length < MAX_E) {
          var w = G.Data.makeEnemy('赤炎狼', 5, '群狼');
          this._addEnemy(w);
          this._log(boss.name + ' 仰首长嗥，呼唤群狼！');
        }
      }
      if (!this.enraged && boss.hp > 0 && boss.hp < boss.maxhp * 0.3) {
        this.enraged = true;
        boss.skills.forEach(function (s) {
          if (/风暴/.test(s.n)) s.cd = 3;
        });
        this._log(boss.name + ' 双目赤红，狂暴了——大招愈发频繁！');
      }
    },

    /* 敌方选招：蓄力技先预告一回合，次回合才真正打出（给玩家防御窗口） */
    _enemyPick: function (u) {
      if (u.charge) {
        var ready = u.charge;
        u.charge = null;
        ready.cdLeft = ready.cd || 2;
        return ready;
      }
      var usable = u.skills.filter(function (s) { return s.cdLeft <= 0; });
      if (usable.length && Math.random() < 0.55) {
        var s = usable[Math.floor(Math.random() * usable.length)];
        s.cdLeft = s.cd || 2;
        if (s.charge) {
          u.charge = s;
          return { n: '蓄力', mult: 0, elem: '无', kind: 'charge', _src: s.n };
        }
        return s;
      }
      return { n: '攻击', mult: 1.0, elem: u.elem || '无', kind: 'atk' };
    },

    _act: function (atk, def, aKey, dKey, skill, done) {
      var self = this;
      skill = skill || { n: '攻击', mult: 1.0, elem: atk.elem || '无', kind: 'atk' };
      var steps = [];

      if (skill.kind === 'charge') {
        var src = skill._src || '绝技';
        steps.push([0.30, function () {
          self.chargeMark[aKey] = src;
          self._log(atk.name + ' 气机暴涨，正在蓄力「' + src + '」！');
        }]);
        steps.push([0.28, function () {
          self._log('—— 下回合务必守御或速攻。');
        }]);
        this._cut(steps, done);
        return;
      }

      if (skill.kind === 'shield') {
        steps.push([0.30, function () {
          var amt = Math.round(atk.maxhp * (skill.pct || .15));
          atk.shield = Math.min(atk.maxhp, (atk.shield || 0) + amt);
          self._float(aKey, '护盾', '#9ac8ff');
          self._log(atk.name + ' 凝出护盾，可吸收 ' + amt + ' 点伤害。');
        }]);
        steps.push([0.25, function () {}]);
        this._cut(steps, done);
        return;
      }

      if (skill.kind === 'status') {
        steps.push([0.18, function () {
          self._log(atk.name + ' 施展「' + skill.n + '」！');
          self.lungeT[aKey] = aKey === 'P' ? 34 : -30;
        }]);
        steps.push([0.26, function () {
          self.lungeT[aKey] = 0;
          var mkey = aKey + '|' + skill.n;
          var streak = self.miss[mkey] || 0;
          var hit = Math.max(5, skill.hit == null ? 100 : skill.hit);
          if (streak < 2 && Math.random() * 100 > hit) {
            self.miss[mkey] = streak + 1;
            self._log('—— 落空了。');
            return;
          }
          self.miss[mkey] = 0;
          if (skill.status) {
            var chance = skill.status.chance || 0;
            if (def.level != null && atk.level != null && def.level > atk.level + 5) chance *= .5;
            if (Math.random() < chance) self._applyStatus(def, dKey, skill.status.t);
          }
        }]);
        this._cut(steps, done);
        return;
      }

      if (skill.buff) {
        steps.push([0.3, function () {
          atk.buffs.atk = skill.buff.atk; atk.buffs.turns = skill.buff.turns;
          self._log(atk.name + ' 气势暴涨，攻势提升！');
        }]);
        steps.push([0.3, function () {}]);
        this._cut(steps, done);
        return;
      }
      if (skill.healSelf) {
        var amt = Math.round(atk.maxhp * skill.healSelf);
        steps.push([0.35, function () {
          self._heal(aKey, amt);
          self._log(atk.name + ' 汲取草木精元，回复 ' + amt + '。');
        }]);
        steps.push([0.35, function () {}]);
        this._cut(steps, done);
        return;
      }

      steps.push([0.18, function () {
        if (skill.n !== '攻击' && skill.n !== '普通攻击') self._log(atk.name + ' 施展「' + skill.n + '」！');
        else self._log(atk.name + ' 发起攻击。');
        self.lungeT[aKey] = aKey === 'P' ? 34 : -30;
      }]);
      steps.push([0.26, function () {
        self.lungeT[aKey] = 0;
        if (skill.charge) self.chargeMark[aKey] = null;   /* 蓄力已释放 */

        /* 命中（单体）：技能自带命中率，下限 5%；连续失手两次后第三次保底命中。
           全体技改为逐目标判定（见下），跳过此处的整段失手计数。 */
        var isAll = skill.target === '全体';
        var mkey = aKey + '|' + (skill.n || '攻击');
        var streak = self.miss[mkey] || 0;
        var hit = Math.max(5, skill.hit == null ? 100 : skill.hit);
        if (!isAll) {
          if (streak < 2 && Math.random() * 100 > hit) {
            self.miss[mkey] = streak + 1;
            self._log('—— 落空了。');
            return;
          }
          if (streak >= 2) self._log('（连失两度，此番必中）');
          self.miss[mkey] = 0;
        }

        if (skill.kind === 'heal' && skill.heal) {
          /* 技能治疗 = 施法者 ATK × 倍率 × 浮动 × 暴击系数（v0.2 §6.3） */
          var hv = atk.atk * skill.heal * (0.9 + Math.random() * 0.2);
          var hc = Math.random() < (atk.crit || 0.05);
          if (hc) hv *= (atk.critDmg || 1.5);
          hv = Math.max(1, Math.round(hv));
          self._heal(aKey, hv);
          self._log('灵光回流，回复 ' + hv + ' 气血。' + (hc ? ' 会心！' : ''));
          return;
        }

        /* 目标列表：全体技打对方全部存活单位，否则只打选定目标 */
        var targets;
        if (isAll) {
          var pool = aKey === 'P'
            ? self._aliveEs().map(function (e) { return { u: e, key: e.key }; })
            : self._alivePlayer().map(function (u) { return { u: u, key: 'P' }; });
          targets = pool;
        } else targets = [{ u: def, key: dKey }];

        var totalHp = 0;
        /* 多段攻击（M1 §5.2 疾风九刃）：hits 段独立结算，每段各自判定暴击 / 克制 / 浮动。
           ⚠️ 只在**单体技**上生效 —— 全体技 × 多段没有设计需求，且会让逐目标日志爆掉。 */
        var segs = isAll ? 1 : Math.max(1, skill.hits || 1);
        targets.forEach(function (t) {
          if (!t.u || t.u.hp <= 0) return;
          /* 全体技逐目标命中（无 hit 字段默认必中） */
          if (isAll) {
            var hh = Math.max(5, skill.hit == null ? 100 : skill.hit);
            if (Math.random() * 100 > hh) { self._log(atk.name + ' 攻向 ' + t.u.name + '，却落空了。'); return; }
          }
          for (var si = 0; si < segs; si++) {
            if (t.u.hp <= 0) break;
            var r = self._calc(atk, t.u, skill);
            var hpDmg = self._impact(t.key, r);
            totalHp += hpDmg;
            var extra = G.Data.elem.label(r.ec);
            if (r.crit) extra = ' 会心一击！' + extra;
            self._log(atk.name + ' 命中 ' + t.u.name + '，造成 ' + hpDmg + ' 点伤害。'
              + (segs > 1 ? '（第 ' + (si + 1) + '/' + segs + ' 段）' : '') + extra);

            /* 附加状态与诛邪封印**只在最后一段判定一次** ——
               否则多段会把控制概率叠成近似必中（设计上多段只加伤害，不加控制）。 */
            if (si < segs - 1) continue;
            if (skill.status) {
              var chance = skill.status.chance || 0;
              if (t.u.level != null && atk.level != null && t.u.level > atk.level + 5) chance *= 0.5;
              if (Math.random() < chance) self._applyStatus(t.u, t.key, skill.status.t);
            }
            if (aKey === 'P' && atk._zhuxie && t.u.hp > 0
              && Math.random() < atk._zhuxie) {
              self._applyStatus(t.u, t.key, '封');
            }
          }
        });

        /* 吸血：技能自带 vamp + 玩家「血海神术」全局吸血，按实际气血伤害回复 */
        var vampRate = (skill.vamp || 0) + (aKey === 'P' ? (atk._secretVamp || 0) : 0);
        if (vampRate > 0 && totalHp > 0) {
          var vh = Math.round(totalHp * vampRate);
          if (vh > 0) { self._heal(aKey, vh); self._log(atk.name + ' 汲取气血，回复 ' + vh + '。'); }
        }
      }]);
      this._cut(steps, done);
    },

    /* 施加状态：免疫则免疫；重复附加刷新时长；封印打断蓄力（v0.2 §8.1 / §9） */
    _applyStatus: function (u, key, t) {
      if ((u.im || []).indexOf(t) >= 0) {
        this._log(u.name + ' 体质特异，「' + t + '」不侵！');
        return;
      }
      var dur = t === '封' ? 2 : (t === '睡' ? 1 + Math.floor(Math.random() * 2) : 3);
      u.statuses[t] = dur;
      this._float(key, t, '#c8a8e8');
      this._log(u.name + ' 陷入「' + t + '」！');
      if (t === '封' && u.charge) {
        u.charge.cdLeft = Math.max(1, Math.ceil((u.charge.cd || 2) / 2));
        u.charge = null;
        this.chargeMark[key] = null;
        this._log('—— ' + u.name + ' 蓄力被打断！');
      }
    },

    /* 伤害 = (攻×倍率×增益×狂暴 − 防×0.55×(1−破防)) × 属性克制 × 浮动 × 守御 × 暴击 */
    _calc: function (atk, def, skill) {
      var mult = skill.mult == null ? 1 : skill.mult;
      var buff = 1 + (atk.buffs && atk.buffs.atk || 0);
      var rage = atk._rage || 1;
      var defTerm = def.def * 0.55;
      if (skill.pierce) defTerm *= (1 - skill.pierce);
      var base = Math.max(1, atk.atk * mult * buff * rage - defTerm);
      var ec = G.Data.elem.coef(skill.elem, def.elem);
      base *= ec;
      var guard = def.guard ? 0.55 : 1;
      var v = base * (0.9 + Math.random() * 0.2) * guard;
      var crit = Math.random() < (atk.crit || 0.05);
      if (crit) v *= (atk.critDmg || 1.5);
      return { dmg: Math.max(1, Math.round(v)), crit: crit, ec: ec };
    },

    /* 行动开始结算（v0.2 §8.1）：中毒 5% 最大气血（可致死）、
       灼烧 8% 当前气血（保底 1 血）、睡眠禁止行动。
       返回该单位本回合能否行动。 */
    _tickStatus: function (u, key) {
      var self = this, canAct = true;
      if (u.statuses['睡']) {
        canAct = false;
        this._log(u.name + ' 沉眠未醒，无法行动。');
      }
      ['毒', '烧'].forEach(function (k) {
        if (!u.statuses[k]) return;
        var d = Math.max(1, Math.round(k === '毒' ? u.maxhp * 0.05 : u.hp * 0.08));
        u.hp = k === '烧' ? Math.max(1, u.hp - d) : Math.max(0, u.hp - d);
        self._float(key, '-' + d, k === '烧' ? '#ff9a5a' : '#a8e07a');
        self._log(u.name + ' 受「' + k + '」侵蚀，损失 ' + d + '。');
      });
      Object.keys(u.statuses).forEach(function (k) {
        u.statuses[k] -= 1;
        if (u.statuses[k] <= 0) delete u.statuses[k];
      });
      return canAct;
    },

    _endRound: function () {
      /* 冷却与增益递减 */
      var self = this;
      [this.p].concat(this.es).forEach(function (u) {
        u.skills.forEach(function (s) { if (s.cdLeft > 0) s.cdLeft -= 1; });
        if (u.buffs && u.buffs.turns > 0) {
          u.buffs.turns -= 1;
          if (u.buffs.turns <= 0) u.buffs.atk = 0;
        }
        u.guard = false;
      });
      /* 芒山聚灵：每回合回复灵力（写回 save.po） */
      var save = G.game.save;
      if (this.p._mangshan) {
        save.po = (save.po || 0) + this.p._mangshan;
        this._float('P', '灵力 +' + this.p._mangshan, '#9ad0ff');
      }
      this.pSkill = null;
      this.round += 1;
      this._log('—— 第 ' + this.round + ' 回合 ——');
      this.phase = 'command';
      this._buildCommand();
      if (this.auto) {
        this._cut([[0.35, function () {
          var k = self._autoTargetKey();
          if (k) self._playerAction(null, k);
        }]]);
      }
    },

    /* 自动战斗选目标：普攻「前排 70% / 后排 30%」（v0.2 §6.2） */
    _autoTargetKey: function () {
      var alive = this._aliveEs();
      if (!alive.length) return null;
      if (alive.length === 1) return alive[0].key;
      var front = [], back = [];
      alive.forEach(function (e) { (e.front ? front : back).push(e); });
      var pool = (front.length && (!back.length || Math.random() < 0.7)) ? front : back;
      if (!pool.length) pool = alive;
      return pool[Math.floor(Math.random() * pool.length)].key;
    },

    /* ===== 演出效果 ===== */
    _cut: function (steps, done) {
      this.cue = steps.map(function (s) { return { t: s[0], fn: s[1] }; });
      this.cueDone = done || null;
    },

    _impact: function (key, r) {
      this.flash[key] = 1;
      var u = this._unit(key);
      if (!u) return 0;
      var dmg = r.dmg;
      /* 护盾池优先吸收；吸收完才扣气血 */
      if (u.shield > 0) {
        var ab = Math.min(u.shield, dmg);
        u.shield -= ab; dmg -= ab;
        if (ab > 0) this._float(key, '护盾 -' + ab, '#9ac8ff');
      }
      u.hp = Math.max(0, u.hp - dmg);
      /* 睡眠：受直接气血伤害即醒（DOT 不醒，护盾全挡也不醒，v0.2 §8.1） */
      if (dmg > 0 && u.statuses && u.statuses['睡']) {
        delete u.statuses['睡'];
        this._log(u.name + ' 受创惊醒！');
      }
      /* 枯荣神术：玩家受直接伤害后概率回 maxHP 的一定比例，每场限次 */
      if (key === 'P' && dmg > 0 && u._kurong && u._kurongLeft > 0
        && Math.random() < u._kurong.chance) {
        u._kurongLeft -= 1;
        var kh = Math.round(u.maxhp * u._kurong.pct);
        this._heal(key, kh);
        this._log('枯荣轮转，受创反生，回复 ' + kh + ' 气血。');
      }
      if (dmg > 0) this._float(key, '-' + dmg, r.crit ? '#ffd45a' : '#ffd8d0', r.crit);
      else this._float(key, '格挡', '#9ac8ff');
      this.shake = r.crit ? 7 : 3;
      return dmg;
    },

    _heal: function (key, amt) {
      var u = this._unit(key);
      if (!u) return;
      u.hp = Math.min(u.maxhp, u.hp + amt);
      this._float(key, '+' + amt, '#8fe0a0');
    },

    _float: function (key, txt, col, big) {
      var pos = this._pos(key);
      this.floaters.push({
        x: pos.x + (Math.random() - 0.5) * 18,
        /* 起点压低、上浮距离缩短：原来会一路飘进名牌血条面板里 */
        y: pos.y - pos.s * 0.40,
        txt: txt, col: col || '#fff', t: 0, big: !!big, rise: 24
      });
    },

    _log: function (s) {
      this.logs.push(s);
      if (this.logs.length > 40) this.logs.shift();
    },

    /* ===== 结算 ===== */
    _victory: function () {
      var save = G.game.save;
      if (!this.keepHp) save.hp = Math.max(1, this.p.hp);
      var p = this.params;

      /* 公共记账：每场战斗耗岁 1/10 岁（轮回 v0.4 §3.2）+ 本世最高境界 */
      G.Player.agePush(save, 'battle', 1);
      save.maxGlobalLevel = Math.max(save.maxGlobalLevel || 1, save.globalLevel || 1);

      /* m0-1 沈伯教学：进山打赢 1 场（v0.3 §主线任务表）→ 回镇找沈伯领灵石 50 并解锁 m0-2。
         此前 won1 全项目无人写入，m0-1 → m0-2 直接断链、主线永久卡死。 */
      if (!p.script && save.quest && save.quest.step === 'm0-1') save.quest.flags.won1 = true;

      if (p.script === 'killer') {
        save.stone += 100; save.qi += 1000;
        save.quest.flags.templeDone = true;
        save.quest.flags.vessel = true;
        save.quest.step = 'm0-3';
        G.Player.chronicle(save, 'vessel', '山神庙得' + (save.world.vessel || '逆命珠'));
        /* 天道注视 +10（v2.7） */
        if (G.TianDao) G.TianDao.notify('vessel');
        this._log('灵石 +100　灵气 +1000');
        this._log('杀手倒地。你握着那枚器物，只觉心口发烫。');
        /* 打斗就发生在庙里 → 打完了还站在庙里，而不是被丢回山道 */
        this._finish(true, 'field_temple');
        return;
      }

      if (p.script === 'heartDemon') {
        var info = G.Player.winBigBreak(save);
        save.qi += 300;                       /* 突破成功即奖励（经济表 §4 心魔行） */
        save.quest.step = 'm0-5';
        this.keepHp = true;                   /* 突破已回满气血，勿被战斗残血覆盖 */
        G.Player.chronicle(save, 'heartDemon', '问心破魔，入' + info.n);
        this._log('心魔溃散！丹田一震，气机贯通——' + info.n + '。');
        this._log('灵气 +300　下一步：修至炼气三段，再探赤牙洞。');
        this._finish(true, 'town');
        return;
      }

      if (p.script === 'wolfKing') {
        save.stone += 500; save.qi += 3000;
        save.items['妖丹'] = (save.items['妖丹'] || 0) + 3;
        save.bossKilled = true;
        save.bossKills = (save.bossKills || 0) + 1;   /* 仙力结算按次计（v0.4 §4） */
        save.quest.step = 'free';
        var drop = G.rng.pick(G.Data.skillDropPool);
        if (!save.skills[drop]) save.skills[drop] = { lv: 1 };
        G.Player.chronicle(save, 'wolfKing', '手刃赤炎狼王');
        /* 天道注视 +8（v2.7，统一走 notify；可能触发低语） */
        if (G.TianDao) G.TianDao.notify('boss');
        this._log('灵石 +500　灵气 +3000　妖丹 ×3　功法：' + G.Data.skills[drop].n);
        this._finish(true, 'cave');
        return;
      }

      /* 副本战：杂兵/精英走通用收益，Boss 关由副本场景结算；打完回副本场景推进。 */
      if (p.dungeon) {
        var dg = p.dungeon;
        /* 道界试炼（缺口 U4）：没有「关卡序列」这一套 —— 一场定胜负，
           奖励与进境全部由副本场景的 _afterDaoBattle 结算，这里只回场。 */
        if (dg.dao) {
          G.Storage.saveCurrent(save);
          this._finishDungeon();
          return;
        }
        var darch = G.Data.dungeons.archById(dg.archId);
        var dtype = G.Data.dungeons.stageType(darch, dg.stage);
        if (dtype === 'trash' || dtype === 'elite') {
          var dr = G.Player.rates(save);
          var dlg = save.linggen || { elems: ['无'], coef: {} };
          var dlgCoef = (dlg.coef && dlg.coef[(dlg.elems && dlg.elems[0]) || '无']) || 1;
          var dqi = 0, dpo = 0, dst = 0, dcut = false;
          this.es.forEach(function (e) {
            var L = e.level;
            var gap = ((save.globalLevel || 1) - L) > 5 ? .5 : 1;
            if (gap < 1) dcut = true;
            dqi += Math.round(80 * L * dlgCoef * (1 + (dr.qi || 0)) * gap * G.Player.realmQiCoef(L));
            dpo += Math.round(8 * L * (1 + (dr.po || 0)) * gap);
            dst += Math.round(6 * L * (1 + (dr.st || 0)) * gap);
          });
          save.qi = (save.qi || 0) + dqi;
          save.po = (save.po || 0) + dpo; save.stone += dst;
          this._log('战利：灵气 +' + dqi + '　灵力 +' + dpo + '　灵石 +' + dst
            + (dcut ? '（境界压制，收益减半）' : ''));
        }
        G.Storage.saveCurrent(save);
        this._finishDungeon();
        return;
      }

      /* 普通遭遇（经济表 v0.2 §4）：逐只结算再合计
         灵气 80×L×灵根系数×(1+灵气加成)×境界系数（缺口 U5）/ 灵力 8×L×(1+灵力加成)
         灵石 6×L×(1+灵石加成)；主角境界 − L > 5 → 该只 ×0.5
         **道界例外**（境界 v3.2 §10.3）：道界不流通灵石，野外所得折算为**道晶**。 */
      var r = G.Player.rates(save);
      var lg = save.linggen || { elems: ['无'], coef: {} };
      var lgCoef = (lg.coef && lg.coef[(lg.elems && lg.elems[0]) || '无']) || 1;
      var qi = 0, po = 0, st = 0, cut = false;
      this.es.forEach(function (e) {
        var L = e.level;
        var gap = ((save.globalLevel || 1) - L) > 5 ? 0.5 : 1;
        if (gap < 1) cut = true;
        qi += Math.round(80 * L * lgCoef * (1 + (r.qi || 0)) * gap * G.Player.realmQiCoef(L));
        po += Math.round(8 * L * (1 + (r.po || 0)) * gap);
        st += Math.round(6 * L * (1 + (r.st || 0)) * gap);
      });
      save.qi = (save.qi || 0) + qi;
      save.po = (save.po || 0) + po;
      var aw = G.Player.activeWorldId(G.game.meta);
      if (aw === 'dao') {
        var dcr = G.Data.dungeons.daoCrystalDrop(G.Data.dungeons.diffOf(G.game.meta, 'dao'));
        save.daoCrystal = (save.daoCrystal || 0) + dcr;
        this._log('战利：灵气 +' + qi + '　灵力 +' + po + '　道晶 +' + dcr);
      } else {
        save.stone += st;
        this._log('战利：灵气 +' + qi + '　灵力 +' + po + '　灵石 +' + st
          + (cut ? '（境界压制，收益减半）' : ''));
      }
      G.Storage.saveCurrent(save);
      this._finish(true, this.mapId);
    },

    _defeat: function () {
      var save = G.game.save;
      /* 问心魔劫：不降级、不死亡；突破丹已耗、灵气保留 80%，回镇可再购丹重试 */
      if (this.params.script === 'heartDemon') {
        var left = G.Player.loseBigBreak(save);
        /* 心魔劫失败不是死亡：重伤脱出，保留两成半气血 */
        this.p.hp = Math.max(1, Math.round(this.p.maxhp * 0.25));
        save.hp = this.p.hp;
        this.keepHp = true;
        this._log('心魔未破……你从梦魇中跌落。灵气散逸，余 ' + left + '。');
        this._log('突破丹已耗，可再购一枚，重头再来。');
        this._finish(false, 'town', true);
        return;
      }
      save.hp = 0;
      save._cause = 'war';                /* 死因：战死（轮回 v0.4 §3.1） */
      G.Storage.saveCurrent(save);
      this._log('你力竭倒下……');
      this._finish(false, null);
    },

    _leave: function () {
      var save = G.game.save;
      save.hp = Math.max(1, this.p.hp);
      G.Storage.saveCurrent(save);
      this._finish(true, this.mapId);
    },

    /* 副本战胜利：回副本场景（由其推进关卡 / 发 Boss 奖励） */
    _finishDungeon: function () {
      this.over = true;
      this.buttons = [];
      this.phase = 'result';
      var save = G.game.save;
      save.hp = Math.max(1, this.p.hp);
      this._cut([[0.9, function () {
        G.game.toast('战斗胜利');
        G.game.changeScene('dungeon', { fromBattle: true });
      }]]);
    },

    _finish: function (win, target, soft) {
      this.over = true;
      this.buttons = [];
      this.phase = 'result';
      var save = G.game.save;
      if (!this.keepHp) save.hp = Math.max(win ? 1 : 0, this.p.hp);

      this.resultT = 0;
      this.resultWin = win;
      this.resultTarget = target;
      /* 必须走 _cut：update() 消费的是 {t, fn} 对象，直接赋 [t, fn] 数组会让
         c.t 变 undefined → 演出永不结束 → 死亡时卡死在结算画面。 */
      this._cut([[0.9, function () {
        if (win) {
          G.game.toast('战斗胜利');
          G.game.changeScene(target || 'field', { returned: true });
        } else if (soft) {
          G.game.toast('心魔未破');
          G.game.changeScene(target || 'town', { returned: true });
        } else {
          G.game.die(save._cause || 'war');
        }
      }]]);
    },

    /* ===== 更新 ===== */
    update: function (dt) {
      this.t += dt;
      var k = Math.min(1, dt * 11);
      var self = this;
      this._keys().forEach(function (key) {
        self.lunge[key] = (self.lunge[key] || 0)
          + ((self.lungeT[key] || 0) - (self.lunge[key] || 0)) * k;
        self.flash[key] = Math.max(0, (self.flash[key] || 0) - dt * 3.2);
      });
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 22);

      /* 血条追赶 */
      var sp = dt * 140;
      this._keys().forEach(function (key) {
        var u = self._unit(key);
        if (!u) return;
        if (self.shown[key] == null) self.shown[key] = u.hp;
        var d = u.hp - self.shown[key];
        if (Math.abs(d) <= sp) self.shown[key] = u.hp;
        else self.shown[key] += Math.sign(d) * sp;
      });

      for (var i = this.floaters.length - 1; i >= 0; i--) {
        var f = this.floaters[i];
        f.t += dt;
        if (f.t > 1.05) this.floaters.splice(i, 1);
      }

      /* 演出队列 */
      if (this.cue.length) {
        var c = this.cue[0];
        c.t -= dt;
        if (c.t <= 0) {
          this.cue.shift();
          if (c.fn) c.fn();
          if (!this.cue.length && this.cueDone) {
            var d2 = this.cueDone; this.cueDone = null; d2();
          }
        }
        return;
      }
      if (this.cueDone) {
        var d3 = this.cueDone; this.cueDone = null; d3();
      }
    },

    /* ===== 渲染 ===== */
    render: function (x) {
      x.save();
      if (this.shake > 0.2) {
        x.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      }
      x.drawImage(this._bg(), 0, 0, 480, 272);
      x.restore();

      /* 后排先画，前排后画；主角最后（始终在最上层） */
      for (var i = this.es.length - 1; i >= 0; i--) this._drawUnit(x, 'E' + i);
      this._drawUnit(x, 'P');

      this._drawTopBar(x);
      this._drawFloaters(x);
      this._drawLog(x);

      /* 功法/物品/选目标浮层必须画在日志面板之后：
         日志面板占 172..204，浮层底部的"返回"按钮正好落在这一段，
         先画浮层会被日志盖住，按钮直接点不到也看不见。 */
      if (this.phase === 'skill' || this.phase === 'item' || this.phase === 'target') {
        x.fillStyle = 'rgba(4,6,12,0.52)';
        x.fillRect(0, 0, 480, 272);
        var title = this.phase === 'skill' ? '功法' : (this.phase === 'item' ? '物品' : '选择目标');
        G.UI.frame(x, { x: 12, y: 34, w: 456, h: 176 }, title, { paper: true });
        var hint = this.phase === 'target' ? '选择攻击对象（前排更近、后排更远）'
          : this.phase === 'skill'
            ? (this.p.statuses['封'] ? '封印中：本回合无法施展功法'
              : '消耗灵力施展，冷却完毕方可再用')
            : '选中即消耗一份，本回合交由敌方行动';
        G.UI.text(x, { x: 240, y: 196 }, hint, 10.5, G.UI.C.textDim, 'center');
      }

      if (this.phase === 'result') {
        x.fillStyle = 'rgba(4,6,12,0.55)';
        x.fillRect(0, 0, 480, 272);
        G.UI.textOut(x, { x: 240, y: 116 }, this.resultWin ? '战 斗 胜 利' : '力 竭 倒 下',
          30, this.resultWin ? '#f5e3a8' : '#c75450', 'center', 'rgba(0,0,0,0.8)', 4);
      }

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    },

    _bg: function () {
      if (this.bg) return this.bg;
      var o = G.Art.cv(480, 272);
      var x = o.x;

      /* 夜空 */
      var g = x.createLinearGradient(0, 0, 0, 200);
      g.addColorStop(0, '#0a0e1e');
      g.addColorStop(0.5, '#161d34');
      g.addColorStop(1, '#242b44');
      x.fillStyle = g; x.fillRect(0, 0, 480, 272);

      /* 月 */
      var mg = x.createRadialGradient(400, 46, 4, 400, 46, 40);
      mg.addColorStop(0, 'rgba(246,238,214,0.30)');
      mg.addColorStop(1, 'rgba(246,238,214,0)');
      x.fillStyle = mg;
      x.beginPath(); x.arc(400, 46, 40, 0, 6.2832); x.fill();
      x.fillStyle = '#f0e6c8';
      x.beginPath(); x.arc(400, 46, 15, 0, 6.2832); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.07)';
      x.beginPath(); x.arc(395, 41, 3.4, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(405, 51, 2.4, 0, 6.2832); x.fill();

      /* 远山两层 */
      function ridge(baseY, amp, col, phase) {
        var rr = G.Art.rnd(Math.round(baseY * 31 + phase * 977));
        x.fillStyle = col;
        x.beginPath();
        x.moveTo(0, 272);
        var pts = [];
        for (var px = 0; px <= 480; px += 24) {
          pts.push({
            x: px,
            y: baseY + Math.sin(px * 0.014 + phase) * amp + (rr() - 0.5) * amp * 1.2
          });
        }
        x.lineTo(pts[0].x, pts[0].y);
        for (var i = 0; i < pts.length - 1; i++) {
          var mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
          x.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        x.lineTo(480, 272); x.closePath(); x.fill();
      }
      ridge(150, 16, '#131a2c', 0.6);
      ridge(172, 20, '#0c1220', 2.4);

      /* 地面 */
      var gg = x.createLinearGradient(0, 178, 0, 272);
      gg.addColorStop(0, '#22283c');
      gg.addColorStop(1, '#0d1018');
      x.fillStyle = gg; x.fillRect(0, 178, 480, 94);
      x.fillStyle = 'rgba(216,183,104,0.16)';
      x.fillRect(0, 177.4, 480, 0.8);

      /* 台座：主角 1 个，敌方按槽位各 1 个 */
      x.drawImage(G.Art.arena(150, 44), 122 - 75, 148, 150, 44);
      var seen = {};
      this.es.forEach(function (e) {
        var p = e.pos || SOLO_SLOT;
        var kk = Math.round(p.x) + ':' + Math.round(p.y);
        if (seen[kk]) return;
        seen[kk] = 1;
        var w = e.boss ? 168 : 150;
        x.drawImage(G.Art.arena(w, 44), p.x - w / 2, p.y - 10, w, 44);
      });

      this.bg = o.c;
      return o.c;
    },

    _drawUnit: function (x, key) {
      var isP = key === 'P';
      var u = this._unit(key);
      if (!u) return;
      var pos = this._pos(key);
      var lunge = this.lunge[key] || 0;
      var cx = pos.x + lunge;
      var by = pos.y;
      var s = pos.s;

      var spr;
      if (isP) spr = G.Sprites.heroBattle();
      else if (u.species === '心魔' && G.Sprites.heartDemon) spr = G.Sprites.heartDemon();
      else spr = G.Sprites.beastResolve(u.artKey,
        u.sprite || SPECIES_SPRITE[u.species] || 'snake');
      if (!isP && u.boss) s = Math.max(s, 72);

      /* 已倒下：只留一个淡影，不再画立绘与名牌 */
      if (u.hp <= 0) {
        x.save();
        x.globalAlpha = 0.18;
        x.fillStyle = '#000';
        x.beginPath();
        x.ellipse(cx, by + 2, s * 0.30, s * 0.09, 0, 0, 6.2832);
        x.fill();
        x.restore();
        return;
      }

      x.save();
      /* 影子 */
      x.fillStyle = 'rgba(0,0,0,0.40)';
      x.beginPath();
      x.ellipse(cx, by + 2, s * 0.34, s * 0.10, 0, 0, 6.2832);
      x.fill();

      /* 单位 */
      x.drawImage(spr, Math.round(cx - s / 2), Math.round(by - s), s, s);

      /* 命中闪白 */
      var fl = this.flash[key] || 0;
      if (fl > 0.02) {
        x.globalAlpha = fl * 0.75;
        x.globalCompositeOperation = 'lighter';
        x.drawImage(spr, Math.round(cx - s / 2), Math.round(by - s), s, s);
        x.globalCompositeOperation = 'source-over';
        x.globalAlpha = 1;
      }

      /* 状态角标：放在脚下而不是头顶——头顶那一段被名牌血条面板压住，
         打上状态后玩家根本看不到。 */
      var sts = Object.keys(u.statuses || {});
      sts.forEach(function (t, i) {
        var col = { '毒': '#7ac05a', '烧': '#e0603c', '麻': '#e0c040', '睡': '#8f93a3', '封': '#9a7ae0' }[t] || '#aaa';
        x.fillStyle = 'rgba(8,10,18,0.75)';
        x.fillRect(cx - s / 2 + 1 + i * 9, by + 1, 10, 10);
        x.fillStyle = col;
        x.fillRect(cx - s / 2 + 2 + i * 9, by + 2, 8, 8);
        x.font = G.UI.F(8);
        x.fillStyle = '#12141f';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(t, cx - s / 2 + 6 + i * 9, by + 6);
      });

      /* 蓄力预告：贴在名牌面板下沿，避免与血条重叠 */
      var chg = this.chargeMark[key];
      if (chg) {
        var cw = 96, cx0 = Math.max(8, Math.min(480 - cw - 8, cx - cw / 2));
        var pulse = 0.55 + 0.45 * Math.sin(this.t * 7);
        x.fillStyle = 'rgba(60,12,16,0.86)';
        x.fillRect(cx0, by - s - 4, cw, 15);
        x.strokeStyle = 'rgba(255,140,110,' + pulse.toFixed(2) + ')';
        x.lineWidth = 1;
        x.strokeRect(cx0 + 0.5, by - s - 3.5, cw - 1, 14);
        x.font = G.UI.F(9.5);
        x.fillStyle = '#ffcfa8';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('蓄力 · ' + chg, cx0 + cw / 2, by - s + 3.5);
      }
      x.restore();

      /* 名牌 + 血条：多敌时收窄，避免互相压住；Boss 留宽一点放得下全名 */
      var bw = this.es.length > 1 && !isP ? (u.boss ? 96 : 84) : 100;
      var bx = Math.max(8, Math.min(480 - bw - 8, cx - bw / 2));
      var byy = by - s - 26;

      G.UI.panel(x, { x: bx, y: byy, w: bw, h: 24 }, 'rgba(12,15,24,0.86)',
        isP ? 'rgba(216,183,104,0.55)' : 'rgba(199,84,80,0.6)', 3, { shadow: false });
      x.font = G.UI.F(10);
      x.textAlign = 'left'; x.textBaseline = 'top';
      var hpTxt = Math.max(0, Math.round(this.shown[key] == null ? u.hp : this.shown[key]))
        + '/' + u.maxhp;
      var hpW = x.measureText(hpTxt).width;
      /* 名字按可用宽度截断：多敌时名牌窄，长名字会直接压到气血数字上 */
      var nm = String(u.name), avail = bw - 10 - hpW - 5;
      while (nm.length > 1 && x.measureText(nm).width > avail) nm = nm.slice(0, -1);
      x.fillStyle = isP ? '#f5e3a8' : '#e8b0aa';
      x.fillText(nm, bx + 5, byy + 3);
      x.textAlign = 'right';
      x.fillStyle = 'rgba(220,226,240,0.8)';
      x.fillText(hpTxt, bx + bw - 5, byy + 3);
      G.UI.bar(x, { x: bx + 4, y: byy + 15, w: bw - 8, h: 6 },
        u.maxhp ? (this.shown[key] == null ? u.hp : this.shown[key]) / u.maxhp : 0,
        isP ? G.UI.C.hp : '#d24b4b');
      /* 护盾条：叠在血条上沿的青色段 */
      if (u.shield > 0) {
        var sw2 = (bw - 8) * Math.min(1, u.shield / u.maxhp);
        x.fillStyle = 'rgba(120,190,255,0.9)';
        x.fillRect(bx + 4, byy + 13, sw2, 2);
      }

      /* 血条残余（白影） */
      var cur = u.maxhp ? Math.max(0, u.hp) / u.maxhp : 0;
      var sh = u.maxhp ? Math.max(0, (this.shown[key] == null ? u.hp : this.shown[key])) / u.maxhp : 0;
      if (sh > cur + 0.005) {
        x.fillStyle = 'rgba(255,255,255,0.55)';
        var w0 = (bw - 8) * cur, w1 = (bw - 8) * sh;
        x.fillRect(bx + 4 + w0, byy + 16, w1 - w0, 4);
      }
    },

    _drawTopBar: function (x) {
      var g = x.createLinearGradient(0, 0, 0, 26);
      g.addColorStop(0, 'rgba(6,8,14,0.86)');
      g.addColorStop(1, 'rgba(6,8,14,0)');
      x.fillStyle = g; x.fillRect(0, 0, 480, 26);

      G.UI.textOut(x, { x: 12, y: 6 }, '第 ' + this.round + ' 回合', 13, '#eae6da');
      var p = this.params;
      var label = p.script === 'heartDemon' ? '问心魔劫'
        : this.es[0].boss ? '首领战' : (p.script ? '剧情战' : '遭遇战');
      G.UI.textOut(x, { x: 240, y: 6 }, label, 12, '#8f95a6', 'center');

      var alive = this._aliveEs();
      var sum = 0, fastest = 0;
      for (var i = 0; i < alive.length; i++) {
        var v = this._effSpd(alive[i]);
        sum += v;
        if (v > fastest) fastest = v;
      }
      var avg = alive.length ? sum / alive.length : 0;
      var my = this._effSpd(this.p);
      var txt = '速度 ' + Math.round(my) + ' : ' + Math.round(avg)
        + (alive.length > 1 ? '(均×' + alive.length + ')' : '')
        + '　' + (my >= fastest ? '先手' : '后手');
      G.UI.textOut(x, { x: 468, y: 6 }, this.auto ? '自动战斗中' : txt, 12,
        this.auto ? '#f5e3a8' : (my >= fastest ? '#a8dcc4' : '#e0a080'), 'right');
    },

    _drawFloaters: function (x) {
      for (var i = 0; i < this.floaters.length; i++) {
        var f = this.floaters[i];
        var p = f.t / 1.05;
        var alpha = p < 0.75 ? 1 : (1 - (p - 0.75) / 0.25);
        var y = f.y - p * (f.rise || 24);
        var sc = f.big ? 1 + Math.max(0, 0.5 - p * 1.6) : 1;
        x.save();
        x.globalAlpha = Math.max(0, alpha);
        x.font = G.UI.F(Math.round((f.big ? 20 : 15) * sc));
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineJoin = 'round';
        x.lineWidth = 3;
        x.strokeStyle = 'rgba(8,8,14,0.85)';
        x.strokeText(f.txt, f.x, y);
        x.fillStyle = f.col;
        x.fillText(f.txt, f.x, y);
        x.restore();
      }
    },

    _drawLog: function (x) {
      G.UI.panel(x, { x: 10, y: 172, w: 460, h: 32 }, 'rgba(10,13,22,0.88)',
        'rgba(216,183,104,0.35)', 4, { paper: true, shadow: false });
      var lines = this.logs.slice(-2);
      for (var i = 0; i < lines.length; i++) {
        var last = i === lines.length - 1;
        G.UI.text(x, { x: 20, y: 178 + i * 14 }, lines[i], 12,
          last ? '#eae6da' : '#8f95a6');
      }
    },

    onKey: function (code) {
      if (code !== 'Space') return;
      if (this.phase !== 'command' && this.phase !== 'target') return;
      var b = this.buttons[0];
      if (b && !b.disabled) { b._p = .14; b.onClick(); }
    }
  };

  G.scenes.battle = scene;
})();
