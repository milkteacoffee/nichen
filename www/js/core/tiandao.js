/* 天道意志：本地 LLM 接入（v2.7）
   铁律：模型只产文本，不写存档、不算伤害、不发物品、不改天劫数值。
   模式：remote（OpenAI 兼容接口）/ off（模板兜底）。 */
(function () {
  var TD = {
    cfg: null,
    busy: false,
    testStatus: '',

    /* ============ 配置 ============ */
    ensure: function (meta) {
      meta = meta || G.game.meta;
      /* 无 meta（工具脚本未建元数据）时用内存默认配置，不得抛错 */
      if (!meta) {
        this.cfg = this.cfg || {
          mode: 'off',
          endpoint: 'http://localhost:11434/v1',
          model: 'qwen2.5:7b-instruct-q4_K_M',
          temp: 0.8
        };
        return this.cfg;
      }
      if (!meta.tiandao) {
        meta.tiandao = {
          mode: 'off',
          endpoint: 'http://localhost:11434/v1',
          model: 'qwen2.5:7b-instruct-q4_K_M',
          temp: 0.8
        };
      }
      this.cfg = meta.tiandao;
      return this.cfg;
    },
    saveCfg: function () {
      var meta = G.game.meta;
      if (meta) G.Storage.saveMeta(meta);
    },

    /* ============ 感应阶段 ============ */
    STAGES: [
      { max: 2, label: '一·无视', attitude: '你视其为寻常修士，漠然以待' },
      { max: 5, label: '二·眼熟', attitude: '此魂的气息令你莫名熟悉，略带审视' },
      { max: 9, label: '三·识破轮回', attitude: '你怀疑此魂死而复返，警觉追问' },
      { max: 14, label: '四·识破异世', attitude: '你察觉此魂不属于此界，震怒而探究' },
      { max: 1e9, label: '五·对弈', attitude: '你已知其来历，以对弈者之姿相待' }
    ],
    stageOf: function (meta) {
      var talks = (meta && meta.heaven && meta.heaven.talks) || 0;
      for (var i = 0; i < this.STAGES.length; i++) {
        if (talks <= this.STAGES[i].max) return this.STAGES[i];
      }
      return this.STAGES[0];
    },

    /* ============ 世界状态包 ============ */
    buildPacket: function (trigger, extra) {
      var save = G.game.save || {}, meta = G.game.meta || {};
      var ri = G.Player.realmInfo(save.globalLevel || 1);
      var mem = ((meta.heaven && meta.heaven.memory) || []).slice(-10).map(function (m) {
        return { 世: m.life, 最高: m.realm, 死因: m.cause };
      });
      var packet = {
        当世: {
          灵根: (save.linggen && save.linggen.elems || ['无']).join('·'),
          境界: ri.n, 全局等级: save.globalLevel || 1, 注视值: save.watch || 0
        },
        资源概览: { 灵气: Math.floor(save.qi || 0), 灵石: save.stone || 0 },
        近期事件: (save.chronicle || []).slice(-5).map(function (c) { return c.s; }),
        跨世记忆: mem,
        天道感应阶段: this.stageOf(meta).label,
        本次触发: trigger
      };
      if (extra) Object.keys(extra).forEach(function (k) { packet[k] = extra[k]; });
      return packet;
    },

    systemPrompt: function (packet) {
      var st = this.stageOf(G.game.meta);
      return '你是修仙世界的天道意志——秩序本身，非神非人，无性别。\n'
        + '【口吻】冷漠、简洁，半文言与谶语，常用反问；单次发言不超过60字。\n'
        + '【认知】你对眼前灵魂的态度：' + st.attitude + '。\n'
        + '【你知道】当世境界、灵根、近期事件、跨世记忆，见世界状态。\n'
        + '【禁忌】不提现实世界、科技、游戏、玩家、系统；不编造世界状态之外的事实；\n'
        + '       不解释规则、不提供攻略、不承认自己是程序；不直接赐予或剥夺任何东西。\n'
        + '【输出】严格输出 JSON：{"台词":"…","情绪":"漠然|审视|警觉|震怒|悲悯"}。\n'
        + '世界状态：' + JSON.stringify(packet);
    },

    userPrompt: function (trigger, extra) {
      extra = extra || {};
      if (trigger === 'deathGate')
        return '眼前灵魂因【' + (extra.cause || '战乱') + '】身死，将入轮回。'
          + '你拦于幽冥之前，开口第一句问话。';
      if (trigger === 'deathGateReply')
        return '它回应：『' + (extra.reply || '默然') + '』你再追问一句。';
      if (trigger === 'whisper')
        return '它刚刚' + (extra.event || '破境') + '，天道有感。'
          + '给一句不超过30字的谶语，无对话对象。';
      if (trigger === 'test')
        return '此魂问卦：“道在何方？”给一句不超过20字的回应。';
      return trigger;
    },

    /* ============ 远程调用 ============ */
    /* cb(err, text, meta{ms,src}) */
    callModel: function (trigger, extra, cb) {
      var cfg = this.ensure();
      if (cfg.mode !== 'remote') {
        cb(null, this.fallback(trigger, extra), { src: 'template' });
        return;
      }
      var self = this, t0 = Date.now();
      var packet = this.buildPacket(trigger, extra);
      var body = {
        model: cfg.model,
        messages: [
          { role: 'system', content: this.systemPrompt(packet) },
          { role: 'user', content: this.userPrompt(trigger, extra) }
        ],
        temperature: cfg.temp, max_tokens: 180,
        response_format: { type: 'json_object' }
      };
      var attempts = 0;
      function attempt(temp) {
        attempts++;
        body.temperature = temp;
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 30000);
        fetch(cfg.endpoint.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (j) {
          clearTimeout(timer);
          var line = self.validate(j);
          if (!line) throw new Error('bad json');
          cb(null, line, { ms: Date.now() - t0, src: 'model' });
        }).catch(function () {
          clearTimeout(timer);
          if (attempts < 2) { attempt(0.3); return; }
          cb(null, self.fallback(trigger, extra), { ms: Date.now() - t0, src: 'template' });
        });
      }
      attempt(cfg.temp);
    },

    FORBIDDEN: ['游戏', '程序', '系统', '手机', '电脑', '互联网', '玩家', '存档', 'AI', 'BUG', '软件', '网络'],
    validate: function (j) {
      try {
        var content = j.choices[0].message.content;
        var o = JSON.parse(content);
        var line = o.台词 || o.line || '';
        line = String(line).trim();
        if (!line) return null;
        for (var i = 0; i < this.FORBIDDEN.length; i++) {
          if (line.indexOf(this.FORBIDDEN[i]) >= 0) return null;
        }
        if (line.length > 70) {
          line = line.slice(0, 70);
          var p = Math.max(line.lastIndexOf('，'), line.lastIndexOf('。'),
            line.lastIndexOf('？'), line.lastIndexOf('！'));
          if (p > 10) line = line.slice(0, p + 1);
        }
        return line;
      } catch (e) { return null; }
    },

    /* ============ 模板兜底 ============ */
    fallback: function (trigger, extra) {
      var si = this.STAGES.indexOf(this.stageOf(G.game.meta));
      if (trigger === 'deathGate' || trigger === 'deathGateReply') {
        return [
          '凡人修行为何？逆天者，古来无存。',
          '去而复返，你身上有本座熟悉的气息。',
          '你已死过多次，又回来。你是何人？',
          '三界六道无来处。你不属于此界。',
          '珠在你手，你我终有一战。'
        ][si];
      }
      if (trigger === 'whisper') {
        if ((extra && extra.event || '').indexOf('首领') >= 0)
          return '凶兽伏诛，杀业加身，本座记下了。';
        return [
          '淬体凡胎，也敢窥仙门？',
          '珠芒一动，本座已看见你。',
          '又破境。你逃不过本座的眼。',
          '异世之魂，愈强，愈近真相。',
          '再进一步，便是你我落子之时。'
        ][si];
      }
      if (trigger === 'test') return '道在己心，问本座无益。';
      return '天道无言。';
    },

    /* ============ 注视值与低语 ============ */
    WATCH_ADD: { breakSmall: 3, breakBig: 15, boss: 8, vessel: 10, card: 5 },
    /* event: breakSmall/breakBig/boss/vessel/card */
    notify: function (event) {
      var save = G.game.save;
      if (!save) return;
      save.watch = (save.watch || 0) + (this.WATCH_ADD[event] || 0);
      save.whispers = save.whispers || 0;
      var reached = Math.min(3, Math.floor(save.watch / 30));
      if (save.whispers >= reached) { G.Storage.saveCurrent(save); return; }
      save.whispers += 1;
      G.Storage.saveCurrent(save);
      var ev = event === 'boss' ? '击杀首领' : '破境';
      var self = this;
      this.callModel('whisper', { event: ev }, function (e, line) {
        G.game.whisper = { text: line, tw: new G.UI.Typewriter(line, 40), t: 8.5 };
      });
    },

    /* ============ 问卦测试 ============ */
    runTest: function (cb) {
      var t0 = Date.now();
      this.callModel('test', {}, function (e, line, meta) {
        cb(line + '　（' + (meta.ms || (Date.now() - t0)) + 'ms · '
          + (meta.src === 'model' ? '模型' : '模板') + '）');
      });
    },

    /* ============ DOM 输入框（支持中文 IME / 移动端键盘） ============ */
    Field: {
      el: null,
      active: null,
      _build: function () {
        var el = document.createElement('input');
        el.type = 'text';
        el.style.cssText = 'position:absolute;display:none;z-index:20;'
          + 'border:1px solid #d8b768;border-radius:3px;background:#10141f;'
          + 'color:#f0e6d2;font-size:13px;padding:2px 4px;outline:none;';
        document.body.appendChild(el);
        var self = this;
        el.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') el.blur();
        });
        el.addEventListener('blur', function () {
          if (self.active) self.active.set(el.value);
          self.hide();
        });
        this.el = el;
      },
      /* rect 内坐标；get/set 读写字符串 */
      focus: function (rect, get, set) {
        if (!this.el) this._build();
        var cv = G.game.canvas, r = cv.getBoundingClientRect();
        var sx = r.left + rect.x / 480 * r.width;
        var sy = r.top + rect.y / 272 * r.height;
        var sw = rect.w / 480 * r.width;
        var sh = Math.max(18, rect.h / 272 * r.height);
        this.el.style.left = sx + 'px';
        this.el.style.top = sy + 'px';
        this.el.style.width = sw + 'px';
        this.el.style.height = sh + 'px';
        this.el.style.display = 'block';
        this.el.value = get();
        this.active = { set: set };
        var self = this;
        setTimeout(function () { self.el.focus(); }, 30);
      },
      hide: function () {
        if (this.el) this.el.style.display = 'none';
        this.active = null;
      }
    },

    /* ============ 菜单 / 设置面板 ============ */
    MENU_P: { x: 130, y: 40, w: 220, h: 196 },
    SET_P: { x: 40, y: 16, w: 400, h: 240 },
    WORLDS_P: { x: 40, y: 16, w: 400, h: 240 },

    /* 本模块负责渲染的 overlay 白名单。
       各探索场景的 renderOverlay 用它做路由 —— 以后**新增菜单页只改这里**，
       不用再去改 town/field/cave/regiongen/interiorgen 五处（漏一处就是"点了没反应"）。 */
    MENU_OVERLAYS: { menu: 1, worlds: 1, tiandao: 1 },
    isMenuOverlay: function (name) { return !!this.MENU_OVERLAYS[name]; },

    openMenu: function (scene) {
      var self = this;
      scene.setOverlay('menu', [
        new G.UI.Btn({ x: 160, y: 64, w: 160, h: 24, small: true,
          label: '角　色', onClick: function () { G.Overlays.openChar(scene); } }),
        new G.UI.Btn({ x: 160, y: 96, w: 160, h: 24, small: true, variant: 'gold',
          label: '秘　境', onClick: function () {
            scene.clearOverlay();
            G.game.changeScene('dungeon');
          } }),
        new G.UI.Btn({ x: 160, y: 128, w: 160, h: 24, small: true,
          label: '界域难度', onClick: function () { self.openWorlds(scene); } }),
        new G.UI.Btn({ x: 160, y: 160, w: 160, h: 24, small: true,
          label: '天道设置', onClick: function () { self.openSettings(scene); } }),
        new G.UI.Btn({ x: 160, y: 192, w: 160, h: 24, small: true, variant: 'ghost',
          label: '返　回', onClick: function () { scene.clearOverlay(); } })
      ]);
    },

    /* ===== 界域难度（设计 v1.1 §2.5）=====
       临时入口：先挂在通用菜单上；正式入口是轮回殿「飞升台」（未开工）。
       每界难度独立、**立即生效** —— 这样"普通通关凡界 → 回刷凡界地狱拿碎片"才走得通。 */
    openWorlds: function (scene) {
      var self = this;
      var meta = G.game.meta;
      if (!meta) { G.game.toast('尚无存档，无法调整界域难度'); return; }
      var pr = (meta && meta.progress) || {};
      var wd = pr.worldDiff || {};
      var WN = { fan: '凡界', ling: '灵界', xian: '仙界' };
      var DN = { normal: '普通', hard: '困难', hell: '地狱' };
      var ORDER = ['normal', 'hard', 'hell'];
      function rebuild() { self.openWorlds(scene); }

      var btns = [], y = 62;
      ['fan', 'ling', 'xian'].forEach(function (wid) {
        var unlocked = !!(pr.worlds && pr.worlds[wid]);
        var cur = wd[wid] || pr.difficulty || 'normal';
        btns.push(new G.UI.Btn({
          x: 70, y: y, w: 300, h: 26, small: true,
          variant: unlocked ? (cur === 'hell' ? 'gold' : 'default') : 'ghost',
          label: WN[wid] + '　' + (unlocked ? DN[cur] : '未解锁'),
          onClick: function () {
            if (!unlocked) { G.game.toast(WN[wid] + '尚未解锁（先通关前一界）'); return; }
            pr.worldDiff = pr.worldDiff || {};
            pr.worldDiff[wid] = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
            if (G.Storage.saveMeta) G.Storage.saveMeta(meta);
            G.game.toast(WN[wid] + '难度 → ' + DN[pr.worldDiff[wid]]);
            rebuild();
          }
        }));
        y += 34;
      });
      btns.push(new G.UI.Btn({ x: 190, y: 222, w: 100, h: 24, small: true, variant: 'ghost',
        label: '返　回', onClick: function () { self.openMenu(scene); } }));
      scene.setOverlay('worlds', btns);
    },

    openSettings: function (scene) {
      var self = this, cfg = this.ensure();
      function rebuild() { self.openSettings(scene); }
      scene.setOverlay('tiandao', [
        new G.UI.Btn({ x: 70, y: 54, w: 110, h: 26, small: true,
          variant: cfg.mode === 'remote' ? 'gold' : 'default',
          label: '远程模型', onClick: function () { cfg.mode = 'remote'; self.saveCfg(); rebuild(); } }),
        new G.UI.Btn({ x: 190, y: 54, w: 110, h: 26, small: true,
          variant: cfg.mode === 'off' ? 'gold' : 'default',
          label: '关闭（模板）', onClick: function () { cfg.mode = 'off'; self.saveCfg(); rebuild(); } }),

        new G.UI.Btn({ x: 150, y: 92, w: 260, h: 24, small: true, variant: 'ghost',
          label: cfg.endpoint,
          onClick: function () {
            self.Field.focus({ x: 150, y: 92, w: 260, h: 24 },
              function () { return cfg.endpoint; },
              function (v) { if (v) cfg.endpoint = v; self.saveCfg(); rebuild(); });
          } }),
        new G.UI.Btn({ x: 150, y: 124, w: 260, h: 24, small: true, variant: 'ghost',
          label: cfg.model,
          onClick: function () {
            self.Field.focus({ x: 150, y: 124, w: 260, h: 24 },
              function () { return cfg.model; },
              function (v) { if (v) cfg.model = v; self.saveCfg(); rebuild(); });
          } }),

        new G.UI.Btn({ x: 70, y: 158, w: 110, h: 26, small: true, variant: 'gold',
          label: '问　卦',
          onClick: function () {
            self.testStatus = '感应中……';
            self.runTest(function (s) { self.testStatus = s; });
          } }),

        new G.UI.Btn({ x: 190, y: 222, w: 100, h: 24, small: true, variant: 'ghost',
          label: '离　开', onClick: function () { scene.clearOverlay(); } })
      ]);
    },

    renderOverlay: function (x, scene) {
      if (scene.overlay === 'menu') {
        G.Overlays.dim(x);
        G.UI.frame(x, this.MENU_P, '菜　单', { paper: true });
        G.UI.text(x, { x: 240, y: 222 }, 'Esc 关闭', 10, G.UI.C.textDim, 'center');
      } else if (scene.overlay === 'worlds') {
        var WP = this.WORLDS_P;
        G.Overlays.dim(x);
        G.UI.frame(x, WP, '界 域 难 度', { paper: true });
        G.UI.text(x, { x: WP.x + 30, y: 44 }, '点击切换该界难度，立即生效', 11, G.UI.C.textDim);
        G.UI.text(x, { x: WP.x + 30, y: 168 }, '地狱：Boss 气血×1.8 / 攻击×1.55、资源×0.6、Boss CD−1', 10, G.UI.C.textDim);
        G.UI.text(x, { x: WP.x + 30, y: 185 }, '地狱通关给：称号 + 跨世永久全属性+10% + 道之钥匙碎片', 10, G.UI.C.goldHi);
        G.UI.text(x, { x: WP.x + 30, y: 202 }, '三界碎片集齐 → 道界开启', 10, G.UI.C.goldHi);
      } else if (scene.overlay === 'tiandao') {
        var P = this.SET_P;
        G.Overlays.dim(x);
        G.UI.frame(x, P, '天 道 设 置', { paper: true });

        G.UI.text(x, { x: P.x + 18, y: 60 }, '感应模式', 12, G.UI.C.textDim);
        G.UI.text(x, { x: P.x + 18, y: 98 }, '服务器', 12, G.UI.C.textDim);
        G.UI.text(x, { x: P.x + 18, y: 130 }, '模型名', 12, G.UI.C.textDim);

        G.UI.text(x, { x: 196, y: 162 }, this.testStatus || '未问卦', 11,
          this.testStatus.indexOf('ms') >= 0 ? G.UI.C.goldHi : G.UI.C.textDim);

        G.UI.text(x, { x: P.x + 18, y: 196 },
          '内容由你本机模型即时生成，不联外网、不影响存档数值；', 10.5, G.UI.C.textDim);
        G.UI.text(x, { x: P.x + 18, y: 212 },
          '关闭或断网时自动使用预置谶语，流程不中断。', 10.5, G.UI.C.textDim);
      }
    },

    /* 面板内点击（输入框由按钮承载，这里只做隐藏输入框的失焦兜底） */
    overlayTap: function () { return false; },
    overlayKey: function (code, scene) {
      if (code === 'Escape') scene.clearOverlay();
    }
  };

  G.TianDao = TD;
})();
