/* 主线插曲 · 旅途际遇（v0.60，用户第 3 点）
   在野外刷境界的漫长空档里，按 gl 里程碑触发一次性剧情：有取舍、有残酷、有凡人。
   状态记在 save.quest.flags['se_<id>']；覆盖层为 'storyevent'，由 explore 基类分派。 */
(function () {
  function has(save, name) { return ((save.items || {})[name] || 0) > 0; }
  function take(save, name) {
    save.items[name] = (save.items[name] || 0) - 1;
    if (save.items[name] <= 0) delete save.items[name];
  }

  var LIST = [
    { id: 'se1', gl: 6, title: '官 道 旁',
      lines: ['一个面黄肌瘦的孩童抱着母亲的尸体，仰头看你：“仙长……有吃的吗？”',
        '那妇人早已凉透，手里还攥着半块草根饼。'],
      choices: [
        { t: '赠一枚回春丹', run: function (s) {
          if (has(s, '回春丹')) { take(s, '回春丹'); return '孩童叩首。你却知道，这丹救得了一时，救不了一世。'; }
          return '你摸了摸药囊，空空如也，终究什么也没给。'; } },
        { t: '拂袖而去', run: function () { return '你别开眼。凡人的命，你管不过来。'; } }
      ] },

    { id: 'se2', gl: 12, title: '林 中 败 修',
      lines: ['一名修士浑身是血倒在地上，见你来，攥紧储物袋：“道友，替我把它送回家中，必有重谢。”',
        '他身后的草丛里，两道人影正盯着这里。'],
      choices: [
        { t: '应下，驱散觊觎者', run: function (s) { s.stone = (s.stone || 0) + 120; return '你拔剑驱散了尾随者，败修将袋中灵石相赠，气绝而亡。'; } },
        { t: '趁火打劫', run: function (s) { s.stone = (s.stone || 0) + 200; return '你取了袋子转身便走，背后那人的眼神你不敢回看。'; } },
        { t: '绕开', run: function () { return '你绕路而行，片刻后听见身后传来短促的惨叫。'; } }
      ] },

    { id: 'se3', gl: 20, title: '茅 屋 前',
      lines: ['几名外门弟子为一株老参，要拆一户药农的茅屋，老者跪地哀求。',
        '为首者笑：“你的破屋，也配长灵草？”'],
      choices: [
        { t: '出头打抱不平', run: function (s) { s.items['百年灵芝'] = (s.items['百年灵芝'] || 0) + 1; return '你打退几人，老者将那株老参塞到你手里。'; } },
        { t: '忍下', run: function () { return '你攥紧拳走开，第一次明白“宗门”二字有多重。'; } }
      ] },

    { id: 'se4', gl: 30, title: '坐 化 之 人',
      lines: ['山洞里一位老者已经坐化，膝上摊着一卷被血浸透的手记。',
        '墙上刻着：“修道四十载，败于筑基，勿蹈覆辙。”'],
      choices: [
        { t: '收下手记', run: function (s) { s.stone = (s.stone || 0) + 80; return '手记里写满破境失败的教训，你默默记下。'; } },
        { t: '入土为安', run: function (s) { s.qi = (s.qi || 0) + 300; return '你将老者葬了，叩了三个头。'; } }
      ] },

    { id: 'se5', gl: 50, title: '茶 棚 同 路',
      lines: ['茶棚里遇上一个同样出身微末的年轻修士，意气相投。',
        '他举杯：“他日你我若有一人先死，另一人替对方把这条路走完，如何？”'],
      choices: [
        { t: '击掌结义', run: function (s) { s.qi = (s.qi || 0) + 600; return '你们击掌为誓，相约山外再见。'; } },
        { t: '婉拒', run: function () { return '你举杯回敬，却没敢应下那句话——修仙路上，不敢结因果。'; } }
      ] },

    { id: 'se6', gl: 90, title: '夜 救 失 魂',
      lines: ['夜里你救下一个被邪修抽了一半魂魄的女子，她的脸有几分像记忆里的某个人。',
        '她抓着你：“别让他们……把我带到天上去……”'],
      choices: [
        { t: '耗丹续魂', run: function (s) {
          if (has(s, '回春丹')) { take(s, '回春丹'); return '你续住她一炷命，她却终究没能撑到天亮。'; }
          return '你没有丹药，只能眼睁睁看着她的眼神一点点暗下去。'; } },
        { t: '给她一个痛快', run: function () { return '你闭着眼，替她了断了痛苦。'; } }
      ] },

    { id: 'se7', gl: 130, title: '旧 识 噩 耗',
      lines: ['你听闻当年一同进山的某人，已在一处秘境里陨落，只找回半截佩剑。',
        '有人劝你：修仙本就是百不存一，早该习惯。'],
      choices: [
        { t: '立碑祭酒', run: function (s) { s.qi = (s.qi || 0) + 500; return '你在山外立了块无字碑，洒了半壶酒。'; } },
        { t: '带走佩剑', run: function (s) { s.stone = (s.stone || 0) + 100; return '你收下断剑，带着他那份一起往前走。'; } }
      ] }
  ];

  var index = {};
  LIST.forEach(function (e) { index[e.id] = e; });

  G.Data = G.Data || {};
  G.Data.StoryEvents = {
    list: LIST,
    byId: function (id) { return index[id] || null; },
    /* 下一个未看、且已达 gl 的插曲（按 gl 排序） */
    pending: function (save) {
      var flags = (save.quest && save.quest.flags) || {};
      var gl = save.globalLevel || 1;
      for (var i = 0; i < LIST.length; i++) {
        var e = LIST[i];
        if (gl >= e.gl && !flags['se_' + e.id]) return e;
      }
      return null;
    },
    /* 弹出：建选择按钮 */
    show: function (scene, ev) {
      var self = this;
      scene._storyEv = ev;
      scene._storyResult = null;
      var btns = ev.choices.map(function (c, i) {
        return new G.UI.Btn({
          x: 60 + i * 124, y: 196, w: 116, h: 38, small: true,
          variant: i === 0 ? 'gold' : 'default', label: c.t,
          onClick: function () {
            var r = c.run(G.game.save);
            var flags = G.game.save.quest.flags;
            flags['se_' + ev.id] = true;
            G.Storage.saveCurrent(G.game.save);
            self._showResult(scene, r);
          }
        });
      });
      scene.setOverlay('storyevent', btns);
    },
    _showResult: function (scene, r) {
      scene._storyResult = r;
      scene.buttons = [
        new G.UI.Btn({ x: 190, y: 210, w: 100, h: 24, small: true, variant: 'ghost',
          label: '知道了', onClick: function () {
            scene._storyEv = null; scene._storyResult = null;
            scene.clearOverlay();
          } })
      ];
    },
    render: function (x, scene) {
      var ev = scene._storyEv;
      if (!ev) return;
      G.Overlays.dim(x);
      var P = { x: 40, y: 40, w: 400, h: 188 };
      G.UI.frame(x, P, ev.title, { tex: true });
      if (scene._storyResult) {
        var rl = G.UI.wrap(x, scene._storyResult, 12.5, P.w - 60);
        rl.forEach(function (l, i) {
          G.UI.text(x, { x: P.x + 30, y: P.y + 78 + i * 22 }, l, 12.5, '#e2d8be');
        });
      } else {
        var y = P.y + 40;
        ev.lines.forEach(function (l) {
          var ls = G.UI.wrap(x, l, 12.5, P.w - 56);
          ls.forEach(function (w) {
            G.UI.text(x, { x: P.x + 28, y: y }, w, 12.5, '#d8d2c0');
            y += 21;
          });
          y += 5;
        });
      }
    }
  };
})();
