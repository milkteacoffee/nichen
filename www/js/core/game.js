/* 游戏主控：Canvas 适配、场景路由、主循环、Toast */
(function () {
  var Game = {
    W: 480, H: 272,
    canvas: null, ctx: null,
    scene: null, sceneName: '',
    toasts: [],
    whisper: null,   // 天道低语（非阻断，顶部，自动淡去）
    meta: null, save: null,
    speedMul: 1,
    S: 2,   // 内部分辨率倍率（逻辑坐标仍为 480×272）

    start: function () {
      this.canvas = document.getElementById('game');
      this.ctx = this.getContext();
      G.Input.init(this.canvas);
      this.resize();
      window.addEventListener('resize', this.resize.bind(this));
      window.addEventListener('orientationchange', this.resize.bind(this));

      this.meta = G.Storage.loadMeta();

      /* 素材层：先开局，素材到货后清缓存重绘（缺素材走程序化，不阻塞）。
         三级缓存都要清，尤其 Sprites —— 首个场景（标题/城镇）可能在素材到货前
         就已经把程序化精灵烘进 heroCache，只清 Art 的话会一直拿旧位图，
         表现成"人物形象和素材不一致/四向不一致"。 */
      if (G.Assets && G.Assets.load) {
        G.Assets.load(function () {
          G.Art.clear();
          if (G.Sprites && G.Sprites.clear) G.Sprites.clear();
          G.UI.clearCache();
        });
      }

      this.changeScene('title');
      this._last = performance.now();
      requestAnimationFrame(this.loop.bind(this));
    },

    getContext: function () {
      var c = this.canvas.getContext('2d');
      c.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in c) c.imageSmoothingQuality = 'high';
      return c;
    },

    resize: function () {
      var w = window.innerWidth, h = window.innerHeight;
      var scale = Math.min(w / this.W, h / this.H);
      this.canvas.style.width = Math.floor(this.W * scale) + 'px';
      this.canvas.style.height = Math.floor(this.H * scale) + 'px';

      /* 内部倍率必须 ≥ 实际显示倍率。以前固定 3，在 1080p 上显示倍率接近 4，
         浏览器把整幅 1440×816 的缓冲放大到 1900×1080 —— 全屏一起发糊。
         现在按 ceil(显示倍率 × dpr) 自适应：下限 3 是画质地板，上限 4 是性能天花板
         （4 倍缓冲 = 1920×1088，实测仍在 60fps 余量内）。 */
      var dpr = window.devicePixelRatio || 1;
      var q = Math.max(3, Math.min(4, Math.ceil(scale * dpr)));
      this.canvas.width = this.W * q;
      this.canvas.height = this.H * q;
      /* 改 width/height 会把 2D 上下文重置为默认状态，平滑设置要重新贴一遍 */
      this.ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in this.ctx) this.ctx.imageSmoothingQuality = 'high';

      if (q !== this.S) {
        this.S = q;
        this._rebakeArt();
      }
    },

    /* 倍率变了 → 三级缓存全部按新倍率重烘。漏掉任何一级都会残留旧倍率位图，
       表现就是"改完之后角色还是糊的"。 */
    _rebakeArt: function () {
      if (G.Art && G.Art.setK && G.Art.setK(this.S)) {
        if (G.Sprites && G.Sprites.clear) G.Sprites.clear();
        if (G.UI && G.UI.clearCache) G.UI.clearCache();
      }
    },

    changeScene: function (name, params) {
      var s = G.scenes[name];
      if (!s) { this.toast('场景未开放：' + name); return; }
      if (this.scene && this.scene.exit) this.scene.exit();
      this.sceneName = name;
      this.scene = s;
      s.buttons = [];
      if (s.enter) s.enter(params || {});
    },

    toast: function (text, sec) {
      this.toasts.push({ text: text, t: sec || 1.6 });
    },

    /* 统一死亡入口（轮回转世 v0.4 §3.1 / v2.7）：
       先入「天道拦魂」，问话结束后再进 death 结算。cause = 'war' | 'aged' | 'event' */
    die: function (cause) {
      if (this.sceneName === 'death' || this.sceneName === 'heaven') return;
      if (this.save) {
        this.save._cause = cause || 'war';
        this.save.hp = 0;
        G.Storage.saveCurrent(this.save);
      }
      this.changeScene('heaven');
    },

    /* 寿元尽 → 坐化。年龄推进（战斗/打坐/突破）后统一裁决。
       返回 true 表示本次已切到死亡结算，调用方必须立即 return。 */
    checkAged: function () {
      if (!this.save || this.sceneName === 'death') return false;
      if (this.sceneName === 'battle') return false;      /* 战斗内由 _defeat 收尾 */
      if (!G.Player.isAged(this.save)) return false;
      G.Player.chronicle(this.save, 'aged', '寿元将尽，坐化');
      this.die('aged');
      return true;
    },

    loop: function (now) {
      /* dt 必须**上下都夹**：上夹 50ms 防切回前台时一帧跳几秒；
         下夹 0 防时间源回拨 —— 只要 dt 变负，所有 `-= dt` 的计时器就一起倒着走
         （闪白越收越亮、战斗 cue 永不结束、Toast 永不消失）。
         无头测试里虚拟时钟回拨过一次，就是这么炸的。 */
      var dt = (now - this._last) / 1000;
      if (!(dt > 0)) dt = 0; else if (dt > 0.05) dt = 0.05;
      this._last = now;
      var x = this.ctx, inp = G.Input;

      /* 输入分发：按钮优先 */
      for (var i = 0; i < inp.taps.length; i++) {
        var p = inp.taps[i], handled = false;
        var btns = this.scene.buttons || [];
        for (var b = 0; b < btns.length; b++) {
          if (!btns[b].disabled && btns[b].hit(p)) {
            btns[b]._p = .14;
            btns[b].onClick(p); handled = true; break;
          }
        }
        if (!handled && this.scene.onTap) this.scene.onTap(p);
      }
      for (var code in inp.pressed) {
        if (this.scene.onKey) this.scene.onKey(code);
      }

      if (this.scene.update) this.scene.update(dt);

      /* 天道低语计时（与场景无关） */
      if (this.whisper) {
        this.whisper.tw.update(dt);
        this.whisper.t -= dt;
        if (this.whisper.t <= 0) this.whisper = null;
      }

      /* 高分渲染：逻辑坐标 480×272；UI 场景开平滑，像素场景关平滑 */
      x.setTransform(this.S, 0, 0, this.S, 0, 0);
      x.imageSmoothingEnabled = !!this.scene.smooth;
      x.fillStyle = '#0b0d14';
      x.fillRect(0, 0, this.W, this.H);
      if (this.scene.render) this.scene.render(x);

      /* 悬浮说明：**必须在所有东西画完之后**才画（它是"覆盖层之上的覆盖层"），
         候选区由场景/面板在 render 期间用 G.UI.hover() 登记。
         reset 放在下一帧 render 之前，所以这里画完就清。 */
      G.UI.drawHover(x);
      G.UI.hoverReset();

      /* 按钮计时 */
      var allBtns = this.scene.buttons || [];
      for (var bi = 0; bi < allBtns.length; bi++) {
        if (allBtns[bi].tick) allBtns[bi].tick(dt);
      }

      this._renderWhisper(x);

      /* Toast 覆盖层 */
      for (var t = this.toasts.length - 1; t >= 0; t--) {
        var to = this.toasts[t];
        to.t -= dt;
        if (to.t <= 0) { this.toasts.splice(t, 1); continue; }
      }
      this._renderToasts(x);

      inp.endFrame();
      requestAnimationFrame(this.loop.bind(this));
    },

    /* 天道低语：顶部金框谶语，淡入 → 停留 → 淡出，不阻断操作 */
    _renderWhisper: function (x) {
      var w = this.whisper;
      if (!w || !w.tw) return;
      var life = 8.5 - w.t;
      var a = Math.min(1, life * 2.4) * Math.min(1, w.t / 1.4);
      var part = w.tw.part();
      var lines = G.UI.wrap(x, part, 12.5, 360);
      var h = 22 + lines.length * 18;
      var y0 = 56;
      x.save();
      x.globalAlpha = a;
      G.UI.panel(x, { x: 60, y: y0, w: 360, h: h },
        'rgba(10,13,24,0.92)', 'rgba(216,183,104,0.7)', 5, { paper: false });
      G.UI.text(x, { x: 240, y: y0 + 5 }, '天 道 低 语', 10, G.UI.C.gold, 'center');
      lines.forEach(function (l, i) {
        G.UI.text(x, { x: 240, y: y0 + 19 + i * 18 }, l, 12.5,
          G.UI.C.text, 'center');
      });
      x.restore();
    },

    _renderToasts: function (x) {
      if (!this.toasts.length) return;
      var pad = 9, lineH = 20, w = 240;
      var h = this.toasts.length * lineH + pad;
      /* 底部要让开探索场景的功能栏（28px），否则提示被压在底栏底下看不见 */
      var bot = (G.Explore && G.Explore.BOT_H) || 0;
      var y0 = this.H - h - 14 - bot;
      G.UI.panel(x, { x: this.W / 2 - w / 2, y: y0, w: w, h: h },
        '#161b28', 'rgba(216,183,104,0.65)', 5);
      for (var i = 0; i < this.toasts.length; i++) {
        G.UI.textOut(x, { x: this.W / 2, y: y0 + pad / 2 + i * lineH + 4 },
          this.toasts[i].text, 13, G.UI.C.text, 'center');
      }
    }
  };

  G.game = Game;
  G.scenes = {};
})();
