/* 游戏主控：Canvas 适配、场景路由、主循环、Toast */
(function () {
  /* 战利品浮层的存活时长（秒）：用户口径「弹出 3 秒左右」 */
  var LOOT_T = 3.0;

  /* ===== 环境粒子（v0.60.0）：让每个场景都有"流动的空气"，去 PPT 感 =====
     光点自下而上漂浮、轻微摆动；halo=低透明晕、core=亮芯，'lighter' 叠加出辉光。
     打开面板/覆盖层或剧情弹窗时不画。场景名确定性生成 → 截图可复现。 */
  function C(halo, core) { return { halo: halo, core: core }; }
  var AMBIENT = {
    /* 暖：萤火 + 灵气金点（城镇/野外/生成区域的默认观感） */
    _warm: [C('rgba(240,205,130,0.10)', 'rgba(255,228,165,0.55)'),
            C('rgba(160,200,140,0.09)', 'rgba(195,235,175,0.42)'),
            C('rgba(150,185,230,0.08)', 'rgba(185,215,250,0.38)')],
    /* 冷：洞/副本里的幽蓝、紫孢子 */
    _cool: [C('rgba(130,180,230,0.10)', 'rgba(170,215,255,0.5)'),
            C('rgba(180,140,220,0.09)', 'rgba(210,180,250,0.42)')],
    /* 金：天界/轮回/死亡，向上飞升的光尘 */
    _rise: [C('rgba(245,225,160,0.12)', 'rgba(255,240,190,0.6)'),
            C('rgba(220,235,255,0.10)', 'rgba(240,248,255,0.5)')],
    /* 标题：金尘，更慢更稀 */
    _gold: [C('rgba(235,200,120,0.10)', 'rgba(250,225,150,0.5)')]
  };
  function amb(n, col, sp0, sp1, r0, r1, amp) {
    return { n: n, col: col, sp0: sp0, sp1: sp1, r0: r0, r1: r1, amp: amp };
  }
  var AMBIENT_FOR = {
    title: amb(18, AMBIENT._gold, 2, 6, .6, 1.6, 1.8),
    town: amb(22, AMBIENT._warm, 3, 9, .6, 1.7, 2.4),
    field: amb(24, AMBIENT._warm, 3, 10, .6, 1.8, 2.6),
    cave: amb(22, AMBIENT._cool, 3, 9, .6, 1.7, 2.2),
    dungeon: amb(24, AMBIENT._cool, 3, 10, .6, 1.8, 2.2),
    bloodhall: amb(24, AMBIENT._cool, 3, 10, .6, 1.8, 2.2),
    heaven: amb(26, AMBIENT._rise, 6, 14, .6, 1.9, 2.0),
    'reincarnation-hall': amb(26, AMBIENT._rise, 6, 14, .6, 1.9, 2.0),
    death: amb(24, AMBIENT._rise, 5, 12, .6, 1.8, 2.0),
    difficulty: amb(16, AMBIENT._cool, 2, 6, .5, 1.4, 1.6),
    reincarnation: amb(16, AMBIENT._cool, 2, 6, .5, 1.4, 1.6),
    _default: amb(22, AMBIENT._warm, 3, 9, .6, 1.7, 2.4)
  };

  var Game = {
    W: 480, H: 272,
    canvas: null, ctx: null,
    scene: null, sceneName: '',
    toasts: [],
    lootFeed: [],
    /* 全局秒表（战利品辉光之类的呼吸动画用）。
       ⚠️ 不要用 `performance.now()` 之类的"墙上时间"：它会让呼吸相位不可复现，
       截图与契约都没法钉（本轮初版直接写了 `this.time` 而它并不存在 → rgba 收到 NaN）。 */
    time: 0,
    whisper: null,   // 天道低语（非阻断，顶部，自动淡去）
    meta: null, save: null,
    speedMul: 1,
    /* FPS 与倍率。
       ⚠️ v0.98.0：`targetFps` 从 120 提到 **180**（用户口径「帧率要 180 以上」）。
       ⚠️ 但**必须说清物理边界**：rAF 的上限 = **屏幕刷新率**，代码改不了。
          180Hz 屏 + 我们每帧只花 ~2ms → 实测就是 180fps；
          60Hz 屏物理上最多 60fps（这不是缺陷，是硬件）。
          所以"180+"的正解是两条：① 让**我们的帧预算**远小于 5.56ms（180fps 的预算），
          这样在任何屏上都不会因为我们而掉帧；② 高刷屏上自然就跑满。 */
    fps: 0, targetFps: 180,
    _fcnt: 0, _facc: 0, _ftEma: 0.016, _qualT: 0,
    /* 我们自己的**绘制耗时** EMA（秒）。这才是"画得动多细"的真实信号 ——
       与屏幕刷新率无关（`_ftEma` 是帧间隔，由 rAF 决定，判它等于看别人脸色）。 */
    _drawMsEma: 0,
    /* 倍率上下限。⚠️ 实测数据（headless 无 GPU = **最保守环境**，有 GPU 只会更好）：
         S=3 (1440×816)  → 153 fps   绘制 EMA 0.95ms
         S=4 (1920×1088) → **172 fps** 绘制 EMA 0.98ms   ← 甜点
         S=5 (2400×1360) →  88 fps   绘制 EMA 0.93ms
         S=6 (2880×1632) →  57 fps   绘制 EMA 0.87ms
       ⚠️ 注意绘制 EMA 在 0.9ms **几乎不变**，而 FPS 从 172 崩到 57 ——
          说明瓶颈**不是我们的 render**，而是**画布合成**（2D 缓冲 → 屏幕的拷贝）：
          分辨率越高，合成越贵，且它不计在我们夹表的区间里。
          所以 `_autoQuality` 只看 `drawMs` **不足以挡住 S 冲顶**，必须补帧预算闸。
       取值：地板 **3**（1440×816，1080p 上仍清晰；2 倍明显糊，不再允许）；
             天花板 **4**（1920×1088）—— 实测甜点，再往上纯粹拿帧率换像素。 */
    MIN_S: 3, MAX_S: 4,
    /* 氛围层（雾 + 昼夜色温）开关。初始开；帧率不足时由 _autoQuality 先关它、
       再降分辨率（氛围是锦上添花，分辨率是可读性）。 */
    _fogOn: true,
    S: 3,   // 内部分辨率倍率（逻辑坐标仍为 480×272）

    /* ===== 打击感系统（v0.76.0 阶段一）===== */
    _shakeIntensity: 0,    // 震动强度（0-1）
    _shakeDuration: 0,     // 震动持续时间（ms）
    _shakeTime: 0,         // 震动已持续时间
    _pauseUntil: 0,        // 顿帧暂停到的时间戳
    _breakthroughEffect: null,  // 突破特效数据

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
         现在按 ceil(显示倍率 × dpr) 自适应：下限 `MIN_S` 是画质地板（v0.98.0 从 2 提到 3：
         2 倍在 1080p 上明显发糊，用户要"电影节画质"不能让位），上限 `MAX_S` 是性能天花板。
         ⚠️ 用 `this.MIN_S/MAX_S` 而不是字面量 —— 与 `_setS` 共用同一对常量，
            否则"resize 给的初始值"与"自适应能调的档位"会分叉。 */
      var dpr = window.devicePixelRatio || 1;
      var q = Math.max(this.MIN_S, Math.min(this.MAX_S, Math.ceil(scale * dpr)));
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

    /* 自适应高清倍率。
       ⚠️ v0.98.0 **判据修正**（这是"画面发糊"的系统性成因）：
       原先判 `_ftEma`（**帧间隔**），可帧间隔由 `requestAnimationFrame` 决定
       = **屏幕刷新率**，跟我们画得快不快**毫无关系**。后果：

         60Hz 屏：间隔 16.7ms，而阈值 = (1/120)*1.6 = 13.3ms → **每次都判"超预算"**
                  → 一路降到画质地板 S=2（960×544），**必糊**；
         120Hz 屏：间隔 8.3ms < 13.3ms，但也 > 升至阈值 5.8ms → 卡住不动；
         只有 144Hz+ 才可能升档。

       即：**帧率越高反而越不容易掉画质**，而绝大多数玩家是 60Hz。

       现在用**两个判据**（缺一不可，实测教训）：
         ① `_drawMsEma`（我们的 render 耗时）—— 超 8ms 降、低于 3ms 升；
         ② **帧预算闸**：FPS 低于目标的 65% 时也降档。
           为什么必须有②：绘制 EMA 在 S=3~6 都只有 ~0.9ms（几乎不变），
           只判它会让 S 一路冲到上限，而真正的瓶颈是**画布合成**
           （2D 缓冲→屏幕的拷贝，不计在我们的夹表区间）——
           实测 S=5/6 时 FPS 从 172 崩到 88/57，而 drawMs 纹丝不动。
           **只测"我们花的"，测不到"整帧花的"，就会得出错误的结论。**
       两者之间**不动**（避免边界反复横跳、反复重烘缓存）。 */
    _autoQuality: function () {
      var dm = this._drawMsEma;
      var lowFps = this.fps > 0 && this.fps < this.targetFps * 0.65;
      var plenty = dm > 0 && dm < 3.0;
      /* ⚠️ 降档**优先级**：先丢"氛围层"（雾/色温），再降分辨率。
         理由：氛围层是**锦上添花**（没有它画面依然完整），而分辨率是**可读性**
         （降到 S=2 字就糊了）。所以帧率不足时先关雾保帧率，
         而不是一上来就把画面调糊 —— "电影感"不如"看清"重要。 */
      if (lowFps) {
        if (this._fogOn !== false) { this._fogOn = false; return; }
        if (this.S > this.MIN_S) { this._setS(this.S - 1); return; }
      } else if (plenty && this.fps > this.targetFps * 0.9) {
        /* 帧率充裕 → 先把雾加回来，再谈升分辨率 */
        if (this._fogOn === false) { this._fogOn = true; return; }
      }
      if (dm > 8.0 && this.S > this.MIN_S) this._setS(this.S - 1);
      else if (plenty && !lowFps && this.S < this.MAX_S) this._setS(this.S + 1);
    },
    _setS: function (q) {
      if (q === this.S || q < this.MIN_S || q > this.MAX_S) return;
      this.S = q;
      this.canvas.width = this.W * q; this.canvas.height = this.H * q;
      this.ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in this.ctx) this.ctx.imageSmoothingQuality = 'high';
      this._rebakeArt();
    },

    _renderFps: function (x) {
      var cfg = G.TianDao && G.TianDao.ensure ? G.TianDao.ensure() : null;
      if (!cfg || !cfg.showFps) return;
      var s = Math.round(this.fps) + ' FPS · 画质' + this.S + 'x';
      x.save(); x.font = G.UI.F(9);
      var w = x.measureText(s).width + 10;
      x.fillStyle = 'rgba(8,10,18,0.62)';
      G.UI.rr(x, this.W - w - 6, this.H - 18, w, 14, 3); x.fill();
      var col = this.fps >= 100 ? '#8fd878' : (this.fps >= 50 ? '#ffd870' : '#ff8a5a');
      G.UI.text(x, { x: this.W - 11, y: this.H - 16 }, s, 9, col, 'right');
      x.restore();
    },

    changeScene: function (name, params) {
      var s = G.scenes[name];
      /* 生成型区域场景惰性创建；读档「继续当世」直接落到 fan6 这类区域时，G.scenes 还是新的，
         必须先按 regionId 建出场景，否则误报「场景未开放」。F1–F3 复用手写地图（mapIdOf≠id）不进此路。 */
      if (!s && G.RegionGen && G.Data.regions && G.Data.regions.byId(name)
        && G.Data.regions.mapIdOf(name) === name) {
        s = G.RegionGen.sceneFor(name);
      }
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

    /* 回到当世（v0.61.0）：补时钟字段 → **结算离线打坐** → 刷新时间戳。
       用户第 4 点：「需要新增离线打坐收益灵气，这样才能把灵根的作用体现出来」。
       ⚠️ 只能在"读档那一刻"调一次 —— 它要读"上次离开到现在的现实时长"，
          再调一次 `lastSeen` 已被刷新，收益归零（不会重复发放，但也别指望第二遍有货）。
       返回结算结果（null = 不足阈值），方便契约与测试直接断言。 */
    resumeWorld: function () {
      var save = this.save;
      if (!save) return null;
      if (G.Time) G.Time.ensure(save);
      var off = G.Time ? G.Time.offlineGain(save, Date.now()) : null;
      if (off) {
        save.qi = (save.qi || 0) + off.gain;
        if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
        this.toast('离线闭关 ' + Math.round(off.gameDays) + ' 日 · 灵气 +' + off.gain, 3.4);
      }
      return off;
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
      /* 顿帧检测：如果在暂停期内，直接跳过本帧 */
      if (this._pauseUntil > 0 && now < this._pauseUntil) {
        requestAnimationFrame(this.loop.bind(this));
        return;
      }
      this._pauseUntil = 0;

      /* dt 必须**上下都夹**：上夹 50ms 防切回前台时一帧跳几秒；
         下夹 0 防时间源回拨 —— 只要 dt 变负，所有 `-= dt` 的计时器就一起倒着走
         （闪白越收越亮、战斗 cue 永不结束、Toast 永不消失）。
         无头测试里虚拟时钟回拨过一次，就是这么炸的。 */
      var dt = (now - this._last) / 1000;
      if (!(dt > 0)) dt = 0; else if (dt > 0.05) dt = 0.05;
      this._last = now;
      /* 帧率测量（0.5s 滑窗）+ 帧时 EMA，供自适应高清倍率 */
      this._fcnt++; this._facc += dt;
      if (dt > 0) this._ftEma = this._ftEma * 0.95 + dt * 0.05;
      if (this._facc >= 0.5) { this.fps = this._fcnt / this._facc; this._fcnt = 0; this._facc = 0; }
      this._qualT += dt;
      if (this._qualT >= 1.5) { this._qualT = 0; this._autoQuality(); }
      var x = this.ctx, inp = G.Input;

      /* 输入分发：按钮优先 */
      for (var i = 0; i < inp.taps.length; i++) {
        var p = inp.taps[i], handled = false;
        if (G.Cutscene && G.Cutscene.isOpen()) { G.Cutscene.onTap(p); continue; }
        if (G.Story && G.Story.modalOpen()) { G.Story.onTap(p); continue; }
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

      if (!(G.Cutscene && G.Cutscene.isOpen()) && this.scene.update) this.scene.update(dt);
      if (G.Cutscene && G.Cutscene.isOpen()) G.Cutscene.update(dt);

      /* 世界时钟（v0.67.0，用户第 28 点）：
         ⚠️ **普通游玩（探索/战斗）不流逝时间** —— 用户原话「玩家在游玩时不会流逝时间，
            只有闭关才会有时间流逝」。旧版在这里无条件 `G.Time.tick`，等于"站着不动也在老"，
            与"修仙者的每一分寿元都花在修炼上"背道而驰。
         现在只在**秘境/副本**里跑时钟（`sceneMult() > 1`，即探索/战斗之外的 ×12 场景），
         加上副本每层另结 30 游戏日（见 `dungeon.js: dungeonFloor`）——
         「主角进入一些秘境会加速时间流逝，这是修仙世界的残酷」。 */
      if (this.save && G.Time && G.Time.sceneMult() > 1) G.Time.tick(this.save, dt);

      /* 天道低语计时（与场景无关） */
      if (this.whisper) {
        this.whisper.tw.update(dt);
        this.whisper.t -= dt;
        if (this.whisper.t <= 0) this.whisper = null;
      }
      if (G.Story) G.Story.update(dt);

      /* 高分渲染：逻辑坐标 480×272；UI 场景开平滑，像素场景关平滑 */
      /* 震动效果：在 setTransform 时添加偏移 */
      var shakeX = 0, shakeY = 0;
      if (this._shakeTime < this._shakeDuration) {
        var progress = this._shakeTime / this._shakeDuration;
        var intensity = this._shakeIntensity * (1 - progress);  // 衰减
        shakeX = (Math.random() - 0.5) * intensity * 8;
        shakeY = (Math.random() - 0.5) * intensity * 8;
      }
      x.setTransform(this.S, 0, 0, this.S, shakeX * this.S, shakeY * this.S);
      x.imageSmoothingEnabled = !!this.scene.smooth;
      /* ⚠️ v0.98.0：**测我们自己的绘制耗时**（`_autoQuality` 的判据）。
         夹在"开始画"到"场景画完"之间 —— 这是我们的真实负担。
         用 performance.now()（亚毫秒精度）；无头环境同样可用。 */
      var _tDraw = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      x.fillStyle = '#0b0d14';
      x.fillRect(0, 0, this.W, this.H);
      if (this.scene.render) this.scene.render(x);
      /* 环境粒子：画在场景之上、悬停/面板之外（打开覆盖层时方法内部自行跳过） */
      this._renderAmbient(x);
      /* 昼夜色温 + 体积雾**不在这里挂载** ——
         它们在 `explore.render` 的"世界层收口处"（`_zoom` 恢复之后、`_drawHUD` 之前）调用。
         原因：`_drawHUD` 是**场景内部**方法，也在 `scene.render()` 之内；
         挂在这里会把 HUD（气血条、资源数字）一起染色 —— 实测夜晚整条 HUD 偏蓝读不清。
         色温要染的是"世界"，不是"界面"。 */
      if (_tDraw) {
        var dms = (performance.now() - _tDraw) / 1000;
        if (dms > 0 && dms < 0.5) {                /* 夹掉切场景/首帧的离群点 */
          this._drawMsEma = this._drawMsEma > 0
            ? this._drawMsEma * 0.9 + dms * 0.1 : dms;
        }
      }
      /* 影像过场：覆盖场景（视频路径仅真实浏览器可见，无头走静帧） */
      if (G.Cutscene && G.Cutscene.isOpen()) G.Cutscene.render(x);

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

      /* 更新震动和突破特效（v0.76.0） */
      if (this._shakeTime < this._shakeDuration) {
        this._shakeTime += dt * 1000;
      }
      if (this._breakthroughEffect) {
        this._breakthroughEffect.t += dt;
        // 更新粒子位置
        for (var pi = 0; pi < this._breakthroughEffect.particles.length; pi++) {
          var p = this._breakthroughEffect.particles[pi];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 30 * dt;  // 重力
        }
        if (this._breakthroughEffect.t >= this._breakthroughEffect.duration) {
          this._breakthroughEffect = null;
        }
      }

      this.time += dt;
      /* 濒死红屏画在**场景之后、一切浮层之前** —— 它是背景级的警示，
         压在战利品/ toast 下面（那些是信息，不能被红雾糊掉）。 */
      this._renderDanger(x);
      this._renderWhisper(x);

      /* Toast 覆盖层 */
      for (var t = this.toasts.length - 1; t >= 0; t--) {
        var to = this.toasts[t];
        to.t -= dt;
        if (to.t <= 0) { this.toasts.splice(t, 1); continue; }
      }
      /* 战利品浮层（v0.17.0）：与 toast 同一段更新，但**先于** toast 渲染 ——
         toast 带框，万一同屏，框应该盖住裸文字而不是反过来。 */
      for (var lf = this.lootFeed.length - 1; lf >= 0; lf--) {
        this.lootFeed[lf].t -= dt;
        if (this.lootFeed[lf].t <= 0) this.lootFeed.splice(lf, 1);
      }
      this._renderLoot(x);
      this._renderToasts(x);
      this._renderFps(x);
      /* 突破特效：画在最上层 */
      this._renderBreakthroughEffect(x);
      if (G.Story) G.Story.render(x);

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
        'rgba(10,13,24,0.92)', 'rgba(216,183,104,0.7)', 5, { tex: false });
      G.UI.text(x, { x: 240, y: y0 + 5 }, '天 道 低 语', 10, G.UI.C.gold, 'center');
      lines.forEach(function (l, i) {
        G.UI.text(x, { x: 240, y: y0 + 19 + i * 18 }, l, 12.5,
          G.UI.C.text, 'center');
      });
      x.restore();
    },

    /* 战利品浮层（v0.17.0）：**纯文字、无框、小字、约 3 秒**（用户口径）。
       为什么单开一条通道而不复用 toast：toast 是"一块带框的板"（`G.UI.panel`），
       压在画面上很重；战利品是高频、低重要度的信息（每场战斗都有），
       用板子读起来像弹窗 —— 用户明确要求"不要有框，纯文字"。
       位置贴**左下沿**（让开底栏与左侧追踪栏），不遮地图中心。
       特殊物品（功法/秘术/碎片/称号）走 `special`：金色 + 呼吸辉光。 */
    loot: function (text, special) {
      if (!text) return;
      this.lootFeed.push({ text: text, t: LOOT_T, special: !!special });
      if (this.lootFeed.length > 5) this.lootFeed.shift();
    },

    _ambientFor: function (name) {
      if (this._ambKey === name) return this._amb;
      var cfg = AMBIENT_FOR[name] || AMBIENT_FOR._default;
      var seed = 0;
      for (var i = 0; i < name.length; i++) seed = (seed * 131 + name.charCodeAt(i)) >>> 0;
      if (!seed) seed = 0x9e3779b9;
      function rnd() { seed = (seed * 1664525 + 1013904221) >>> 0; return seed / 4294967296; }
      var ps = [];
      for (var k = 0; k < cfg.n; k++) {
        ps.push({
          x: rnd() * this.W, y: rnd() * this.H,
          r: cfg.r0 + rnd() * (cfg.r1 - cfg.r0),
          sp: cfg.sp0 + rnd() * (cfg.sp1 - cfg.sp0),
          amp: rnd() * cfg.amp, fr: 0.6 + rnd() * 1.2, ph: rnd() * 6.2832,
          ci: Math.floor(rnd() * cfg.col.length)
        });
      }
      this._ambKey = name; this._amb = { cfg: cfg, ps: ps };
      return this._amb;
    },

    _renderAmbient: function (x) {
      /* 覆盖层打开就不画（含面板、战斗下拉、剧情模态）—— 判据走统一口，
         不在这里再写一份（此前只查 Story + overlay，战斗下拉时会漏）。 */
      if (this._overlayOpen()) return;
      var A2 = this._ambientFor(this.sceneName), cfg = A2.cfg, t = this.time;
      x.save();
      x.globalCompositeOperation = 'lighter';
      for (var i = 0; i < A2.ps.length; i++) {
        var p = A2.ps[i];
        var yy = ((p.y - t * p.sp) % this.H + this.H) % this.H;
        var xx = p.x + Math.sin(t * p.fr + p.ph) * p.amp;
        var c = cfg.col[p.ci];
        x.fillStyle = c.halo;
        x.beginPath(); x.arc(xx, yy, p.r * 2.1, 0, 6.2832); x.fill();
        x.fillStyle = c.core;
        x.beginPath(); x.arc(xx, yy, p.r, 0, 6.2832); x.fill();
      }
      x.restore();
    },

    /* ===== 昼夜色温（v0.99.0，用户口径「动态光照 / 日夜光照色温变化」）=====
       数据源：`G.Time.cal(save).h`（0..23 游戏小时）—— **本来就有**，
       只是从没用于画面（HUD 只显示到"月"）。
       ⚠️ 时间只在**打坐 / 战斗**推进，行走不推进 ——
          所以这是"场景静止、天光在变"：玩家闭关一次可能天就黑了。
       强度用户选了**极强（电影感）**：夜晚真的暗下来、黄昏真的橙。
       ⚠️ **只染世界层**（这个函数在 scene.render 之后、UI 之前）——
          面板/对话/toast 必须保持中性白，否则读不清（截图里那种"整个屏幕发蓝"很难看）。
       ⚠️ 室内（`md.indoor`）与洞窟**不染色温**：见不到天的地方不该有天光，
          它们各走自己的暗幕（`_drawVeil` / `_ensureIndoor`）。 */
    _dayTintAt: function (h) {
      /* 关键帧：h → [r,g,b,alpha]。用**两段插值**（跨午夜要绕回）。
         ⚠️ 全部走固定关键帧、不用随机 —— 截图与契约才钉得住。 */
      var KF = [
        [0,  46, 62, 118, 0.46],   /* 子夜 · 冷蓝，很暗 */
        [4,  54, 68, 126, 0.42],   /* 拂晓前 */
        [5.5, 128, 108, 130, 0.34],/* 微明（加一帧，避免日出段"说亮就亮"） */
        [7,  236, 158, 96, 0.24],  /* 日出 · 橙金 */
        [8.5, 250, 206, 158, 0.14],/* 晨（再补一帧，收敛更缓） */
        [10, 255, 240, 208, 0.06], /* 上午 · 微暖 */
        [12, 255, 252, 240, 0.00], /* 正午 · 中性（零染色，作为基线） */
        [15, 255, 240, 208, 0.06], /* 下午 */
        [17, 248, 178, 108, 0.20], /* 黄昏 · 橙 */
        [18.5, 226, 138, 98, 0.32],/* 日落 · 红（补帧） */
        [20, 120, 104, 134, 0.40], /* 入夜 */
        [22, 62, 78, 128, 0.45],   /* 夜 */
        [24, 46, 62, 118, 0.46]    /* 回到子夜（与 h=0 同值，保证连续） */
      ];
      h = ((h % 24) + 24) % 24;
      for (var i = 0; i < KF.length - 1; i++) {
        var a = KF[i], b = KF[i + 1];
        if (h >= a[0] && h <= b[0]) {
          var u = (b[0] === a[0]) ? 0 : (h - a[0]) / (b[0] - a[0]);
          /* 平滑（smoothstep）—— 线性会让"天说黑就黑"，很硬 */
          u = u * u * (3 - 2 * u);
          return [Math.round(a[1] + (b[1] - a[1]) * u),
            Math.round(a[2] + (b[2] - a[2]) * u),
            Math.round(a[3] + (b[3] - a[3]) * u),
            a[4] + (b[4] - a[4]) * u];
        }
      }
      return [255, 255, 255, 0];
    },
    /* 供契约/探针查当前色温（不依赖渲染） */
    dayTint: function () {
      var s = this.save;
      if (!s || !G.Time || !G.Time.cal) return [255, 255, 255, 0];
      return this._dayTintAt(G.Time.cal(s).h);
    },
    _renderDayTint: function (x) {
      if (this._overlayOpen()) return;              /* 面板打开时不染（读信息优先） */
      if (this._fogOn === false) return;            /* 与雾同生共死（同属氛围层） */
      if (!this.save || !G.Time || !G.Time.cal) return;
      var sc = this.scene;
      /* 室内/洞窟：见不到天，不染 */
      var md = sc && sc.map && sc.map.md;
      if (md && (md.indoor || md.ground === 'cave' || md.ground === 'bloodcave')) return;
      var t = this._dayTintAt(G.Time.cal(this.save).h);
      if (!(t[3] > 0.001)) return;                  /* 正午零染色 = 零回归基线 */
      x.save();
      /* `multiply` 不做 —— 它会把画面压到全黑；用 source-over 的半透明色纱，
         配合一个 `overlay` 的暖/冷分量，才能既染色又保住明暗层次。 */
      x.globalCompositeOperation = 'source-over';
      x.fillStyle = 'rgba(' + t[0] + ',' + t[1] + ',' + t[2] + ',' + t[3].toFixed(3) + ')';
      x.fillRect(0, 0, this.W, this.H);
      x.restore();
    },

    /* ===== 体积雾（v0.99.0，用户口径「体积雾」）=====
       与 `_renderAmbient`（漂浮光点/落花）是**两层不同的东西**：
         · ambient = 亮的小粒子（萤火、雪、落花）→ 加性叠加
         · 这一层 = **大团半透明雾**，随时间缓慢流动 → 压对比、出纵深
       ⚠️ 走**固定种子** —— 随机会让截图钉不住。
       ⚠️ 洞窟/室内不铺（那里有暗幕，再叠雾就全糊了）。
       ⚠️ **雾团必须预烘**（v0.99.0 实测教训）：原先每帧对每团现算
          `createRadialGradient` —— ling1 有 9 团、半径 ~170，S=4 下那是
          9 次大半径渐变求值，绘制 EMA 从 5.3ms 涨到 **9.35ms**（超 8ms 阈值）。
          改成"一张雾团纹理 + 按半径缩放 blit"后回到 ~1ms。 */
    /* ===== 体积雾（v0.99.0，用户口径「体积雾」）=====
       与 `_renderAmbient`（漂浮光点/落花）是**两层不同的东西**：
         · ambient = 亮的小粒子（萤火、雪、落花）→ 加性叠加
         · 这一层 = **大团半透明雾**，随时间缓慢流动 → 压对比、出纵深

       ⚠️⚠️ **实现方式是实测逼出来的**（v0.99.0，别改回去）：
       最初每帧对每团现算 `createRadialGradient` + `arc fill` ——
       9 团大半径（~170px）在 S=4 下极贵。
       改成"128×128 雾团纹理 + 按半径缩放 blit"**更糟**：
       ling1 的绘制 EMA 从 5.3ms 涨到 **12~19ms**，帧率从 311 掉到 **57**。
       真因是**非 1:1 的缩放采样**（128→340，CPU 双线性）比"只在圆内求值渐变"贵得多。
       ⚠️ 教训：**"预烘纹理 + 缩放 blit" 不是无条件的优化** ——
          当缩放倍率大、团数多、又没 GPU 时，它比直接画渐变还慢。

       最终方案：**整片雾预烘成一张可平铺的层**，每帧只做
       **两个整数偏移的 1:1 blit**（无缩放采样、无渐变求值）。
       代价是雾的形状不再逐帧变化，只在**相位上平移** —— 视觉上完全够用
       （雾本来就该"缓慢流动"，而不是"每团独立呼吸"）。 */
    _fogLayer: function () {
      var K = G.Art.K || 3;
      var key = 'fog|' + this.sceneName + '|' + K;
      if (this._fogLayerC && this._fogLayerKey === key) return this._fogLayerC;
      var F = this._fogFor(this.sceneName);
      if (!F || !F.ps.length) { this._fogLayerC = null; this._fogLayerKey = key; return null; }
      /* 层比视口稍大：留出平移余量，避免边缘露白 */
      var lw = this.W + 160, lh = this.H + 80;
      var o = G.Art.cv(lw, lh);
      var g = o.x;
      g.globalCompositeOperation = 'source-over';
      for (var i = 0; i < F.ps.length; i++) {
        var p = F.ps[i];
        var rg = g.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
        var ca = F.col;
        rg.addColorStop(0, 'rgba(' + ca + ',' + p.a.toFixed(3) + ')');
        rg.addColorStop(0.55, 'rgba(' + ca + ',' + (p.a * 0.5).toFixed(3) + ')');
        rg.addColorStop(1, 'rgba(' + ca + ',0)');
        g.fillStyle = rg;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.fill();
      }
      this._fogLayerC = o.c; this._fogLayerKey = key;
      return o.c;
    },
    _renderFog: function (x) {
      if (this._overlayOpen()) return;
      if (this._fogOn === false) return;            /* 帧率不足时自动降级（见 _autoQuality） */
      var sc = this.scene;
      var md = sc && sc.map && sc.map.md;
      if (md && (md.indoor || md.ground === 'cave' || md.ground === 'bloodcave')) return;
      var layer = this._fogLayer();
      if (!layer) return;
      var lw = layer.width, lh = layer.height;
      /* 缓慢平移（整数、取模 → 无缝绕回）。
         ⚠️ **只画可见的那一小块**（v0.99.0 实测教训）：
            初版 `drawImage(layer, ox, oy)` 直接画整层（1840×352），
            而其中大部分在画布之外 —— 浏览器**不会**自动裁掉画布外的部分，
            S=4 下等于每帧白白光栅化 2100 万像素，ling1 帧率从 311 掉到 111。
            正解：**用 9 参数版 drawImage 显式取源矩形**，
            只把"恰好落在视口里的那一块"搬过来。 */
      var ox = (Math.round(this.time * 7)) % lw;
      var oy = (Math.round(this.time * 3)) % Math.max(1, lh - this.H);
      x.save();
      x.globalCompositeOperation = 'source-over';
      /* 视口 (0,0,W,H) 对应层内 (ox, oy) 起的区域。
         `ox + W` 可能超出层宽 → 先画右边余量、再绕回画左边。 */
      var needW = Math.min(this.W, lw - ox);
      if (needW > 0) {
        x.drawImage(layer, ox, oy, needW, Math.min(this.H, lh - oy), 0, 0, needW, Math.min(this.H, lh - oy));
      }
      var restW = this.W - needW;
      if (restW > 0) {
        x.drawImage(layer, 0, oy, restW, Math.min(this.H, lh - oy), needW, 0, restW, Math.min(this.H, lh - oy));
      }
      x.restore();
    },
    _fogFor: function (sceneName) {
      if (this._fogKey === sceneName) return this._fogCfg;
      /* 场景 → 雾的配色与浓度。**固定表**，不随机。
         夜/昼由 `_renderDayTint` 负责，这里只管"这一带该有多少水汽"。 */
      var CFG = {
        town: { col: '214,224,238', n: 5, r: [90, 150], a: [0.05, 0.09] },
        yunzhou: { col: '220,226,240', n: 5, r: [90, 150], a: [0.05, 0.09] },
        field: { col: '206,220,232', n: 7, r: [100, 170], a: [0.05, 0.10] },
        cave: { col: '180,190,205', n: 0, r: [80, 120], a: [0.04, 0.07] },
        bloodhall: { col: '198,158,168', n: 0, r: [80, 120], a: [0.04, 0.07] },
        ling1: { col: '168,208,226', n: 9, r: [110, 190], a: [0.06, 0.12] },
        xian1: { col: '236,232,250', n: 8, r: [110, 190], a: [0.06, 0.11] },
        dao1: { col: '196,176,228', n: 8, r: [110, 190], a: [0.06, 0.12] },
        _wild: { col: '200,214,228', n: 6, r: [100, 165], a: [0.05, 0.10] }
      };
      var T = CFG[sceneName] || CFG._wild;
      var rnd = G.Art.rnd('fog|' + sceneName);
      var ps = [];
      for (var i = 0; i < T.n; i++) {
        ps.push({
          /* ⚠️ 铺满**整张雾层**（W+160 × H+80），不是只铺视口 ——
             层要左右绕回平铺，只铺视口会在绕回时露出空白带。 */
          x: rnd() * (this.W + 160),
          y: rnd() * (this.H + 80),
          r: T.r[0] + rnd() * (T.r[1] - T.r[0]),
          a: T.a[0] + rnd() * (T.a[1] - T.a[0]),
          fr: 0.06 + rnd() * 0.12,
          ph: rnd() * 6.28,
          amp: 4 + rnd() * 10
        });
      }
      this._fogKey = sceneName;
      this._fogCfg = { col: T.col, ps: ps };
      return this._fogCfg;
    },

    /* 濒死警告（v0.18.0）：气血低于 25% 时**全屏泛红 + 呼吸**。
       用户口径："主角濒死时，全屏显红警告玩家"。
       画在 game.js 的最外层（场景之后、toast 之前）—— 放场景里的话，
       战斗 / 探索 / 对话三套渲染各要写一遍，必然漏一处。
       ⚠️ 血量上限走 `computeStats`，每帧算一次太贵 → 按"影响上限的三个量"缓存
       （境界 / 功法本数 / 仙躯灌注）。 */
    _renderDanger: function (x) {
      var s = this.save;
      if (!s || !(s.hp > 0)) return;
      var mh = this._hpMaxCache(s);
      if (!mh) return;
      var pct = s.hp / mh;
      if (pct > 0.25) return;
      var k = 1 - pct / 0.25;                       /* 越接近 0 越红 */
      var pulse = 0.55 + 0.45 * Math.sin(this.time * 5.5);
      var a = (0.10 + 0.26 * k) * pulse;
      var g = x.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.20,
        this.W / 2, this.H / 2, this.H * 0.80);
      g.addColorStop(0, 'rgba(180,20,20,0)');
      g.addColorStop(1, 'rgba(196,18,18,' + a.toFixed(3) + ')');
      x.fillStyle = g;
      x.fillRect(0, 0, this.W, this.H);
      /* 真·濒死（≤15%）才出字 —— 平时只泛红，别一直吵玩家 */
      if (pct <= 0.15) {
        x.globalAlpha = 0.62 + 0.38 * pulse;
        G.UI.textOut(x, { x: this.W / 2, y: 54 }, '气 血 垂 危', 15, '#ff6a58',
          'center', 'rgba(24,0,0,0.9)', 3);
        x.globalAlpha = 1;
      }
    },

    _hpMaxCache: function (s) {
      var meta = this.meta || {};
      var k = (s.globalLevel || 1) + '|' + Object.keys(s.skills || {}).length + '|'
        + ((meta.perfusion && meta.perfusion.body) || 0);
      if (this._hpKey !== k) {
        this._hpKey = k;
        try { this._hpMax = G.Player.computeStats(s, meta).maxhp; }
        catch (e) { this._hpMax = 0; }
      }
      return this._hpMax;
    },

    /* 覆盖层打开时浮层的"让位线"= **底部动作排之上**。
       实测各面板"最低那排内容按钮"上沿：功法 178（参悟/激发/精进）、
       剧情 175、洞府 170、炼丹·锻造·阵法·传承 212、兽栏·打坐 214~216。
       取 166 → 盖住所有 ≥170 的底部动作排，且留 4px 余量。
       ⚠️ 面板内部的**列表行**（剧情/洞府/妖囊那种每 15px 一行）盖不住 ——
          面板体布满可点控件，屏幕内不存在"全空带"。这里只保证
          **不再压住底部动作排**（G32 报的就是这一处）；列表行被浮层
          临时压住是可接受的（浮层 2 秒即散，且列表可滚动）。
       52 是上界：再往上会顶进面板子页签（11..31）。 */
    FLOAT_CLEAR_Y: 166,
    FLOAT_TOP_MIN: 52,

    /* 当前是否有覆盖层打开（面板 / 战斗下拉 / 剧情模态）。
       **唯一判定口** —— 浮层让位、环境粒子跳过等多处共用，禁止各写一份。
       三个来源：
         · 探索/城镇/副本：scene.overlay 是面板 id（panels.js 里 openPanel 设的）
         · 战斗：没有 overlay 字段，用 phase（skill/item/target 才是覆盖层；
           command 是指令区本身、exec/result 是演出，都不算）
         · 剧情：G.Story.modalOpen()（忆起/图鉴浮层，任何场景都可能弹） */
    _overlayOpen: function () {
      if (G.Story && G.Story.modalOpen && G.Story.modalOpen()) return true;
      var sc = this.scene;
      if (!sc) return false;
      if (sc.overlay) return true;
      var ph = sc.phase;
      return ph === 'skill' || ph === 'item' || ph === 'target';
    },

    _renderLoot: function (x) {
      if (!this.lootFeed.length) return;
      /* 位置：**HUD 下方、靠右**。
         试过左下沿 —— 战斗里那里正是指令按钮（攻击/防御），文字直接压在按钮上，
         而用户口径明确要求"不能遮挡地图"（更别说遮挡按钮）。
         右上角在战斗与探索两种场景里都是空的：战斗的顶栏数值只占 y<22、
         敌人在 y≈150 以下；探索的 HUD 同样只占顶部 48px。 */
      /* 起点 54 = HUD（48）之下 —— 探索场景里浮层画在场景之后，
         起点压进 HUD 会把它盖住。战斗顶栏只有 30 高，54 也仍在单位之上。 */
      var base = 54;
      /* G32（v0.74.0）：战利品**锚在顶部**（54、每行 +15、上限 5 行 → 底 ≈143），
         结构上够不到按钮带（208），所以常态**一个像素都不动**。
         这里只加一道**下沿守卫**：若某天放宽行数上限、或改大行高，
         整块会被抬到让位线之上，而不会静默压进按钮带。 */
      var lh = 15, need = base + this.lootFeed.length * lh;
      if (need > this.FLOAT_CLEAR_Y) {
        base = Math.max(this.FLOAT_TOP_MIN,
          this.FLOAT_CLEAR_Y - this.lootFeed.length * lh);
      }
      x.save();
      for (var i = 0; i < this.lootFeed.length; i++) {
        var it = this.lootFeed[i];
        var a = Math.min(1, it.t / 0.45);            /* 最后 0.45s 淡出 */
        var y = base + i * 15;
        x.globalAlpha = a;
        if (it.special) {
          /* 特殊物品：金色 + 呼吸辉光（**不画框**，只用发光文字） */
          var pulse = 0.55 + 0.45 * Math.sin(this.time * 6 + i);
          x.shadowColor = 'rgba(255,214,120,' + (0.8 * pulse).toFixed(3) + ')';
          x.shadowBlur = 9;
          G.UI.textOut(x, { x: 468, y: y }, it.text, 11, '#ffe6a8', 'right',
            'rgba(6,8,14,0.88)', 2.4);
          x.shadowBlur = 0;
        } else {
          G.UI.textOut(x, { x: 468, y: y }, it.text, 11, 'rgba(228,234,246,0.96)',
            'right', 'rgba(6,8,14,0.88)', 2.4);
        }
      }
      x.globalAlpha = 1;
      x.restore();
    },

    _renderToasts: function (x) {
      if (!this.toasts.length) return;
      var pad = 9, lineH = 20;
      /* ⚠️ v0.98.0：toast 框宽**不能再写死 240**。
         原先 `w = 240` 定宽 + `textOut`（单行居中、不折行）——
         长文案（「沈伯赠你幼年青纹蛇，药渣 ×5，木囊 ×2」约 20 字 ≈ 260px）
         会**横着溢出框外**，截图里"木囊 ×2"就挂在框外面（用户口径
         "对话框……UI 设计"打磨时抓到，一眼可见）。
         现在：① 框宽按**最长那条**的实际文字宽度自适应（夹在 200 ~ W-24）；
              ② 超出时按框宽**折行**，总高随折行数变。 */
      var maxW = this.W - 24, minW = 200;
      x.font = G.UI.F(13);
      /* 用"最宽那条"定框（夹在 minW ~ maxW），再让每条按此宽折行 */
      var needW = minW;
      for (var k = 0; k < this.toasts.length; k++) {
        var one = G.UI.wrap(x, this.toasts[k].text, 13, maxW - 24);
        for (var q = 0; q < one.length; q++) {
          needW = Math.max(needW, x.measureText(one[q]).width + 24);
        }
      }
      var w = Math.max(minW, Math.min(maxW, needW));
      /* 预折行 + 算总高 */
      var rowsPer = [], blocksTotal = 0;
      for (var m = 0; m < this.toasts.length; m++) {
        var blk = G.UI.wrap(x, this.toasts[m].text, 13, w - 24);
        rowsPer.push(blk);
        blocksTotal += blk.length;
      }
      var h = blocksTotal * lineH + pad;
      /* 底部要让开探索场景的功能栏（28px），否则提示被压在底栏底下看不见 */
      var bot = (G.Explore && G.Explore.BOT_H) || 0;
      var y0 = this.H - h - 14 - bot;
      /* G32（v0.74.0）：覆盖层打开时整体上移到"安全带" —— 否则正好压住
         面板那排「参悟/精进/激发」（实测重叠 18px），点了看不见反馈。
         上移量固定，不随 toast 条数变；未打开覆盖层时 y0 与历史完全一致。 */
      if (this._overlayOpen()) {
        var wantY = this.FLOAT_CLEAR_Y - h;     /* 末行贴住让位线 */
        y0 = Math.max(this.FLOAT_TOP_MIN, Math.min(y0, wantY));
      }
      G.UI.panel(x, { x: this.W / 2 - w / 2, y: y0, w: w, h: h },
        '#161b28', 'rgba(216,183,104,0.65)', 5);
      var ty = y0 + pad / 2 + 4;
      for (var n = 0; n < rowsPer.length; n++) {
        for (var r2 = 0; r2 < rowsPer[n].length; r2++) {
          G.UI.textOut(x, { x: this.W / 2, y: ty }, rowsPer[n][r2], 13, G.UI.C.text, 'center');
          ty += lineH;
        }
      }
    },

    /* ===== 打击感方法（v0.76.0 阶段一）===== */

    /* 镜头震动：intensity 强度0-1，duration 持续时间ms */
    cameraShake: function (intensity, duration) {
      this._shakeIntensity = Math.max(0, Math.min(1, intensity || 0.5));
      this._shakeDuration = duration || 200;
      this._shakeTime = 0;
    },

    /* 顿帧暂停：ms 毫秒 */
    pauseGame: function (ms) {
      this._pauseUntil = performance.now() + (ms || 50);
    },

    /* 突破特效：realmName 境界名, oldStats 旧属性, newStats 新属性 */
    playBreakthroughEffect: function (realmName, oldStats, newStats) {
      this._breakthroughEffect = {
        realm: realmName,
        old: oldStats || {},
        new: newStats || {},
        t: 0,
        duration: 3.0,  // 持续3秒
        particles: []   // 粒子数组
      };

      // 生成金光粒子（50个）
      for (var i = 0; i < 50; i++) {
        var angle = Math.random() * Math.PI * 2;
        var speed = 20 + Math.random() * 80;
        this._breakthroughEffect.particles.push({
          x: this.W / 2,
          y: this.H / 2,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.8 + Math.random() * 0.4,
          size: 1.5 + Math.random() * 2
        });
      }

      // 触发震动
      this.cameraShake(0.6, 400);
    },

    /* 渲染突破特效 */
    _renderBreakthroughEffect: function (x) {
      var fx = this._breakthroughEffect;
      if (!fx) return;

      var t = fx.t;
      var dur = fx.duration;

      // 淡入淡出alpha
      var alpha = Math.min(1, t * 3) * Math.min(1, (dur - t) / 0.8);

      x.save();
      x.globalAlpha = alpha;

      // 全屏金色渐变
      var grad = x.createRadialGradient(this.W / 2, this.H / 2, 0,
        this.W / 2, this.H / 2, this.W * 0.8);
      grad.addColorStop(0, 'rgba(255,240,180,' + (0.4 * alpha).toFixed(3) + ')');
      grad.addColorStop(0.5, 'rgba(255,220,140,' + (0.2 * alpha).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,200,100,0)');
      x.fillStyle = grad;
      x.fillRect(0, 0, this.W, this.H);

      // 绘制粒子
      x.globalCompositeOperation = 'lighter';
      for (var i = 0; i < fx.particles.length; i++) {
        var p = fx.particles[i];
        var pAlpha = Math.min(1, p.life - t / dur) * alpha;
        if (pAlpha <= 0) continue;

        x.fillStyle = 'rgba(255,235,160,' + pAlpha.toFixed(3) + ')';
        x.beginPath();
        x.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        x.fill();
      }

      x.globalCompositeOperation = 'source-over';

      // 中央文字：突破XXX境！
      if (t < 2.5) {
        var textAlpha = Math.min(1, t * 2) * Math.min(1, (2.5 - t) / 0.5) * alpha;
        x.globalAlpha = textAlpha;
        var text = '突破 ' + fx.realm + ' 境！';
        G.UI.textOut(x, { x: this.W / 2, y: this.H / 2 - 20 }, text,
          22, '#ffe8a0', 'center', 'rgba(40,20,0,0.9)', 4);
      }

      x.restore();
    }
  };

  G.game = Game;
  G.scenes = {};
})();
