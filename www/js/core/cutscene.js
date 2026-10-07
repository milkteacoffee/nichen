/* ============================================================
 * Cutscene 影像导演系统（v0.85.0）
 * 全屏剧情过场，两种镜头：
 *   · video：真实浏览器播放 AI 生成视频（DOM 全屏 + 字幕 + 跳过）
 *   · still：高清静帧 Ken Burns（缓慢推镜/平移 + 交叉淡化 + 黑边 + 字幕），
 *            无头截图与缺视频环境的统一兜底，浏览器内同样具电影感。
 * 由 game.js 主循环驱动（输入拦截 / update / render）。
 * ============================================================ */
(function () {
  var W = 480, H = 272;
  var BAR = 30;                 // 上下黑边高度（静帧）
  var FADE = 0.7;               // 交叉淡化时长
  var CAP_BOTTOM = 46;          // 字幕距底
  var dom = null, videoEl = null, capEl = null, skipEl = null;

  var C = {
    open: false,
    shots: [], idx: 0, t: 0,
    doneCb: null,
    mode: 'still',             // 'still' | 'video'
    ask: false,                // 是否处于“跳过确认”
    _hold: 0,                  // 确认框计时

    /* ===== 公共 ===== */
    isOpen: function () { return this.open; },

    play: function (shots, onDone) {
      if (!shots || !shots.length) { if (onDone) onDone(); return; }
      this.shots = this._norm(shots);
      this.idx = 0; this.t = 0; this.ask = false; this._hold = 0;
      this.doneCb = onDone || null;
      this.open = true;
      this._enter(0);
    },

    finish: function () {
      this.open = false; this.ask = false;
      this._stopVideo();
      var cb = this.doneCb; this.doneCb = null;
      if (cb) cb();
    },

    /* ===== 归一化 ===== */
    _norm: function (shots) {
      return shots.map(function (s) {
        var o = {
          video: s.video || null,
          imgs: (s.imgs || s.img) ? [].concat(s.imgs || s.img) : [],
          dur: s.dur || 4.2,
          zoom0: s.zoom0 != null ? s.zoom0 : 1.05,
          zoom1: s.zoom1 != null ? s.zoom1 : 1.16,
          pan: s.pan != null ? s.pan : 10,
          caps: []
        };
        if (s.captions) o.caps = s.captions.slice();
        else if (s.caption) o.caps = [{ t: 0, text: s.caption }];
        return o;
      });
    },

    _videoOK: function () {
      try {
        if (typeof document === 'undefined' || !document.createElement) return false;
        var v = document.createElement('video');
        return !!(v && v.canPlayType && v.play);
      } catch (e) { return false; }
    },

    _enter: function (i) {
      this.idx = i; this.t = 0;
      var s = this.shots[i];
      if (!s) { this.finish(); return; }
      this.mode = (s.video && this._videoOK()) ? 'video' : 'still';
      if (this.mode === 'video') this._startVideo(s);
    },

    _next: function () {
      if (this.idx + 1 >= this.shots.length) { this.finish(); return; }
      this._enter(this.idx + 1);
    },

    /* ===== 更新 ===== */
    update: function (dt) {
      if (!this.open) return;
      if (this.ask) { this._hold += dt; return; }
      var s = this.shots[this.idx];
      if (!s) { this.finish(); return; }
      this.t += dt;
      if (this.mode === 'video') {
        if (videoEl && videoEl._ended) { this._next(); return; }
        this._syncVideoCap(s);
        if (this.t >= s.dur + 1.2) this._next();
      } else {
        if (this.t >= s.dur) this._next();
      }
    },

    _capText: function (s) {
      var t = this.mode === 'video' && videoEl ? (videoEl.currentTime || this.t) : this.t;
      var txt = '';
      for (var i = 0; i < s.caps.length; i++) { if (t >= s.caps[i].t) txt = s.caps[i].text; }
      return txt;
    },

    /* ===== 输入 ===== */
    onTap: function (p) {
      if (this.ask) {
        /* 是 / 否 命中 */
        var cx = 240, w = 70, y = 150, h = 30;
        if (p.y >= y && p.y <= y + h) {
          if (p.x >= cx - 90 && p.x <= cx - 90 + w) { this.finish(); return; }
          if (p.x >= cx + 20 && p.x <= cx + 20 + w) { this.ask = false; return; }
        }
        return;
      }
      if (this.mode === 'video') {
        /* 视频模式：屏幕右上“跳过”按钮由 DOM 承担；点其余区域不打断 */
        return;
      }
      /* 静帧：点击弹出跳过确认（避免误触打断情绪） */
      this.ask = true; this._hold = 0;
    },

    /* ===== Canvas 渲染（静帧路径 + 公共层） ===== */
    render: function (x) {
      if (!this.open) return;
      var s = this.shots[this.idx];
      if (!s) { this.finish(); return; }
      if (this.mode === 'still') this._renderStill(x, s);
      /* 视频模式的画面与字幕由 DOM 承担；这里只在确认框出现时压一层暗罩 */
      if (this.ask) this._renderAsk(x, this.mode === 'video');
    },

    _img: function (key) {
      try { return G.Assets && G.Assets.img ? G.Assets.img(key) : null; } catch (e) { return null; }
    },

    _renderStill: function (x, s) {
      var n = s.imgs.length, p = this.t / s.dur;
      var zoom = s.zoom0 + (s.zoom1 - s.zoom0) * p;
      var panX = Math.cos(p * Math.PI) * s.pan;
      var panY = Math.sin(p * Math.PI * 0.5) * s.pan * 0.4;
      /* 底黑，防透明 */
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
      if (n) {
        for (var k = 0; k < n; k++) {
          var winStart = k * (s.dur / n) - (k > 0 ? FADE : 0);
          var winEnd = (k + 1) * (s.dur / n);
          var a = Math.max(0, Math.min(1, (this.t - winStart) / FADE))
                * Math.max(0, Math.min(1, (winEnd - this.t) / FADE));
          if (a <= 0.001) continue;
          var img = this._img(s.imgs[k]);
          if (!img) continue;
          x.save(); x.globalAlpha = a;
          this._cover(x, img, zoom, panX, panY);
          x.restore();
        }
      } else {
        this._renderPlaceholder(x, s);
      }
      /* 黑边（开场/收场轻微缓动） */
      var be = Math.min(1, this.t / 0.5);
      x.fillStyle = '#000';
      x.fillRect(0, 0, W, BAR * be);
      x.fillRect(0, H - BAR * be, W, BAR * be);
      /* 跳过提示 */
      if (this.t > 0.8 && !this.ask)
        G.UI.text(x, { x: W - 12, y: 8 }, '点击跳过 ▸', 8.5, 'rgba(230,230,230,0.7)', 'right');
      /* 字幕 */
      this._renderCaption(x, s);
    },

    _cover: function (x, img, zoom, panX, panY) {
      var base = Math.max(W / img.width, H / img.height) * zoom;
      var dw = img.width * base, dh = img.height * base;
      var dx = (W - dw) / 2 + panX, dy = (H - dh) / 2 + panY;
      x.drawImage(img, dx, dy, dw, dh);
    },

    _renderCaption: function (x, s) {
      var txt = this._capText(s);
      if (!txt) return;
      var lines = G.UI.wrap(x, txt, 13, 400);
      var ch = lines.length * 19;
      var y0 = H - CAP_BOTTOM - ch + 8;
      var g = x.createLinearGradient(0, y0 - 12, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.72)');
      x.fillStyle = g; x.fillRect(0, y0 - 12, W, H - (y0 - 12));
      lines.forEach(function (l, i) {
        G.UI.text(x, { x: W / 2, y: y0 + i * 19 }, l, 13, '#f2e9d6', 'center');
      });
    },

    _renderPlaceholder: function (x, s) {
      x.fillStyle = '#10131c'; x.fillRect(0, 0, W, H);
      G.UI.text(x, { x: W / 2, y: H / 2 - 8 }, '（影像加载中）', 12, G.UI.C.textDim, 'center');
    },

    _renderAsk: function (x, fullDim) {
      x.save();
      x.fillStyle = fullDim ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.55)';
      x.fillRect(0, 0, W, H);
      G.UI.text(x, { x: 240, y: 112 }, '跳过这段剧情？', 15, G.UI.C.goldHi, 'center');
      var cx = 240, w = 70, y = 150, h = 30;
      this._askBtn(x, cx - 90, y, w, h, '是');
      this._askBtn(x, cx + 20, y, w, h, '否');
      x.restore();
    },
    _askBtn: function (x, bx, y, w, h, label) {
      x.fillStyle = 'rgba(20,26,40,0.95)';
      x.strokeStyle = 'rgba(216,183,104,0.8)';
      G.UI.rr(x, bx, y, w, h, 5); x.fill(); x.stroke();
      G.UI.text(x, { x: bx + w / 2, y: y + 8 }, label, 12, G.UI.C.text, 'center');
    },

    /* ================= DOM 视频路径（仅真实浏览器） ================= */
    _ensureDom: function () {
      if (dom) return dom;
      var self = this;
      dom = document.createElement('div');
      dom.style.position = 'fixed';
      dom.style.left = '0'; dom.style.top = '0'; dom.style.right = '0'; dom.style.bottom = '0';
      dom.style.zIndex = '9999';
      dom.style.background = '#000';
      dom.style.display = 'none';
      videoEl = document.createElement('video');
      videoEl.style.position = 'absolute';
      videoEl.style.left = '0'; videoEl.style.top = '0';
      videoEl.style.width = '100%'; videoEl.style.height = '100%';
      videoEl.style.objectFit = 'cover';
      videoEl.muted = true; videoEl.playsInline = true;
      videoEl.addEventListener('ended', function () { videoEl._ended = true; });
      capEl = document.createElement('div');
      capEl.style.position = 'absolute';
      capEl.style.left = '5%'; capEl.right = '5%'; capEl.style.bottom = '7%';
      capEl.style.width = '90%';
      capEl.style.textAlign = 'center';
      capEl.style.color = '#f2e9d6';
      capEl.style.fontSize = '20px';
      capEl.style.textShadow = '0 1px 6px rgba(0,0,0,0.9)';
      capEl.style.fontFamily = '"LXGW WenKai",KaiTi,serif';
      skipEl = document.createElement('div');
      skipEl.innerHTML = '跳过 ▸';
      skipEl.style.position = 'absolute';
      skipEl.style.top = '12px'; skipEl.style.right = '16px';
      skipEl.style.color = 'rgba(230,230,230,0.85)';
      skipEl.style.fontSize = '15px';
      skipEl.style.padding = '4px 10px';
      skipEl.style.cursor = 'pointer';
      skipEl.addEventListener('click', function (e) { e.stopPropagation(); self.finish(); });
      dom.appendChild(videoEl); dom.appendChild(capEl); dom.appendChild(skipEl);
      document.body.appendChild(dom);
      return dom;
    },

    _startVideo: function (s) {
      var self = this;
      this._ensureDom();
      dom.style.display = 'block';
      videoEl._ended = false;
      videoEl.src = s.video;
      capEl.innerHTML = '';
      var p = videoEl.play();
      if (p && p.catch) p.catch(function () {
        /* 自动播放受限或加载失败 → 回退静帧 */
        dom.style.display = 'none';
        self.mode = 'still'; self.t = 0;
      });
    },

    _syncVideoCap: function (s) {
      if (!capEl) return;
      var txt = this._capText(s);
      if (capEl.innerHTML !== txt) capEl.innerHTML = txt;
    },

    _stopVideo: function () {
      if (dom) dom.style.display = 'none';
      if (videoEl) { try { videoEl.pause(); } catch (e) {} videoEl.removeAttribute('src'); videoEl._ended = false; }
      if (capEl) capEl.innerHTML = '';
    }
  };

  G.Cutscene = C;
})();
