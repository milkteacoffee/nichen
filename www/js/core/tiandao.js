/* 天道意志：LLM 接入（v2.7 起本地 Ollama，v0.8.0 起支持云端多协议）
   铁律：模型只产文本，不写存档、不算伤害、不发物品、不改天劫数值。
   模式：remote（模型）/ off（预置谶语兜底）。
   协议：openai（OpenAI 兼容 /v1/chat/completions，本地 Ollama、vLLM、各家云都走它）
        claude（Anthropic /v1/messages）
        response（OpenAI 原生 /v1/responses，非 chat 形态） */
(function () {
  /* 默认配置：新档与旧档迁移共用一份，避免两处默认值漂 */
  function defaults() {
    return {
      mode: 'off',
      protocol: 'openai',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b-instruct-q4_K_M',
      apiKey: '',
      temp: 0.8,
      /* 单次请求超时（ms）。真机实测云端中转站首字延迟 4s~60s+ 波动很大，
         30s 会把本来能答的请求误判成超时。老存档由 _fill 自动补这个键。
         慢站玩家可以自己调大（改存档 meta.tiandao.timeout），目前不开 UI 入口。 */
      timeout: 45000,
      showFps: false
    };
  }
  var PROTO_LABEL = { openai: 'OpenAI', claude: 'Claude', response: '原生' };
  /* 切协议时把端点与模型名带到该协议的常用值 —— 但只在用户没自己改过时替换，
     所以这里只作为"占位提示"用，不自动改写用户填的内容。 */
  var PROTO_HINT = {
    openai: { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    claude: { endpoint: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-20241022' },
    response: { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
  };

  var TD = {
    cfg: null,
    busy: false,
    testStatus: '',
    testOk: false,
    chatLog: null,      /* 自由对话记录 [{r:'you'|'heaven', t}] */
    chatBusy: false,    /* 天道应答中 */

    /* ============ 配置 ============ */
    ensure: function (meta) {
      meta = meta || G.game.meta;
      /* 无 meta（工具脚本未建元数据）时用内存默认配置，不得抛错 */
      if (!meta) {
        if (!this.cfg) this.cfg = defaults();
        this._fill(this.cfg);
        return this.cfg;
      }
      if (!meta.tiandao) meta.tiandao = defaults();
      this.cfg = meta.tiandao;
      this._fill(this.cfg);
      return this.cfg;
    },
    /* 老档补字段：v0.7.0 以前的 cfg 只有 mode/endpoint/model/temp */
    _fill: function (c) {
      var d = defaults();
      Object.keys(d).forEach(function (k) { if (c[k] == null) c[k] = d[k]; });
      if (!PROTO_LABEL[c.protocol]) c.protocol = 'openai';
      return c;
    },
    saveCfg: function () {
      var meta = G.game.meta;
      if (meta) G.Storage.saveMeta(meta);
    },
    PROTO_LABEL: PROTO_LABEL,
    PROTO_HINT: PROTO_HINT,
    /* 默认配置暴露出来：测试要断言"老存档能被补全"，将来加「恢复默认」按钮也用得上。 */
    defaults: defaults,

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
          境界: ri.n, 境界gl: save.globalLevel || 1, 注视值: save.watch || 0
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

    /* 自由对话（'chat'）的系统提示：比脚本触发更开放，允许天道有意志、会回怼。 */
    chatSystemPrompt: function (packet) {
      var st = this.stageOf(G.game.meta);
      return '你是修仙世界的天道意志——秩序本身，非神非人，无性别，却有自己的意志与脾气。\n'
        + '【口吻】半文言，简洁有威压，常用反问与谶语；可冷峻、讥诮、动怒，偶露悲悯；单次不超过70字。\n'
        + '【态度】' + st.attitude + '。你不讨好它；它若逆天、口出“我命由我不由天”，'
        + '你便回怼、敲打，甚至以天劫相胁。\n'
        + '【你知道】当世境界、灵根、近期事件、跨世记忆，见世界状态；不得编造状态之外的事实。\n'
        + '【禁忌】不提现实/科技/游戏/玩家/系统/程序；不解释规则、不给攻略；不直接赐物或改数。\n'
        + '【输出】严格输出 JSON：{"台词":"…","情绪":"漠然|审视|警觉|震怒|悲悯|讥诮"}。\n'
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
      if (trigger === 'chat')
        return '此魂主动与你攀话，说：“' + (extra.text || '天道何在') + '”\n'
          + '据你的态度与世界状态回应；它若言语忤逆、口出“我命由我不由天”之类，'
          + '便冷斥、敲打或回怼，莫要顺着它。';
      return trigger;
    },

    /* ============ 远程调用 ============
       三种协议的差别只在"打哪个路径 / 怎么带鉴权 / 请求体长什么样 / 从哪取文本"，
       其余（超时、重试、兜底、过滤）完全共用。 */

    /* 端点拼接：用户既可能填 `https://host/v1`，也可能**直接粘控制台给的完整 URL**
       （很多中转站/控制台给的就是 `.../v1/chat/completions`）。两种都要能用。
       ⚠️ 光判"已带后缀就不重复拼"不够 —— 真机实测踩到：填完整路径 `…/v1/chat/completions`
       之后把协议切成 Claude，会拼成 `…/v1/chat/completions/messages`（必现 404）。
       所以先把末尾**任意一个**已知协议后缀剥掉，再拼目标路径。 */
    PROTO_SUFFIX: ['/chat/completions', '/messages', '/responses'],
    joinUrl: function (base, path) {
      base = String(base || '').replace(/\/+$/, '');
      var KN = this.PROTO_SUFFIX;
      for (var i = 0; i < KN.length; i++) {
        var k = KN[i];
        if (base.length > k.length && base.slice(-k.length) === k) {
          base = base.slice(0, -k.length).replace(/\/+$/, '');
          break;
        }
      }
      if (base.slice(-path.length) === path) return base;
      return base + path;
    },

    /* 请求规格：{ url, headers, body } */
    buildRequest: function (cfg, sys, usr) {
      var p = cfg.protocol, key = cfg.apiKey || '';
      if (p === 'claude') {
        var h = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
        if (key) h['x-api-key'] = key;
        /* Claude 的 system 是顶层字段，不是 messages 里的一条 */
        return {
          url: this.joinUrl(cfg.endpoint, '/messages'),
          headers: h,
          body: {
            model: cfg.model, max_tokens: 400, temperature: cfg.temp,
            system: sys, messages: [{ role: 'user', content: usr }]
          }
        };
      }
      if (p === 'response') {
        var h2 = { 'Content-Type': 'application/json' };
        if (key) h2['Authorization'] = 'Bearer ' + key;
        /* 原生 Responses API：instructions = 系统提示，input = 用户输入 */
        return {
          url: this.joinUrl(cfg.endpoint, '/responses'),
          headers: h2,
          body: {
            model: cfg.model, instructions: sys, input: usr,
            max_output_tokens: 400, temperature: cfg.temp
          }
        };
      }
      /* openai（默认）：本地 Ollama / vLLM / 绝大多数云端兼容层都走这个形状。
         刻意**不带 response_format** —— 不少第三方实现不支持，带上会直接 400；
         JSON 的可靠性改由提示词 + 容错解析保证（见 pickJson）。 */
      var h3 = { 'Content-Type': 'application/json' };
      if (key) h3['Authorization'] = 'Bearer ' + key;
      return {
        url: this.joinUrl(cfg.endpoint, '/chat/completions'),
        headers: h3,
        body: {
          model: cfg.model, temperature: cfg.temp, max_tokens: 400,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }]
        }
      };
    },

    /* 从三家不同的响应体里取文本 */
    extractText: function (j, proto) {
      if (!j) return null;
      if (proto === 'claude') {
        if (j.content && j.content.length) {
          for (var i = 0; i < j.content.length; i++) {
            if (j.content[i] && j.content[i].text) return j.content[i].text;
          }
        }
        return null;
      }
      if (proto === 'response') {
        if (typeof j.output_text === 'string' && j.output_text) return j.output_text;
        if (j.output && j.output.length) {
          for (var k = 0; k < j.output.length; k++) {
            var it = j.output[k];
            if (it && it.content && it.content.length) {
              for (var m = 0; m < it.content.length; m++) {
                if (it.content[m] && it.content[m].text) return it.content[m].text;
              }
            }
          }
        }
        return null;
      }
      return (j.choices && j.choices[0] && j.choices[0].message
        && j.choices[0].message.content) || null;
    },

    /* 容错取 JSON：模型经常裹 ```json 围栏、或在前后加一句解释 */
    pickJson: function (text) {
      if (!text) return null;
      var s = String(text).trim();
      s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
      var a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a >= 0 && b > a) s = s.slice(a, b + 1);
      try { return JSON.parse(s); } catch (e) { return null; }
    },

    /* cb(err, text, meta{ms,src,err}) */
    callModel: function (trigger, extra, cb) {
      var cfg = this.ensure();
      if (cfg.mode !== 'remote') {
        cb(null, this.fallback(trigger, extra), { src: 'template' });
        return;
      }
      var self = this, t0 = Date.now();
      var packet = this.buildPacket(trigger, extra);
      var sys = trigger === 'chat' ? this.chatSystemPrompt(packet) : this.systemPrompt(packet),
        usr = this.userPrompt(trigger, extra);
      var lastErr = '';
      var attempts = 0;
      /* 超时：真机实测云端中转站的**首字延迟波动很大**（同一模型 3.8s / 5.0s / 6.5s / 8.5s，
         也见过 60s+ 不返回）。原先写死 30s 太紧 —— 本来能答的请求会被判"请求超时"、
         白白退到预置谶语。45s 兼顾"慢站能答"与"玩家不用干等太久"。 */
      var TIMEOUT = cfg.timeout || 45000;
      function attempt(temp) {
        attempts++;
        cfg.temp = temp;
        var req = self.buildRequest(cfg, sys, usr);
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
        fetch(req.url, {
          method: 'POST', headers: req.headers,
          body: JSON.stringify(req.body), signal: ctrl.signal
        }).then(function (r) {
          if (!r.ok) {
            lastErr = 'HTTP ' + r.status;
            throw new Error(lastErr);
          }
          return r.json();
        }).then(function (j) {
          clearTimeout(timer);
          var line = self.validate(self.extractText(j, cfg.protocol));
          if (!line) { lastErr = '返回内容不合规'; throw new Error('bad'); }
          cb(null, line, { ms: Date.now() - t0, src: 'model' });
        }).catch(function (e) {
          clearTimeout(timer);
          var to = !!(e && e.name === 'AbortError');
          if (!lastErr && to) lastErr = '请求超时';
          /* 超时**不重试**：站慢的时候重试只会把玩家的等待翻倍，直接兜底更友好；
             重试只留给 HTTP 错误 / 内容不合规这类"再试一次大概率不同"的失败。 */
          if (attempts < 2 && !to) { attempt(0.3); return; }
          cb(null, self.fallback(trigger, extra),
            { ms: Date.now() - t0, src: 'template', err: lastErr });
        });
      }
      attempt(cfg.temp);
    },

    FORBIDDEN: ['游戏', '程序', '系统', '手机', '电脑', '互联网', '玩家', '存档', 'AI', 'BUG', '软件', '网络'],
    /* 入参从"响应体"改成"模型产出的文本"—— 三家取文本的路径不同，已在 extractText 里归一 */
    validate: function (text) {
      try {
        var o = this.pickJson(text);
        if (!o) return null;
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
      if (trigger === 'chat')
        return this.fallbackChat(extra && extra.text, G.game.meta, si);
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

    /* 自由对话的预置回应（模型关闭/断网时）：关键词识别 + 按感应阶段递进，
       刻意让天道"有脾气、会回怼"（用户第 8 点）。确定性，不随机漂移。 */
    fallbackChat: function (text, meta, si) {
      text = String(text || '');
      if (si == null) si = this.STAGES.indexOf(this.stageOf(meta));
      function p(arr) { return arr[Math.min(arr.length - 1, Math.max(0, si))]; }
      if (/我命由我|不由天|逆天|逆你|抗天|反天|斗一斗|战你/.test(text))
        return p(['蚍蜉撼树，也配言逆？',
          '我命由你？可笑——万千逆天者，皆成了枯骨。',
          '好一个不由天。本座倒要看看，你能逆到几时。',
          '逆天？你连本座一道目光都受不住。',
          '逆吧。这棋盘之上，本座最爱不服输的子。']);
      if (/你是谁|天道是|何物|何人|是什么/.test(text))
        return p(['本座即秩序，即这方天地。',
          '万物生灭，皆在本座一念。',
          '你不必知我是谁，只需知——你在局中。']);
      if (/道在|如何修|怎么修|功法|突破|机缘/.test(text))
        return p(['道在己身，问本座无益。',
          '修行路是尸骨铺就的，你走得动么？',
          '本座不度人。自渡，或沉。']);
      if (/长生|不死|永生|寿元/.test(text))
        return p(['长生？那是最毒的妄念。',
          '求长生者，多死在求长生的路上。']);
      if (/杀|死|怕|惧/.test(text))
        return p(['怕死，便不该踏上修行路。',
          '杀业也是业，本座一笔一笔记着。']);
      if (/爱|情|执念|放不下/.test(text))
        return p(['情之一字，最是乱道心。',
          '放不下，便拎着它入轮回——迟早要还。']);
      return p(['嗯？区区凡胎，也敢与本座攀话。',
        '说完了？说完便去，莫扰天机。',
        '你的心思，本座早已看透。',
        '风过无痕，你的话也一样。',
        '说与不说，结局早已写定。']);
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
      var t0 = Date.now(), self = this;
      this.callModel('test', {}, function (e, line, meta) {
        var ms = meta.ms || (Date.now() - t0);
        self.testOk = (meta.src === 'model');
        if (self.testOk) { cb(line + '　（' + ms + 'ms · 模型应答）'); return; }
        cb((meta.err ? meta.err + '　' : '') + line + '　（' + ms + 'ms · 预置兜底）');
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
      /* rect 内坐标；get/set 读写字符串。opt.secret → 输入框按密码态显示（API 密钥） */
      focus: function (rect, get, set, opt) {
        if (!this.el) this._build();
        opt = opt || {};
        this.el.type = opt.secret ? 'password' : 'text';
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

    /* ============ 设置面板 ============
       v0.8.0 起**没有「菜单」这一页**了：原先它是个二级目录（角色/秘境/难度/天道设置），
       其中角色等六项已拆到底栏常驻，秘境在区域裂隙上直接点，难度在本页。
       所以顶栏右上角那颗按钮直接叫「设置」，点开就是这一页。 */
    SET_P: { x: 16, y: 14, w: 448, h: 244 },
    WORLDS_P: { x: 40, y: 16, w: 400, h: 240 },
    ABOUT_P: { x: 16, y: 12, w: 448, h: 246 },
    CHAT_P: { x: 16, y: 12, w: 448, h: 246 },

    /* 当前版本功能清单（关于页；本版交付的功能在此登记，用户第 9 点） */
    VERSION_FEATURES: [
      '全游戏动态化：主角/NPC 四方向帧动画、战斗立绘呼吸/受击/命中特效',
      '灵根珠脉动、面板立绘呼吸、漂浮粒子；建筑道路边缘自然集成',
      '去除重复灵气（灵气即经验）；破境成功率下调，失败散灵气损寿元伤气血',
      '副业须拜师学习：炼丹/炼器/采药/采矿寻名师，第一世可能不会',
      '天道有自我意志，可自由对话、会回怼；破境先受天劫问话',
      '副本秘境前置任务+引灵符（独立小世界·陨落真死）；旅途际遇7段抉择'
    ],
    /* 历史版本（近 7 个里程碑；更早见 git 提交记录） */
    VERSION_HISTORY: [
      ['v0.54.0', '手绘地图 + 仙云、角色/NPC 帧动画、15 副本 20 Boss、签名秘术'],
      ['v0.47.0', '陆地坐骑；v0.46 野外妖囊驯服；v0.45 灵兽出战'],
      ['v0.44.0', '灵兽系统（兽栏/喂养/化形）、宗门独立小世界'],
      ['v0.42.0', '凡界九宗门山门可进；v0.40 灵根珠与材料富化'],
      ['v0.39.0', '自创宗门 + 收徒、散修盟悬赏'],
      ['v0.38.0', '主线分叉（散修线/宗门线）；v0.37 宗门岁俸'],
      ['v0.35.0', '副本随机事件房；v0.33 2.5D 建筑；v0.30 战斗特效']
    ],

    /* 本模块负责渲染的 overlay 白名单（各场景 renderOverlay 统一走 G.Overlays.route）。
       新增菜单页只改这里，不用再去改 town/field/cave/regiongen/interiorgen 五处。 */
    MENU_OVERLAYS: { settings: 1, worlds: 1, worldgate: 1, about: 1, heavenchat: 1 },
    isMenuOverlay: function (name) { return !!this.MENU_OVERLAYS[name]; },

    /* 密钥显示：只露头尾，中间打点（面板是每帧重画的，明文天天糊在屏幕上不好） */
    maskKey: function (k) {
      k = String(k || '');
      if (!k) return '未填写';
      if (k.length <= 10) return k.slice(0, 2) + '****';
      return k.slice(0, 6) + '…' + k.slice(-4);
    },

    openSettings: function (scene) {
      var self = this, cfg = this.ensure();
      function rebuild() { self.openSettings(scene); }
      var on = cfg.mode === 'remote';
      var bx = [70, 190, 310], by = 84;

      scene.setOverlay('settings', [
        /* ① 是否启用模型 */
        new G.UI.Btn({ x: 70, y: 48, w: 110, h: 24, small: true,
          variant: on ? 'gold' : 'default',
          label: '启用模型', onClick: function () { cfg.mode = 'remote'; self.saveCfg(); rebuild(); } }),
        new G.UI.Btn({ x: 190, y: 48, w: 110, h: 24, small: true,
          variant: on ? 'default' : 'gold',
          label: '关闭·预置', onClick: function () { cfg.mode = 'off'; self.saveCfg(); rebuild(); } }),

        /* ② 接口协议三选一 */
        new G.UI.Btn({ x: bx[0], y: by, w: 110, h: 24, small: true,
          variant: cfg.protocol === 'openai' ? 'gold' : 'default', label: 'OpenAI',
          onClick: function () { cfg.protocol = 'openai'; self.saveCfg(); rebuild(); } }),
        new G.UI.Btn({ x: bx[1], y: by, w: 110, h: 24, small: true,
          variant: cfg.protocol === 'claude' ? 'gold' : 'default', label: 'Claude',
          onClick: function () { cfg.protocol = 'claude'; self.saveCfg(); rebuild(); } }),
        new G.UI.Btn({ x: bx[2], y: by, w: 110, h: 24, small: true,
          variant: cfg.protocol === 'response' ? 'gold' : 'default', label: '原生 Response',
          onClick: function () { cfg.protocol = 'response'; self.saveCfg(); rebuild(); } }),

        /* ③ 连接三件套（点一下弹原生输入框，支持中文 IME 与移动端键盘） */
        new G.UI.Btn({ x: 110, y: 122, w: 340, h: 22, small: true, variant: 'ghost',
          label: cfg.endpoint,
          onClick: function () {
            self.Field.focus({ x: 110, y: 122, w: 340, h: 22 },
              function () { return cfg.endpoint; },
              function (v) { if (v) cfg.endpoint = v; self.saveCfg(); rebuild(); });
          } }),
        new G.UI.Btn({ x: 110, y: 148, w: 340, h: 22, small: true, variant: 'ghost',
          label: cfg.model,
          onClick: function () {
            self.Field.focus({ x: 110, y: 148, w: 340, h: 22 },
              function () { return cfg.model; },
              function (v) { if (v) cfg.model = v; self.saveCfg(); rebuild(); });
          } }),
        new G.UI.Btn({ x: 110, y: 174, w: 340, h: 22, small: true, variant: 'ghost',
          label: this.maskKey(cfg.apiKey),
          onClick: function () {
            self.Field.focus({ x: 110, y: 174, w: 340, h: 22 },
              function () { return cfg.apiKey || ''; },
              function (v) { cfg.apiKey = v; self.saveCfg(); rebuild(); }, { secret: true });
          } }),

        /* ④ 自检 + 其它入口 + 关闭。
           v0.75.0 两处改动（用户口径）：
             ① 新增「返回主菜单」—— 方便玩家回主菜单看成就与称号图鉴
                （用户原话：「设置界面需要新增返回主菜单的按钮，方便玩家去查看
                 成就与称号收集图鉴」）。回标题前**先存档**，否则进度会丢。
             ② 「界域难度」**仅主菜单可选**（见 openWorlds 的守卫）——
                世内不再提供入口，按钮改为提示"需回主菜单更改"。
           ⚠️ 五行按钮必须均分且不叠：可用横段 26..450（424 宽），
              5 键各 78 + 12 间距 = 78×5 + 12×4 = 438 > 424，所以取 76+11 = 424 正好。 */
        new G.UI.Btn({ x: 26, y: 216, w: 76, h: 22, small: true, variant: 'gold',
          label: '问天道',
          onClick: function () { self.openHeavenChat(scene); } }),
        new G.UI.Btn({ x: 113, y: 216, w: 76, h: 22, small: true,
          label: '界域难度', disabled: !!G.game.meta, title: '界域难度只能在主菜单选择',
          onClick: function () {
            /* 世内锁定（v0.75.0）：当前世界的规则受难度影响，中途改会推翻已生成的
               世界与 Boss 面板。所以这里**只是提示**，不改任何东西。 */
            if (G.game.meta) { G.game.toast('界域难度只能在主菜单选择'); return; }
            self.openWorlds(scene);
          } }),
        new G.UI.Btn({ x: 200, y: 216, w: 76, h: 22, small: true, variant: 'ghost',
          label: '主菜单', disabled: !G.game.meta,
          onClick: function () {
            if (!G.game.meta) { G.game.toast('尚未开始历程'); return; }
            /* 回标题前存一次档：标题场景会重建 meta/save 引用，
               不存的话这一段的进度（境界/物品/任务步）就丢了。 */
            try {
              if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(G.game.save);
              if (G.Storage && G.Storage.saveMeta) G.Storage.saveMeta(G.game.meta);
            } catch (e) { /* 存档失败也要让玩家走得掉，不卡死 */ }
            G.game.changeScene('title');
          } }),
        new G.UI.Btn({ x: 287, y: 216, w: 76, h: 22, small: true, variant: 'ghost',
          label: '关　于', onClick: function () { self.openAbout(scene); } }),
        new G.UI.Btn({ x: 374, y: 216, w: 76, h: 22, small: true, variant: 'ghost',
          label: '关　闭', onClick: function () { scene.clearOverlay(); } })
      ]);
    },

    openAbout: function (scene) {
      var self = this;
      scene.setOverlay('about', [
        new G.UI.Btn({ x: 190, y: 244, w: 100, h: 20, small: true, variant: 'ghost',
          label: '返　回', onClick: function () { self.openSettings(scene); } })
      ]);
    },

    /* ===== 与天道自由对话（用户第 8 点）=====
       玩家可任意输入，天道据自身意志回应；模型关闭时走 fallbackChat 回怼。 */
    openHeavenChat: function (scene) {
      var self = this;
      if (!this.chatLog) this.chatLog = [{ r: 'heaven', t: '既唤本座，有话便说。' }];
      function rebuild() { self.openHeavenChat(scene); }
      scene.setOverlay('heavenchat', [
        new G.UI.Btn({ x: 24, y: 204, w: 432, h: 22, small: true, variant: 'ghost',
          label: '点击输入你要说的话……',
          onClick: function () {
            self.Field.focus({ x: 24, y: 204, w: 432, h: 22 },
              function () { return ''; },
              function (v) { if (v) self.sendChat(scene, v); else rebuild(); });
          } }),
        new G.UI.Btn({ x: 24, y: 232, w: 110, h: 20, small: true, variant: 'gold',
          label: '自检连接',
          onClick: function () {
            self.testStatus = '感应中……'; self.testOk = false;
            self.runTest(function (s) { self.testStatus = s; rebuild(); });
          } }),
        new G.UI.Btn({ x: 142, y: 232, w: 90, h: 20, small: true, variant: 'ghost',
          label: '清空对话', onClick: function () { self.chatLog = null; rebuild(); } }),
        new G.UI.Btn({ x: 346, y: 232, w: 110, h: 20, small: true, variant: 'ghost',
          label: '返　回', onClick: function () { self.openSettings(scene); } })
      ]);
    },

    sendChat: function (scene, text) {
      text = String(text || '').trim();
      if (!text) return;
      this.chatLog = this.chatLog || [];
      this.chatLog.push({ r: 'you', t: text });
      this.chatBusy = true;
      var self = this;
      this.openHeavenChat(scene);
      this.callModel('chat', { text: text }, function (e, line) {
        self.chatBusy = false;
        self.chatLog.push({ r: 'heaven', t: line || '天道无言。' });
        self.openHeavenChat(scene);
      });
    },

    /* ===== 界域难度（设计 v1.1 §2.5）=====
       **世内便捷入口**：通用菜单上挂一处，方便玩家在探索途中改档；
       正式入口是轮回殿「飞升台」（`reincarnation-hall.js`）。两处共用
       `Player.cycleWorldDiff` —— 口径只有一份，不会漂。
       每界难度独立、**立即生效** —— 这样"普通通关凡界 → 回刷凡界地狱拿碎片"才走得通。 */
    openWorlds: function (scene) {
      var self = this;
      var meta = G.game.meta;
      if (!meta) { G.game.toast('尚无存档，无法调整界域难度'); return; }
      var pr = (meta && meta.progress) || {};
      var wd = pr.worldDiff || {};
      var WN = { fan: '凡界', ling: '灵界', xian: '仙界' };
      var DN = { normal: '普通', hard: '困难', hell: '地狱' };
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
            var next = G.Player.cycleWorldDiff(meta, wid);
            if (!next) { G.game.toast(WN[wid] + '尚未解锁，无法调整难度'); return; }
            G.game.toast(WN[wid] + '难度 → ' + DN[next]);
            rebuild();
          }
        }));
        y += 34;
      });
      btns.push(new G.UI.Btn({ x: 190, y: 222, w: 100, h: 24, small: true, variant: 'ghost',
        label: '返　回', onClick: function () { self.openSettings(scene); } }));
      scene.setOverlay('worlds', btns);
    },

    renderOverlay: function (x, scene) {
      if (scene.overlay === 'worlds') {
        var WP = this.WORLDS_P;
        G.Overlays.dim(x);
        G.UI.frame(x, WP, '界 域 难 度', { tex: true });
        G.UI.text(x, { x: WP.x + 30, y: 44 }, '点击切换该界难度，立即生效', 11, G.UI.C.textDim);
        G.UI.text(x, { x: WP.x + 30, y: 168 }, '地狱：Boss 气血×1.8 / 攻击×1.55、资源×0.6、Boss CD−1', 10, G.UI.C.textDim);
        G.UI.text(x, { x: WP.x + 30, y: 185 }, '地狱通关给：称号 + 跨世永久全属性+10% + 道之钥匙碎片', 10, G.UI.C.goldHi);
        G.UI.text(x, { x: WP.x + 30, y: 202 }, '三界碎片集齐 → 道界开启', 10, G.UI.C.goldHi);
      } else if (scene.overlay === 'worldgate') {
        var GP = this.WORLDS_P;
        G.Overlays.dim(x);
        G.UI.frame(x, GP, '界　门', { tex: true });
        G.UI.text(x, { x: GP.x + 30, y: 44 }, '点击前往已解锁的界', 11, G.UI.C.textDim);
        G.UI.text(x, { x: GP.x + 30, y: 185 }, '凡界 — 下品灵石　灵界 — 中品　仙界 — 上品/极品', 10, G.UI.C.textDim);
        G.UI.text(x, { x: GP.x + 30, y: 202 }, '道界需集齐三界地狱的道之钥匙碎片', 10, G.UI.C.goldHi);
      } else if (scene.overlay === 'about') {
        var AP = this.ABOUT_P;
        G.Overlays.dim(x);
        G.UI.frame(x, AP, '关　于', { tex: true });
        var lx = AP.x + 18;
        G.UI.text(x, { x: lx, y: 40 }, '当前版本　' + G.VERSION
          + '　·　横屏单机仙侠轮回 Roguelite', 12, G.UI.C.goldHi);
        this.VERSION_FEATURES.forEach(function (l, i) {
          G.UI.text(x, { x: lx, y: 57 + i * 14 }, '· ' + l, 10, G.UI.C.textDim);
        });
        G.UI.text(x, { x: lx, y: 143 }, '历史版本（更早见 git 提交记录）', 11, G.UI.C.gold);
        this.VERSION_HISTORY.forEach(function (h, i) {
          G.UI.text(x, { x: lx, y: 158 + i * 13 }, h[0], 10, G.UI.C.goldHi);
          G.UI.text(x, { x: lx + 52, y: 158 + i * 13 }, h[1], 9.5, G.UI.C.textDim);
        });
      } else if (scene.overlay === 'heavenchat') {
        var CP = this.CHAT_P;
        G.Overlays.dim(x);
        G.UI.frame(x, CP, '问 天 · 与 天 道 对 话', { tex: true });

        var x0 = CP.x + 16, x1 = CP.x + CP.w - 16, maxW = x1 - x0, lh = 13.5;
        function wrap(txt) {
          var chars = String(txt).split(''), out = [], cur = '';
          for (var i = 0; i < chars.length; i++) {
            var test = cur + chars[i];
            if (x.measureText(test).width > maxW && cur) { out.push(cur); cur = chars[i]; }
            else cur = test;
          }
          if (cur) out.push(cur);
          return out;
        }
        var rows = [];
        (this.chatLog || []).forEach(function (m) {
          var head = m.r === 'you' ? '你：' : '天道：';
          var col = m.r === 'you' ? G.UI.C.gold : G.UI.C.jadeHi;
          wrap(head + m.t).forEach(function (l) { rows.push({ t: l, c: col }); });
        });
        if (this.chatBusy) rows.push({ t: '天道沉吟……', c: G.UI.C.textDim });
        var top = 42, max = Math.floor((198 - top) / lh);
        rows.slice(-max).forEach(function (r, i) {
          G.UI.text(x, { x: x0, y: top + 4 + i * lh }, r.t, 10, r.c);
        });
        if (this.testStatus)
          G.UI.textOut(x, { x: x1, y: 27 }, this.testStatus, 8.5,
            this.testOk ? G.UI.C.goldHi : G.UI.C.textDim, 'right');
      } else if (scene.overlay === 'settings') {
        var P = this.SET_P, cfg = this.ensure();
        G.Overlays.dim(x);
        G.UI.frame(x, P, '设　置', { tex: true });

        G.UI.text(x, { x: P.x + 20, y: 54 }, '天道', 11.5, G.UI.C.gold);
        G.UI.text(x, { x: P.x + 20, y: 90 }, '协议', 11.5, G.UI.C.gold);
        G.UI.text(x, { x: P.x + 20, y: 128 }, '服务器', 11, G.UI.C.textDim);
        G.UI.text(x, { x: P.x + 20, y: 154 }, '模型名', 11, G.UI.C.textDim);
        G.UI.text(x, { x: P.x + 20, y: 180 }, '密　钥', 11, G.UI.C.textDim);
        G.UI.text(x, { x: P.x + 20, y: 200 }, '自检', 11.5, G.UI.C.gold);

        /* 状态徽标放右上角空槽（启用/关闭两钮止于 x300，空槽 x310..444），
           与按钮行 y48..72 垂直居中（top54）；用短徽标，杜绝与按钮/标题重叠。 */
        G.UI.textOut(x, { x: P.x + P.w - 20, y: 54 }, cfg.mode === 'remote'
          ? '● 模型应答'
          : '○ 预置谶语', 11,
          cfg.mode === 'remote' ? G.UI.C.jadeHi : G.UI.C.textDim, 'right');

        /* 自检结果：模型应答=金，兜底=灰（并带上失败原因，便于排查密钥/地址） */
        G.UI.text(x, { x: 140, y: 201 }, this.testStatus || '未问卦', 10.5,
          this.testOk ? G.UI.C.goldHi : G.UI.C.textDim);

        /* 底部提示：与按钮行（216..238）**水平错开**不了，只能靠垂直分开 ——
           提示压在最底（244..254），按钮行收在 238，中间留 6px。 */
        G.UI.text(x, { x: P.x + 20, y: 244 },
          '密钥只写在本机存档里，不上传；留空则按匿名调用。', 9.5, G.UI.C.textDim);
      }
    },

    /* 面板内点击（输入框由按钮承载，这里只做隐藏输入框的失焦兜底）。
       v0.62.0：**地图面板的节点点击 = 传送**（用户第 6/8 点）挂在这里 ——
       它是所有探索场景共用的 overlay 点击入口（`hooks.overlayTap`），
       单独在每个场景里加一遍必然漏（生成型区域 / 室内 / 山门 / 血煞据点各一套）。 */
    overlayTap: function (p, scene) {
      if (G.Overlays && G.Overlays.mapTap) return G.Overlays.mapTap(p, scene);
      return false;
    },
    overlayKey: function (code, scene) {
      if (code === 'Escape') scene.clearOverlay();
    }
  };

  G.TianDao = TD;
})();
