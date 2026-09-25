/* 存档：meta 永久档 + 当世档；版本迁移；.bak 兜底 */
(function () {
  var VERSION = 1;
  var K_META = 'nichen_meta';
  var K_SAVE = 'nichen_save';

  var Storage = {
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
        try { return JSON.parse(bak); } catch (e) {}
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

    _migrate: function (data) {
      /* 后续版本：while (data.version < VERSION) { ... } */
      data.version = data.version || VERSION;
      return data;
    },

    hasMeta: function () { return !!localStorage.getItem(K_META); },
    hasCurrent: function () { return !!localStorage.getItem(K_SAVE); }
  };

  G.Storage = Storage;
})();
