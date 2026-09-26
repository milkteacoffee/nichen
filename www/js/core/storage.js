/* 存档：meta 永久档 + 当世档；版本迁移；.bak 兜底 */
(function () {
  var VERSION = 5;
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

    saveMeta: function (meta) { meta.version = VERSION; this._write(K_META, meta); },
    loadMeta: function () {
      var m = this._read(K_META);
      if (m) m = this._migrate(m);
      return m;
    },
    saveCurrent: function (save) { save.version = VERSION; this._write(K_SAVE, save); },
    loadCurrent: function () {
      var s = this._read(K_SAVE);
      if (s) s = this._migrate(s);
      return s;
    },
    clearCurrent: function () {
      try {
        localStorage.removeItem(K_SAVE);
        localStorage.removeItem(K_SAVE + '_bak');
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
      return data;
    },

    hasMeta: function () { return !!localStorage.getItem(K_META); },
    hasCurrent: function () { return !!localStorage.getItem(K_SAVE); },

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
