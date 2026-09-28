/* 存档：meta 永久档 + 当世档；版本迁移；.bak 兜底 */
(function () {
  var VERSION = 10;
  var K_META = 'nichen_meta';
  var K_SAVE = 'nichen_save';

  function defaultProgress() {
    return {
      difficulty: 'normal',
      /* 世界解锁：新档只开凡界；飞升后解锁灵界、仙界；道界需**三枚道之钥匙碎片**（隐藏） */
      worlds: { fan: true, ling: false, xian: false, dao: false },
      daoKey: false,
      activeWorld: 'fan',
      /* 每界独立难度（设计 v1.1 §2.5）；未设的界回落到 difficulty */
      worldDiff: { fan: 'normal', ling: 'normal', xian: 'normal', dao: 'normal' },
      /* 三枚道之钥匙碎片（凡/灵/仙 各自的地狱难度通关各给一枚）；三枚齐 → daoKey = true */
      daoShards: { fan: false, ling: false, xian: false }
    };
  }

  var Storage = {
    defaultProgress: defaultProgress,
    SLOT_COUNT: 3,
    activeSlot: function () {
      var n = Number(localStorage.getItem('nichen_active_slot'));
      return n >= 1 && n <= 3 && n === Math.floor(n) ? n : 1;
    },
    _slotKey: function (key, slot) {
      slot = slot == null ? this.activeSlot() : slot;
      if (slot < 1 || slot > 3 || slot !== Math.floor(slot)) throw new Error('存档槽必须为 1–3');
      /* 槽一沿用旧键，旧档及备份不复制、不删除。 */
      return slot === 1 ? key : key + '_slot' + slot;
    },
    selectSlot: function (slot) {
      this._slotKey(K_SAVE, slot);
      localStorage.setItem('nichen_active_slot', String(slot));
    },
    listSlots: function () {
      var out = [];
      for (var i = 1; i <= this.SLOT_COUNT; i++) {
        var s = this._read(this._slotKey(K_SAVE, i));
        var m = this._read(this._slotKey(K_META, i));
        out.push({ slot: i, occupied: !!(s || m), current: !!s,
          life: s ? (s.life || 1) : (((m && m.past) || []).length + 1),
          realm: s ? G.Player.realmInfo(s.globalLevel || 1).n : '',
          age: s && s.age, savedAt: (s && s.lastSeen) || 0 });
      }
      return out;
    },

    /* 通用读写（带 .bak） */
    _write: function (key, obj) {
      try {
        var prev = localStorage.getItem(key);
        if (prev) localStorage.setItem(key + '_bak', prev);
      } catch (e) {}
      localStorage.setItem(key, JSON.stringify(obj));
    },
    _read: function (key) {
      var raw = localStorage.getItem(key);
      if (raw) {
        try { return JSON.parse(raw); }
        catch (e) { /* 落 bak */ }
      }
      var bak = localStorage.getItem(key + '_bak');
      if (bak) {
        try { return JSON.parse(bak); }
        catch (e) {}
      }
      return null;
    },

    saveMeta: function (meta) { meta.version = VERSION; this._write(this._slotKey(K_META), meta); },
    loadMeta: function () {
      var m = this._read(this._slotKey(K_META));
      if (m) m = this._migrate(m);
      return m;
    },
    saveCurrent: function (save) {
      save.version = VERSION;
      /* 离开时间戳（v0.61.0）：离线打坐收益的基准。写在这里 = 只有"一个真相源"，
         不必让每个调用点自己记得刷新（漏一处就会出现"离线 300 天"的假收益）。 */
      save.lastSeen = Date.now();
      this._write(this._slotKey(K_SAVE), save);
    },
    loadCurrent: function () {
      var s = this._read(this._slotKey(K_SAVE));
      if (s) s = this._migrate(s);
      return s;
    },
    clearCurrent: function () {
      try {
        var key = this._slotKey(K_SAVE);
        localStorage.removeItem(key);
        localStorage.removeItem(key + '_bak');
      } catch (e) {}
    },

    _isMeta: function (d) {
      return d && (d.past || d.perfusion || d.xianli != null);
    },

    _migrate: function (data) {
      data.version = data.version || 1;

      /* v1 → v2：四界进度 / 道钥（meta），副本运行态 / 道晶（save） */
      if (data.version < 2) {
        if (this._isMeta(data)) {
          data.progress = data.progress || defaultProgress();
          var pr = data.progress;
          pr.difficulty = pr.difficulty || 'normal';
          pr.worlds = pr.worlds || { fan: true, ling: false, xian: false, dao: false };
          ['fan', 'ling', 'xian', 'dao'].forEach(function (w) {
            if (pr.worlds[w] == null) pr.worlds[w] = (w === 'fan');
          });
          pr.daoKey = !!pr.daoKey;
          pr.activeWorld = pr.activeWorld || 'fan';
        } else {
          data.dungeonSet = data.dungeonSet || null;   /* 本世 5 副本 id 序列 */
          data.dungeonSlot = data.dungeonSlot || 0;     /* 当前槽位 0–4 */
          data.dungeonRun = data.dungeonRun || null;    /* {arch,stage,midBeaten,bigBeaten} */
          data.dungeonFarm = data.dungeonFarm || 0;     /* 刷本次数（影响产出衰减） */
          data.secrets = data.secrets || {};            /* 秘境奇遇/秘术拾取记录 */
          data.daoCrystal = data.daoCrystal || 0;       /* 道晶（道界货币） */
        }
        data.version = 2;
      }

      /* v2 → v3：四界区域层（《四界区域与副本落位设计 v1.0》§7.2）
         save 侧补 mainWorld（本世主界）/ entrances（5 个副本入口落位）/
         visited（已到访区域）/ indoor（已进过的建筑）。缺字段一律补默认，不白屏。 */
      if (data.version < 3) {
        if (!this._isMeta(data)) {
          data.entrances = data.entrances || {};
          data.visited = data.visited || {};
          data.indoor = data.indoor || {};
        }
        data.version = 3;
      }

      /* v3 → v4：地狱难度体系（《四界区域与副本落位设计 v1.1》§2.5）
         meta 侧加 hellCleared（跨世永久）/ titles / progress.worldDiff（每界独立难度）/
         progress.daoShards（三枚道之钥匙碎片）。
         旧档若 daoKey 已为 true（旧规则 = 地狱通关仙界掉整把钥匙），把三枚碎片一并标为已得，
         避免老玩家"道界被收回"。 */
      if (data.version < 4) {
        if (this._isMeta(data)) {
          data.hellCleared = data.hellCleared || {};
          data.titles = data.titles || [];
          var pr4 = data.progress = data.progress || defaultProgress();
          pr4.worldDiff = pr4.worldDiff || {};
          ['fan', 'ling', 'xian', 'dao'].forEach(function (w) {
            if (!pr4.worldDiff[w]) pr4.worldDiff[w] = pr4.difficulty || 'normal';
          });
          pr4.daoShards = pr4.daoShards || { fan: false, ling: false, xian: false };
          if (pr4.daoKey) pr4.daoShards = { fan: true, ling: true, xian: true };
        } else {
          /* save 侧：入口落位由「数组」改为「按界分桶的对象」；
             `mainWorld` 删除 —— 当前界只有一个真相源 = meta.progress.activeWorld。 */
          if (Array.isArray(data.entrances)) {
            var old = data.entrances;
            data.entrances = { fan: [], ling: [], xian: [], dao: [] };
            if (data.mainWorld) data.entrances[data.mainWorld] = old;
          } else if (!data.entrances) {
            data.entrances = { fan: [], ling: [], xian: [], dao: [] };
          }
          delete data.mainWorld;
        }
        data.version = 4;
      }

      /* v4 → v5：道界道则回廊（缺口 U4）
         save 侧补 daoCleared（九关通关记录，**本世内有效** —— 每世重爬）；
         daoCrystal 老档已在 v2 补过，这里只兜一次底。 */
      if (data.version < 5) {
        if (!this._isMeta(data)) {
          data.daoCrystal = data.daoCrystal || 0;
          data.daoCleared = data.daoCleared || [];
        }
        data.version = 5;
      }

      /* v5 → v6：宗门与散修体系（《宗门与散修体系设计 v1.0》§7.2）
         save 侧加 cult（阵营）/ sectId / sectRep（贡献或散修声望）/ sectRank /
         cultSwitchUsed（每世一次转阵营）/ quest.line（主线分叉），
         并给已有功法补 voided=false（旧档功法一律视为未废功）。 */
      if (data.version < 6) {
        if (!this._isMeta(data)) {
          data.cult = data.cult || 'free';
          data.sectId = data.sectId || null;
          data.sectRep = data.sectRep || 0;
          data.sectRank = data.sectRank || 'outer';
          data.cultSwitchUsed = !!data.cultSwitchUsed;
          if (data.quest) data.quest.line = data.quest.line || 'free';
          data.askedRealms = data.askedRealms || {};   /* 问道：本世每个境问过一次 */
          data.side = data.side || {};                 /* 支线任务进度 */
          data.equip = data.equip || { weapon: null, armor: null, accessory: null };
          Object.keys(data.skills || {}).forEach(function (k) {
            if (data.skills[k] && data.skills[k].voided == null) data.skills[k].voided = false;
          });
        }
        data.version = 6;
      }

      /* v6 → v7：灵兽系统（《灵兽系统 v1.1》§12）
         save 侧加 beasts（个体）/ beastTeam（出战位）/ riding（当前骑乘）/ rideSkill（骑术）；
         meta 侧加 bestiary（跨世图鉴）/ companionBeast（伴生仙兽槽，后期预留）。缺字段补默认，不白屏。 */
      if (data.version < 7) {
        if (this._isMeta(data)) {
          data.bestiary = data.bestiary || {};
          if (data.companionBeast == null) data.companionBeast = null;
        } else {
          data.beasts = data.beasts || [];
          data.beastTeam = data.beastTeam || [];
          if (data.riding == null) data.riding = null;
          data.rideSkill = data.rideSkill || { land: false, air: false };
        }
        data.version = 7;
      }

      /* v7 → v8：剧情轮回记忆（《剧情打磨 v1.0》§5.3）
         meta 侧加 memory（碎片/忆起）/ bonds（故人）/ progress.story（主线/结局旗标）。 */
      if (data.version < 8) {
        if (this._isMeta(data) && G.Story) G.Story.ensure(data);
        data.version = 8;
      }
      /* v8 → v9：世界时钟（v0.61.0，用户第 3 点）
         save 侧加 gt（本世累计**游戏分钟**）/ ageBonus（突破等行为的一次性加龄）/
         lastSeen（现实时间戳，离线打坐收益用）。
         老档的 `age` 折成 gt（一岁 = 一游戏年），行为加龄归零 —— 见 `G.Time.ensure`。 */
      if (data.version < 9) {
        if (!this._isMeta(data)) {
          if (data.gt == null) {
            var a0 = (data.age == null ? 16 : data.age);
            data.gt = Math.max(0, a0 - 16) * 365 * 1440;
          }
          if (data.ageBonus == null) data.ageBonus = 0;
          if (data.lastSeen == null) data.lastSeen = 0;
          /* 资源分级（用户第 11 点）：灵晶 / 仙晶 是新币种，老档一律 0 起。
             ⚠️ 加存档字段前已 grep 过同名（G50）：`lingjing` 只在这里出现，
                `xianjing` 与 HUD 的「仙力/仙晶」是两回事（那是 `xianliLive` 的读数，
                不是持有量）—— 刻意不复用，免得"仙力"被当成钱花掉。 */
          if (data.lingjing == null) data.lingjing = 0;
          if (data.xianjing == null) data.xianjing = 0;
          delete data._ageTick;
        }
        data.version = 9;
      }
      if (data.version < 10) {
        if (!this._isMeta(data) && data.homeOwned == null) {
          /* 老档保留已经使用过的居所，新降世明确从 false 开始。 */
          data.homeOwned = true;
        }
        data.version = 10;
      }
      return data;
    },

    hasMeta: function () { return !!this._read(this._slotKey(K_META)); },
    hasCurrent: function () { return !!this._read(this._slotKey(K_SAVE)); },

    /* ===== 设备 / 浏览器标识（v0.8.0）=====
       用途：同一台机器上可能有多个存档（不同浏览器 / 清过缓存 / 换机），
       轮回殿要能看出"这一世的记录是哪台设备写的"，好区分与排查。
       隐私：**纯本地**。deviceId 是本机首次运行时生成的随机串，存在 localStorage；
       browserId 是"浏览器指纹摘要"（UA/语言/屏幕/时区/核数 → FNV-1a 取前 8 位），
       只用于比对是否同一浏览器，不含任何可识别个人的信息，也不外发。 */
    DEVICE_KEY: 'nichen_device',

    deviceId: function () {
      try {
        var v = localStorage.getItem(this.DEVICE_KEY);
        if (!v) {
          v = 'dev-' + Math.random().toString(36).slice(2, 8)
            + Date.now().toString(36).slice(-4);
          localStorage.setItem(this.DEVICE_KEY, v);
        }
        return v;
      } catch (e) { return 'dev-unknown'; }
    },

    browserId: function () {
      var nav = (typeof navigator !== 'undefined' && navigator) || {};
      var scr = (typeof screen !== 'undefined' && screen) || {};
      var raw = [
        nav.userAgent || '', nav.language || '', nav.platform || '',
        (scr.width || 0) + 'x' + (scr.height || 0), scr.colorDepth || 0,
        (new Date()).getTimezoneOffset(), nav.hardwareConcurrency || 0
      ].join('|');
      var h = (G.RNG && G.RNG.hash) ? G.RNG.hash(raw) : 0;
      return 'br-' + ('00000000' + h.toString(16)).slice(-8);
    },

    /* 把标识写进 meta：只在首次或浏览器换了的时候动，
       免得每次开游戏都写盘（meta 是跨世档，写得越少越安全）。 */
    stampDevice: function (meta) {
      if (!meta) return null;
      var id = this.deviceId(), br = this.browserId();
      if (!meta.device) {
        meta.device = { id: id, browser: br, first: Date.now(), last: Date.now() };
      } else if (meta.device.browser !== br) {
        /* 同一台机器换了浏览器 → 记下上一个，方便对照旧记录 */
        meta.device.prev = meta.device.prev || [];
        if (meta.device.prev.indexOf(meta.device.browser) < 0) {
          meta.device.prev.push(meta.device.browser);
          if (meta.device.prev.length > 8) meta.device.prev.shift();
        }
        meta.device.browser = br;
        meta.device.last = Date.now();
      }
      return meta.device;
    }
  };

  G.Storage = Storage;
})();
