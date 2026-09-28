/* 主线插曲 · 机缘（v0.60 立，v0.62.0 扩成三态触发）
   在野外刷境界的漫长空档里触发一次性剧情：有取舍、有残酷、有凡人。
   状态记在 save.quest.flags['se_<id>']；覆盖层为 'storyevent'，由 explore 基类分派。

   ---- v0.62.0 扩充（用户第 7 点）----
   用户口径：「支线任务，会存在在行走其他地图时间触发，或者等到特定境界时触发特殊任务，
              完成之后奖励功法、法宝、或者惩罚死亡等等」。
   所以触发条件从"只有 gl"扩成**三种，可组合**：
     · `gl: N`      境界达到 N（野外静止时触发，与旧版一致）
     · `map: 'fan6'` **行走进入该图**即触发（进图后静止那一下判定；不需找 NPC）
     · `step: 'm1-3'` 主线推进到该步
   另有 `where`：
     · 缺省 `'wild'` —— 只在野外（非城镇 / 非室内 / 非洞穴）
     · `'any'`       —— 哪都行（城镇、室内、洞里都触发）
   **奖励**直接给已有系统：`skill`（功法）/ `equip`（法宝）/ `stone` / `qi` / `items`。
   **惩罚**：某个选项标 `dead: true` → 演完结果直接 `G.game.die('event')`（真死，不走心魔）。
   ⚠️ `dead` 选项**必须**在文案里说清楚代价，且同一条机缘**至少要留一条活路** ——
      否则玩家在毫无信息的情况下必死，那不是"残酷"是"不讲道理"。
   ⚠️ 同一条机缘的所有选项都要 `run(s)` 返回一句结果文案（可空串），显示在结果页。
   ============================================================ */
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
      ] },

    /* ===== v0.62.0 新增（用户第 7 点：行走触发 / 境界触发 + 奖功法法宝 / 罚死）===== */

    /* —— 行走触发：进入指定区域即遇 ——
       `map` 取区域 id（fan1..fan9 / ling* / xian*）。这些图都是野外，where 缺省即可。 */
    { id: 'se8', map: 'fan5', title: '山 道 劫 修',
      lines: ['山道拐角，三个散修拦住去路，为首者掂着刀：“留下储物袋，饶你不死。”',
        '你看出他们最高的不过炼气，但人多。'],
      choices: [
        { t: '杀穿过去', run: function (s) {
          s.stone = (s.stone || 0) + 260; s.qi = (s.qi || 0) + 200;
          return '你反手一剑挑落为首者的刀。余下两人溃逃，袋里的灵石散了一地。'; } },
        { t: '舍财免灾', run: function (s) {
          var lose = Math.min(s.stone || 0, 120);
          s.stone = (s.stone || 0) - lose;
          return '你丢下 ' + lose + ' 灵石。他们捡了便走 —— 你记住了他们的脸。'; } },
        { t: '报出宗门名号', run: function (s) {
          if (s.cult === 'sect' && s.sectId) {
            s.sectRep = (s.sectRep || 0) + 15;
            return '你报出本门名号，三人脸色一变，倒退着走了。门中声望 +15。'; }
          return '你报了名号，他们大笑：“散修也敢唬人？”—— 你只得硬拼着杀出重围。'; } }
      ] },

    { id: 'se9', map: 'fan7', title: '荒 冢 残 卷',
      lines: ['乱草间半塌的古冢敞着口，棺已朽尽，只余一册被虫蛀过的残卷压在骨上。',
        '卷首一行小字：“后来者得之，勿祭我，速去。”'],
      choices: [
        { t: '取卷', run: function (s) {
          s.items['凡品功法碎片'] = (s.items['凡品功法碎片'] || 0) + 6;
          return '残卷已朽，你只拓下几页要诀 —— 得凡品功法碎片 ×6。'; } },
        { t: '封冢离去', run: function (s) {
          s.qi = (s.qi || 0) + 260;
          return '你把土推回去，合掌一礼。心里反倒静了，灵气 +260。'; } }
      ] },

    /* —— 境界触发：高界专属（走 where:'any'，因为高界常在城镇/洞府落脚）—— */
    { id: 'se10', gl: 73, where: 'any', title: '筑 基 心 障',
      lines: ['筑基在即，你连做了三夜同一个梦：你跪在泥里，抬头看别人的飞剑掠过天顶。',
        '梦里的你问：凭什么？'],
      choices: [
        { t: '认下这份不甘', run: function (s) {
          s.qi = (s.qi || 0) + 900;
          return '你把不甘咽下去，化成一股蛮劲。灵气 +900。'; } },
        { t: '斩去杂念', run: function (s) {
          s.ageBonus = (s.ageBonus || 0) + 1;
          return '你斩去执念，心湖如镜 —— 却老了一岁。'; } }
      ] },

    { id: 'se11', gl: 181, where: 'any', title: '化 神 之 门',
      lines: ['识海深处浮出一道门，门后有人在唤你的名字，声音像极了你早死的娘亲。',
        '你知道那是心魔 —— 可它太像了。'],
      choices: [
        { t: '推门而入', dead: true, run: function () {
          return '你推门进去。门后空无一物，只有无尽的虚 —— 你的神魂散了。'; } },
        { t: '闭目不问', run: function (s) {
          s.qi = (s.qi || 0) + 1500;
          return '你闭目不看、不听、不应。门自己淡了。灵气 +1500。'; } },
        { t: '以剑劈门', run: function (s) {
          if (has(s, '崩岩掌') || (s.skills && Object.keys(s.skills).length >= 3)) {
            s.stone = (s.stone || 0) + 300;
            return '你一剑劈开幻门，心魔溃散，识海澄明。'; }
          return '你劈了个空。门仍在，你只得强压心神退出来。'; } }
      ] },

    { id: 'se12', gl: 289, where: 'any', title: '渡 劫 前 夜',
      lines: ['渡劫在即。有人在你门前放了一枚玉简，只有六个字：“借命一用，可好。”',
        '落款是你曾救过的那个人。'],
      choices: [
        { t: '借他三年寿元', run: function (s) {
          s.ageBonus = (s.ageBonus || 0) + 3;
          s.qi = (s.qi || 0) + 2600;
          return '你划开掌心应下。三年寿元换一线机缘 —— 灵气 +2600。'; } },
        { t: '把玉简烧了', run: function (s) {
          s.stone = (s.stone || 0) + 400;
          return '你把玉简烧成灰。夜里雷声比往年少了一些。'; } }
      ] },

    { id: 'se13', gl: 469, where: 'any', title: '金 仙 遗 蜕',
      lines: ['你在云海之上遇到一具金仙遗蜕，衣袍不腐，指间扣着一枚储物戒。',
        '戒上有一道未消的禁制，隐隐还在吞吐灵光。'],
      choices: [
        { t: '强破禁制', dead: true, run: function () {
          return '禁制反噬，你连神魂带肉身一起被绞碎了 —— 金仙的东西，不是你能碰的。'; } },
        { t: '叩首取戒', run: function (s) {
          s.items['八卦盘'] = (s.items['八卦盘'] || 0) + 1;
          s.qi = (s.qi || 0) + 3200;
          return '你先叩了三个头，禁制竟自行散了。戒中得一件「八卦盘」。'; } },
        { t: '不动，绕开', run: function (s) {
          s.qi = (s.qi || 0) + 800;
          return '你绕开遗蜕。走出百步回头，那具遗蜕已化作飞灰。'; } }
      ] }
  ];

  var index = {};
  LIST.forEach(function (e) { index[e.id] = e; });

  G.Data = G.Data || {};
  G.Data.StoryEvents = {
    list: LIST,
    byId: function (id) { return index[id] || null; },
    /* 场景能不能触发"野外"机缘：城镇 / 室内 / 洞穴都不算野外。
       ⚠️ **生成型区域按定义是野外** —— 它的 `ground` 可能是 cave（乱葬岗 = 荒坟鬼冢，
          地面画法用洞窟纹理），但那只是"画法"，不是"这是洞里"。
          手写地图（赤牙洞 fan3 → mapId 是 'cave'）才要按洞穴排除。
          判据用 `regions.mapIdOf(id) === id`（区域自己就是那张图），
          **不要用 `md.ground === 'cave'`** —— 那会把乱葬岗/落霞灵矿/火云谷一起误杀，
          表现是"机缘挂在那三张图上永远不弹"，且完全不报错。 */
    wildOk: function (scene) {
      if (!scene || !scene.map) return false;
      var md = scene.map.md || {};
      if (md.indoor || md.safe) return false;
      var name = (G.game && G.game.sceneName) || '';
      var R = G.Data.regions;
      if (R && R.byId && R.byId(name) && R.mapIdOf(name) === name) return true;
      var bt = scene._baseType ? scene._baseType() : '';
      return bt !== 'cave' && bt !== 'bloodcave';
    },
    /* 下一个该触发的机缘（按 LIST 顺序取第一条满足条件的）。
       ⚠️ **旧的 `pending(save)` 保留成这一条的薄包装** —— 契约与老调用点还在用它，
          删掉会让"gl 触发"这条线静默失效（不报错、只是永远不弹）。 */
    pendingFor: function (save, scene) {
      var flags = (save.quest && save.quest.flags) || {};
      var gl = save.globalLevel || 1;
      var mapId = (G.game && G.game.sceneName) || (save.map || '');
      var step = (save.quest && save.quest.step) || '';
      for (var i = 0; i < LIST.length; i++) {
        var e = LIST[i];
        if (flags['se_' + e.id]) continue;          /* 一次性的：看过就再也不弹 */
        if (e.gl != null && gl < e.gl) continue;
        if (e.map && e.map !== mapId) continue;
        if (e.step && e.step !== step) continue;
        if (e.where !== 'any' && !this.wildOk(scene)) continue;
        return e;
      }
      return null;
    },
    pending: function (save) {
      /* 只判 gl / step 这两类"与场景无关"的条件（老签名没有 scene） */
      var flags = (save.quest && save.quest.flags) || {};
      var gl = save.globalLevel || 1;
      var step = (save.quest && save.quest.step) || '';
      for (var i = 0; i < LIST.length; i++) {
        var e = LIST[i];
        if (e.map) continue;                        /* 行走触发的不在这个口子里 */
        if (flags['se_' + e.id]) continue;
        if (e.gl != null && gl < e.gl) continue;
        if (e.step && e.step !== step) continue;
        return e;
      }
      return null;
    },
    /* 弹出：建选择按钮。
       `ev.after`（可选）是"结果页点完之后"的钩子 —— 章节链用它进结局场景。
       ⚠️ 放在**结果页之后**而不是选项之后：玩家得先读完"为什么走到这一步"。 */
    show: function (scene, ev) {
      var self = this;
      scene._storyEv = ev;
      scene._storyResult = null;
      scene._storyDead = false;
      scene._storyAfter = ev.after || null;
      /* 选项多于 3 个时按钮要收窄，否则 4 个 116px 的按钮会顶出 480 宽的屏 */
      var n = ev.choices.length;
      var bw = Math.min(116, Math.floor((400 - (n - 1) * 10) / n));
      var x0 = 240 - (n * bw + (n - 1) * 10) / 2;
      var btns = ev.choices.map(function (c, i) {
        return new G.UI.Btn({
          x: Math.round(x0 + i * (bw + 10)), y: 196, w: bw, h: 38, small: true,
          variant: i === 0 ? 'gold' : (c.dead ? 'battle' : 'default'), label: c.t,
          onClick: function () {
            var r = c.run(G.game.save);
            var flags = G.game.save.quest.flags;
            flags['se_' + ev.id] = true;
            /* 章节链的完成记录走**自己的字段**（`save.chapters`）——
               塞进 quest.flags 会和机缘混在一起，任务面板分不出"这是主线章节"。 */
            if (ev.chapter && G.Data.Chapters) G.Data.Chapters.markDone(G.game.save, ev.id);
            scene._storyDead = !!c.dead;
            G.Storage.saveCurrent(G.game.save);
            self._showResult(scene, r);
          }
        });
      });
      scene.setOverlay('storyevent', btns);
    },
    _showResult: function (scene, r) {
      scene._storyResult = r;
      var dead = scene._storyDead;
      scene.buttons = [
        new G.UI.Btn({ x: 190, y: 210, w: 100, h: 24, small: true,
          variant: dead ? 'battle' : 'ghost',
          label: dead ? '……' : '知道了',
          onClick: function () {
            var after = scene._storyAfter;
            scene._storyEv = null; scene._storyResult = null; scene._storyAfter = null;
            scene.clearOverlay();
            /* 惩罚死亡（用户第 7 点"或者惩罚死亡"）：**在结果页点完之后**才收命 ——
               让玩家先读完"为什么死"，再进天道拦魂。直接 die() 会把文案吞掉。
               ⚠️ 走 `G.game.die('event')`，复用统一死亡入口（天道拦魂 → 死亡结算），
                  不另写一份（两份结算必然漂）。 */
            if (dead && G.game.die) { G.game.die('event'); return; }
            if (after) after(scene);
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
