/* 诸世情感主线 · Arc 引擎（《诸世情感与镜花水月主线设计 v1.0》§9）
   ------------------------------------------------------------
   六个固定情感世（arc1 白鹿礁 → arc6 道界）的状态机与数据层：
     · 内容由 data/arc1.js .. arc6.js 用 G.Arcs.register(def) 登记；
     · 牵挂数据复用并扩充 meta.bonds（共同记忆 memories / 命数 fate）；
     · 执念册 meta.regrets（每世一件憾）；
     · 天道命定 vs 浮世轮回的门控：next(meta)。
   铁律：引擎只做状态与数据，台词全部在内容文件；不碰战斗数值。
   ============================================================ */
(function () {
  var DEFS = [];
  var INDEX = {};

  function hasItem(save, id) { return !!save.items && (save.items[id] || 0) > 0; }
  function takeItem(save, id) {
    if (!save.items) return false;
    if ((save.items[id] || 0) <= 0) return false;
    save.items[id] -= 1;
    if (save.items[id] <= 0) delete save.items[id];
    return true;
  }

  var Arcs = {
    /* ===== 内容登记 ===== */
    register: function (def) {
      if (!def || !def.id) throw new Error('arc def 缺 id');
      if (INDEX[def.id]) throw new Error('arc 重复登记：' + def.id);
      def.order = DEFS.length;
      DEFS.push(def);
      INDEX[def.id] = def;
      return def;
    },
    byId: function (id) { return INDEX[id] || null; },
    list: function () { return DEFS.slice(); },

    /* ===== Meta 结构 ===== */
    ensure: function (meta) {
      if (!meta) return meta;
      if (G.Story && G.Story.ensure) G.Story.ensure(meta);
      var st = meta.progress = meta.progress || {};
      st.story = st.story || {};
      var ss = st.story;
      ss.arcs = ss.arcs || { done: [], current: null };
      ss.tokens = ss.tokens || {};
      if (!meta.regrets) meta.regrets = [];
      /* 扩充旧 bonds 字段（不覆盖已有） */
      Object.keys(meta.bonds || {}).forEach(function (pid) {
        Arcs._shapeBond(meta.bonds[pid]);
      });
      return meta;
    },
    _shapeBond: function (b) {
      b.memories = b.memories || [];
      b.fate = b.fate || { peril: 0, doomed: false, deathLife: null, deathText: null };
      return b;
    },

    /* 取/建牵挂档（cast: {pid,name,rel,kind,note,status}） */
    bond: function (meta, c, life) {
      this.ensure(meta);
      var b = meta.bonds[c.pid];
      if (!b) {
        b = {
          pid: c.pid, name: c.name, rel: c.rel, kind: c.kind,
          firstLife: life, status: c.status || '安', note: c.note || '',
          meetings: [], memories: [],
          fate: { peril: 0, doomed: false, deathLife: null, deathText: null }
        };
        meta.bonds[c.pid] = b;
      } else {
        if (c.kind && !b.kind) b.kind = c.kind;
      }
      return b;
    },

    /* 共同记忆（具体小事） */
    addMemory: function (meta, pid, text, life) {
      var b = meta.bonds[pid];
      if (!b) return null;
      var m = { life: life || (meta.lives || 0) + 1, text: text };
      b.memories.push(m);
      if (b.memories.length > 60) b.memories.shift();
      return m;
    },

    /* 重逢（跨世认出/忆起，沿用 meetings） */
    addMeeting: function (meta, pid, life, gl, outcome) {
      var b = meta.bonds[pid];
      if (!b) return;
      b.meetings.push({ life: life, gl: gl, outcome: outcome || '重逢' });
    },

    /* 命数：劫权重 +1 / 注定 */
    addPeril: function (meta, pid, d) {
      var b = meta.bonds[pid];
      if (!b || !b.fate) return;
      b.fate.peril = Math.max(0, Math.min(100, b.fate.peril + (d || 5)));
    },
    doom: function (meta, pid, life, text, status) {
      var b = meta.bonds[pid];
      if (!b) return;
      b.fate.doomed = true;
      b.fate.deathLife = life;
      b.fate.deathText = text;
      if (status) b.status = status;
    },

    /* ===== 门控：下一个命定之世 ===== */
    doneIds: function (meta) {
      this.ensure(meta);
      return meta.progress.story.arcs.done;
    },
    next: function (meta) {
      this.ensure(meta);
      var done = meta.progress.story.arcs.done;
      for (var i = 0; i < DEFS.length; i++) {
        if (done.indexOf(DEFS[i].id) < 0) return DEFS[i];
      }
      return null;
    },
    isDone: function (meta, id) {
      return this.doneIds(meta).indexOf(id) >= 0;
    },
    /* 通关后（两结局已达成） */
    finished: function (meta) {
      this.ensure(meta);
      return !!meta.progress.story.ending;
    },

    /* ===== 开局：进入命定之世 ===== */
    begin: function (save, meta, def) {
      this.ensure(meta);
      var life = save.life || ((meta.past || []).length + 1);
      (def.cast || []).forEach(function (c) { Arcs.bond(meta, c, life); });
      save.arc = {
        id: def.id,
        phase: 'intro', step: 0,
        day: 1, mem: {}, spotBeat: {},
        node: 0, result: null,
        loss: 0,
        flags: {}
      };
      meta.progress.story.arcs.current = def.id;
      return save.arc;
    },

    /* 日常：一次相处 beat */
    dailyBeat: function (save, meta, spot) {
      var arc = save.arc, def = INDEX[arc.id];
      var pid = spot.pid;
      arc.mem[pid] = (arc.mem[pid] || 0) + 1;
      var idx = arc.spotBeat[spot.id] || 0;
      var beat;
      if (idx < (spot.beats || []).length) beat = spot.beats[idx];
      else {
        var pool = spot.pool || ['寻常一日，灯下闲话。', '一处就是半日，不觉天色向晚。'];
        beat = { t: pool[(idx - (spot.beats || []).length) % pool.length] };
      }
      arc.spotBeat[spot.id] = idx + 1;
      if (beat.mem !== false) this.addMemory(meta, pid, beat.t, save.life);
      if (beat.fx) { try { beat.fx(save, meta); } catch (e) {} }
      return beat;
    },
    needMet: function (save, def) {
      var arc = save.arc, need = (def.daily && def.daily.need) || {};
      return Object.keys(need).every(function (pid) {
        return (arc.mem[pid] || 0) >= need[pid];
      });
    },
    memTotal: function (save) {
      return Object.keys(save.arc.mem).reduce(function (s2, pid) {
        return s2 + save.arc.mem[pid];
      }, 0);
    },

    /* ===== 抉择节点：选项是否可用 / 执行 ===== */
    optionOk: function (save, option) {
      if (option.item && !hasItem(save, option.item)) return false;
      if (option.glm && (save.globalLevel || 1) < option.glm) return false;
      if (option.if && !option.if(save)) return false;
      return true;
    },
    runOption: function (save, meta, option) {
      if (option.consume && option.item) takeItem(save, option.item);
      if (option.fx) { try { option.fx(save, meta); } catch (e) {} }
      return option.then || option.t;
    },
    hasItem: hasItem,

    /* ===== 命定之世收场 ===== */
    complete: function (save, meta) {
      var def = INDEX[save.arc.id], life = save.life;
      var done = meta.progress.story.arcs.done;
      if (done.indexOf(def.id) < 0) done.push(def.id);
      meta.progress.story.arcs.current = null;
      /* 牵挂注定：命数落定 */
      (def.fated || []).forEach(function (f) {
        Arcs.doom(meta, f.pid, life, f.text, f.status);
      });
      /* 跨世信物 */
      if (def.tokens) {
        var tk = meta.progress.story.tokens;
        Object.keys(def.tokens).forEach(function (k) {
          tk[k] = (tk[k] || 0) + def.tokens[k];
        });
      }
      /* 执念册：一件憾 */
      if (def.regret) {
        meta.regrets.push({
          life: life,
          pid: def.regret.pid,
          name: def.regret.name,
          item: def.regret.item,
          words: def.regret.words
        });
        if (meta.regrets.length > 99) meta.regrets.shift();
      }
      return def;
    }
  };

  G.Arcs = Arcs;
})();
