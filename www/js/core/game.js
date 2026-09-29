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

      if (this.scene.update) this.scene.update(dt);

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
      x.setTransform(this.S, 0, 0, this.S, 0, 0);
      x.imageSmoothingEnabled = !!this.scene.smooth;
      x.fillStyle = '#0b0d14';
      x.fillRect(0, 0, this.W, this.H);
      if (this.scene.render) this.scene.render(x);
      /* 环境粒子：画在场景之上、悬停/面板之外（打开覆盖层时方法内部自行跳过） */
      this._renderAmbient(x);

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
      var pad = 9, lineH = 20, w = 240;
      var h = this.toasts.length * lineH + pad;
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
      for (var i = 0; i < this.toasts.length; i++) {
        G.UI.textOut(x, { x: this.W / 2, y: y0 + pad / 2 + i * lineH + 4 },
          this.toasts[i].text, 13, G.UI.C.text, 'center');
      }
    }
  };

  G.game = Game;
  G.scenes = {};
})();
