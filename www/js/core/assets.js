/* 素材层：清单驱动 + 缺省回退
   ─ 所有绘制点统一走 G.Assets.img(逻辑名)：
     命中 → 用你的图；未命中 → 程序化绘制兜底（不会裂图）。
   ─ 换皮只需替换 www/assets/img/ 下的文件并同步 manifest.json。 */
(function () {
  var Assets = {
    images: {},
    manifest: {},
    ready: false,
    _tried: {},

    makeCanvas: function (w, h) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    },

    register: function (name, img) { this.images[name] = img; },

    /* 取素材：无则返回 null（由调用方回退程序化绘制） */
    img: function (name) {
      var im = this.images[name];
      if (im && (im.naturalWidth || im.width)) return im;
      return null;
    },

    has: function (name) { return !!this.img(name); },

    /* 占位块（仅调试用） */
    placeholder: function (w, h, label, bg) {
      var c = this.makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = bg || '#23283d';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#4a5578';
      x.lineWidth = 1;
      x.strokeRect(0.5, 0.5, w - 1, h - 1);
      if (label) {
        x.fillStyle = '#a9b4d8';
        x.font = Math.floor(h * 0.5) + 'px KaiTi, serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(label, w / 2, h / 2 + 1);
      }
      return c;
    },

    /* 预加载：优先用 manifest.js（<script> 引入，已挂在 G.AssetManifest 上），
       取不到再退回 fetch('assets/manifest.json')。
       为什么优先 JS：manifest.json 只能靠 fetch 取，而 fetch 在 file:// 打开、
       以及部分沙箱预览里会被拦掉 —— 一被拦就静默退回全程序化画面，
       玩家只会看到"人物不对"，完全不知道是素材没加载。script 标签没这个问题。 */
    load: function (cb) {
      var self = this;
      var done = function () { self.ready = true; if (cb) cb(); };

      var start = function (mf) {
        if (!mf) { self.diag = 'no-manifest'; done(); return; }
        self.manifest = mf;
        var keys = Object.keys(mf).filter(function (k) { return typeof mf[k] === 'string'; });
        if (!keys.length) { self.diag = 'empty-manifest'; done(); return; }
        var pending = keys.length;
        var settle = function () { pending--; if (pending <= 0) finish(); };
        var failed = [];
        var finish = function () {
          self.diag = failed.length ? ('failed:' + failed.length + '/' + keys.length) : 'ok';
          if (failed.length) {
            console.warn('[assets] ' + failed.length + '/' + keys.length
              + ' 张素材加载失败，这些键会退回程序化画面：' + failed.slice(0, 5).join(', '));
          }
          done();
        };
        keys.forEach(function (key) {
          var img = new Image();
          img.onload = function () {
            if (img.naturalWidth || img.width) self.images[key] = img;
            else failed.push(key);
            settle();
          };
          img.onerror = function () { failed.push(key); settle(); };
          img.src = mf[key];
        });
        /* 兜底：3 秒未完成也放行，避免个别图卡住整局 */
        setTimeout(function () { if (!self.ready) { self.diag = 'timeout'; finish(); } }, 3000);
      };

      if (this.manifestFromScript()) { start(this.manifestFromScript()); return; }
      if (typeof fetch !== 'function') { self.diag = 'no-fetch'; done(); return; }
      fetch('assets/manifest.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(start)
        .catch(function (e) {
          /* 这里最容易踩：file:// 下 fetch 会被拦，异常吞掉就变成"素材静默失效" */
          console.warn('[assets] 取 manifest.json 失败（' + (e && e.message)
            + '），改用程序化画面。若在 file:// 下打开，请改用 http 服务。');
          self.diag = 'fetch-failed';
          done();
        });
    },

    /* manifest.js 由 tools/assets-build.py 生成，用 <script> 引入后挂在这里 */
    manifestFromScript: function () {
      var mf = G.AssetManifest;
      return (mf && typeof mf === 'object' && Object.keys(mf).length) ? mf : null;
    }
  };

  G.Assets = Assets;
})();
