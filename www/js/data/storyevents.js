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
      ] },

    /* ===== v0.76.0 阶段八：第一批机缘事件扩展（se14-se28）===== */

    { id: 'se14', gl: 36, title: '筑 基 之 惑',
      lines: ['你站在筑基瓶颈前，已经失败三次。', '一个声音在耳边响起："要不要试试我的丹药？成功率翻倍。"'],
      choices: [
        { t: '接受丹药', run: function (s) {
          s.items['筑基丹'] = (s.items['筑基丹'] || 0) + 1;
          s.stone -= 200;
          return '你接过丹药，却发现那人已经消失。丹药是真的。';
        }},
        { t: '拒绝', run: function (s) {
          s.qi = (s.qi || 0) + 1000;
          return '你拒绝了，继续苦修。三天后，你靠自己的力量突破了。';
        }}
      ] },

    { id: 'se15', gl: 72, title: '宗 门 分 歧',
      lines: ['宗门内两派争斗，执法堂要你表态站队。', '一方承诺你资源，另一方承诺你自由。'],
      choices: [
        { t: '站资源派', run: function (s) {
          s.stone = (s.stone || 0) + 300;
          s.items['精钢'] = (s.items['精钢'] || 0) + 3;
          return '你站了资源派，得到灵石和材料。但从此多了些约束。';
        }},
        { t: '站自由派', run: function (s) {
          s.qi = (s.qi || 0) + 1500;
          return '你站了自由派。虽然资源少了，但修炼不受干扰。';
        }},
        { t: '两不相帮', run: function () {
          return '你闭门不出。两派都记住了你的中立，日后或许有用。';
        }}
      ] },

    { id: 'se16', gl: 108, title: '秘 境 争 夺',
      lines: ['你与另一名修士同时发现一处秘境入口。', '他提议："你我各凭本事，生死勿论。"'],
      choices: [
        { t: '决斗', run: function (s) {
          var win = Math.random() > 0.4;
          if (win) {
            s.items['百年灵芝'] = (s.items['百年灵芝'] || 0) + 2;
            s.qi = (s.qi || 0) + 2000;
            return '你赢了。秘境中得两株灵芝，灵气大增。';
          } else {
            s.hp = Math.max(1, Math.round(s.hp * 0.3));
            return '你败了，重伤逃出。秘境与你无缘。';
          }
        }},
        { t: '提议平分', run: function (s) {
          s.items['百年灵芝'] = (s.items['百年灵芝'] || 0) + 1;
          s.qi = (s.qi || 0) + 1000;
          return '他同意了。你们各得一半，约定日后不再为敌。';
        }},
        { t: '放弃', run: function () {
          return '你转身就走。修仙路长，何必为一处秘境拼命。';
        }}
      ] },

    { id: 'se17', gl: 144, title: '妖 兽 护 幼',
      lines: ['你追杀一只重伤妖兽到洞口，发现洞里有三只幼崽。', '妖兽挡在洞前，眼中满是哀求。'],
      choices: [
        { t: '斩草除根', run: function (s) {
          s.items['妖骨'] = (s.items['妖骨'] || 0) + 4;
          s.stone = (s.stone || 0) + 400;
          return '你全杀了。妖骨和内丹都是好材料。';
        }},
        { t: '只杀成兽', run: function (s) {
          s.items['妖骨'] = (s.items['妖骨'] || 0) + 1;
          s.qi = (s.qi || 0) + 800;
          return '你杀了妖兽，放过幼崽。走出百步，听见幼崽的哀鸣声。';
        }},
        { t: '全部放过', run: function () {
          return '你转身离开。那妖兽叼起幼崽，消失在密林深处。';
        }}
      ] },

    { id: 'se18', gl: 180, title: '古 卷 疑 云',
      lines: ['你在废墟中找到一卷古法，记载着一门威力惊人的禁术。', '卷末警告："此术伤天和，修之必遭天谴。"'],
      choices: [
        { t: '修炼禁术', run: function (s) {
          s.items['聚灵珠'] = (s.items['聚灵珠'] || 0) + 1;
          s.ageBonus = (s.ageBonus || 0) + 5;
          return '你修成了禁术。实力大增，但总觉得冥冥中有什么在盯着你。';
        }},
        { t: '只参不修', run: function (s) {
          s.qi = (s.qi || 0) + 2500;
          return '你参透其理，融入自己的功法。威力虽不及禁术，但没有后患。';
        }},
        { t: '焚毁古卷', run: function (s) {
          s.stone = (s.stone || 0) + 200;
          return '你把古卷烧了。这种东西，不该留在世上。';
        }}
      ] },

    { id: 'se19', gl: 216, title: '师 兄 之 死',
      lines: ['你最信任的师兄死了，遗物中有一封信："我死后，替我照顾我的妻儿。"', '但你知道，他的仇家还在找他的家人。'],
      choices: [
        { t: '庇护遗孤', run: function (s) {
          s.stone -= 500;
          s.qi = (s.qi || 0) + 3000;
          return '你接下了这个担子。从此多了牵挂，但也多了动力。';
        }},
        { t: '送钱就走', run: function (s) {
          s.stone -= 200;
          return '你给了一笔钱，让他们远走他乡。这是你能做的全部。';
        }},
        { t: '烧掉遗信', run: function () {
          return '你把信烧了。师兄的仇家太强，你保不了他们。';
        }}
      ] },

    { id: 'se20', gl: 252, title: '魔 修 邀 约',
      lines: ['一名魔修找上门来："你我境界相当，何不联手？这世道，正道的规矩太多。"', '他的提议很诱人——共享资源，不受约束。'],
      choices: [
        { t: '答应联手', run: function (s) {
          s.stone = (s.stone || 0) + 600;
          s.items['血精'] = (s.items['血精'] || 0) + 5;
          return '你们结成同盟。修炼速度大增，但你知道，这条路很难回头了。';
        }},
        { t: '婉拒', run: function (s) {
          s.qi = (s.qi || 0) + 2000;
          return '你婉言拒绝。魔修笑了笑："日后若改主意，随时来找我。"';
        }},
        { t: '举报魔修', run: function (s) {
          s.stone = (s.stone || 0) + 400;
          return '你把他引到埋伏圈。执法堂给了你奖励，但你总觉得有什么变了。';
        }}
      ] },

    { id: 'se21', gl: 288, title: '天 劫 借 力',
      lines: ['渡劫时，你发现附近有人正在布置法阵，想借你的天劫炼器。', '"道友，我这法阵能帮你分担三成雷劫之力。"'],
      choices: [
        { t: '同意', run: function (s) {
          s.items['道纹剑'] = (s.items['道纹剑'] || 0) + 1;
          s.qi = (s.qi || 0) + 3500;
          return '他的法阵确实有效。渡劫后，他赠你一柄「道纹剑」作为谢礼。';
        }},
        { t: '拒绝', run: function (s) {
          s.qi = (s.qi || 0) + 2500;
          return '你独自渡劫，虽然艰难，但心境更加圆满。';
        }}
      ] },

    { id: 'se22', gl: 324, title: '记 忆 残 片',
      lines: ['你捡到一块记忆晶石，里面封存着一段前世的记忆。', '那个"你"曾经做过一件大错特错的事。'],
      choices: [
        { t: '融合记忆', run: function (s) {
          s.qi = (s.qi || 0) + 4000;
          s.ageBonus = (s.ageBonus || 0) + 3;
          return '你融合了记忆。那些经验帮助很大，但那份愧疚也一起传来了。';
        }},
        { t: '封印记忆', run: function (s) {
          s.stone = (s.stone || 0) + 800;
          return '你把晶石封印。前世是前世，今生是今生。';
        }},
        { t: '碎掉晶石', run: function () {
          return '你捏碎了晶石。有些事，不知道比知道更好。';
        }}
      ] },

    { id: 'se23', gl: 360, title: '界 门 守 卫',
      lines: ['界门前，一名老者拦住你："灵界不是想来就来的地方。"', '他要你证明自己有资格进入更高的世界。'],
      choices: [
        { t: '展示实力', run: function (s) {
          s.qi = (s.qi || 0) + 3000;
          return '你全力出手。老者点头放行："不错，有这个境界。"';
        }},
        { t: '贿赂', run: function (s) {
          s.stone -= 1000;
          s.items['灵玉'] = (s.items['灵玉'] || 0) + 2;
          return '你塞了一笔灵石。老者收下，给了你两块灵玉作为"入界礼"。';
        }},
        { t: '转身就走', run: function () {
          return '你转身离开。界门还在，你总会回来的。';
        }}
      ] },

    { id: 'se24', gl: 396, title: '仙 府 选 择',
      lines: ['你找到一座仙府遗迹，有三扇门：左门刻"力"、中门刻"智"、右门刻"缘"。', '只能选一扇，其余两扇会永久关闭。'],
      choices: [
        { t: '力之门', run: function (s) {
          s.items['方天戟'] = (s.items['方天戟'] || 0) + 1;
          return '门后是一柄「方天戟」，威力惊人。';
        }},
        { t: '智之门', run: function (s) {
          s.qi = (s.qi || 0) + 5000;
          return '门后是一座藏书阁，你在其中悟道数日。';
        }},
        { t: '缘之门', run: function (s) {
          s.items['寒星项链'] = (s.items['寒星项链'] || 0) + 1;
          s.stone = (s.stone || 0) + 1200;
          return '门后有一枚「寒星项链」和一笔灵石，还有一封信："有缘人，愿你道途顺遂。"';
        }}
      ] },

    { id: 'se25', gl: 432, title: '道 侣 之 约',
      lines: ['一名女修找到你："我需要一个道侣，共同面对化神雷劫。"', '她的提议很正式——互助渡劫，事成之后各走各路。'],
      choices: [
        { t: '答应', run: function (s) {
          s.qi = (s.qi || 0) + 6000;
          s.items['白玉如意'] = (s.items['白玉如意'] || 0) + 1;
          return '你们结成道侣。渡劫时，她替你挡下致命一击。事后，她留下「白玉如意」，转身离去。';
        }},
        { t: '婉拒', run: function (s) {
          s.qi = (s.qi || 0) + 3000;
          return '你婉拒了。修仙路上，还是靠自己比较稳妥。';
        }}
      ] },

    { id: 'se26', gl: 468, title: '飞 升 之 选',
      lines: ['你站在飞升台前。有人说："飞升后就是仙界的底层，不如留在人间做祖师。"', '留下来，你将是这个世界的天花板。飞升，你将重新从底层开始。'],
      choices: [
        { t: '飞升', run: function (s) {
          s.qi = (s.qi || 0) + 8000;
          return '你踏上飞升台。天地之间，唯有向前。';
        }},
        { t: '留下', run: function (s) {
          s.stone = (s.stone || 0) + 2000;
          s.items['道纹甲'] = (s.items['道纹甲'] || 0) + 1;
          return '你选择留下。成为这个世界的守护者，也不错。';
        }}
      ] },

    { id: 'se27', gl: 540, title: '道 源 指 引',
      lines: ['道界深处，你遇到一位道祖化身："你有三个选择——力量、智慧、还是寿元？"', '每种都能让你的修行更进一步，但只能选一个。'],
      choices: [
        { t: '力量', run: function (s) {
          s.items['道纹剑'] = (s.items['道纹剑'] || 0) + 1;
          return '你选择了力量。道祖点头："力能破万法。"';
        }},
        { t: '智慧', run: function (s) {
          s.qi = (s.qi || 0) + 10000;
          return '你选择了智慧。道祖微笑："智者不惑。"';
        }},
        { t: '寿元', run: function (s) {
          s.ageBonus = (s.ageBonus || 0) - 20;
          return '你选择了寿元。道祖叹息："时间是最珍贵的。"';
        }}
      ] },

    { id: 'se28', gl: 600, title: '轮 回 终 点',
      lines: ['你走到了修仙路的尽头。前方是虚无，也是一切的起点。', '有个声音问你："满意这一世吗？"'],
      choices: [
        { t: '满意', run: function (s) {
          s.qi = (s.qi || 0) + 15000;
          return '你点头："无愧于心。"声音笑了："那就继续走下去吧。"';
        }},
        { t: '不满意', run: function (s) {
          s.stone = (s.stone || 0) + 3000;
          return '你摇头："还有很多遗憾。"声音说："那下一世，做得更好。"';
        }},
        { t: '不知道', run: function () {
          return '你沉默了。声音说："这就是答案。"';
        }}
      ] },

    /* ===== v0.76.0 阶段八：第二批机缘事件扩展（se29-se43）===== */

    { id: 'se29', gl: 60, title: '老 人 求 药',
      lines: ['一位老人拦住你："我孙儿病重，求仙长赐一枚疗伤丹。"', '你包里正好有一枚回春丹，但那是你为突破准备的。'],
      choices: [
        { t: '赠药', run: function (s) {
          if (has(s, '回春丁')) { take(s, '回春丹'); return '你给了老人回春丹。老人千恩万谢，你心中也轻松了些。'; }
          return '你摸了摸药囊，已经没有了。老人失望地走了。';
        }},
        { t: '拒绝', run: function (s) {
          s.stone = (s.stone || 0) + 150;
          return '你给了些灵石让他去买。你知道，灵石买不到好药。';
        }}
      ] },

    { id: 'se30', gl: 96, title: '山 贼 劫 道',
      lines: ['一伙山贼拦路："此山是我开，此树是我栽！"', '为首的看着你，犹豫了："这位修仙的，您看……"'],
      choices: [
        { t: '给钱放行', run: function (s) {
          s.stone -= 100;
          return '你扔了一袋灵石。山贼让开了路。';
        }},
        { t: '出手教训', run: function (s) {
          s.items['兽皮'] = (s.items['兽皮'] || 0) + 3;
          return '你出手制服了山贼。搜出些兽皮和杂物。';
        }},
        { t: '劝其改邪归正', run: function (s) {
          s.qi = (s.qi || 0) + 800;
          return '你晓以大义。为首的跪下："多谢仙长点化！"';
        }}
      ] },

    { id: 'se31', gl: 120, title: '同 门 竞 争',
      lines: ['师门选拔真传弟子，你与师弟竞争最后一个名额。', '师弟找到你："师兄，我愿让出名额，但我家人需要宗门庇护……"'],
      choices: [
        { t: '接受让位', run: function (s) {
          s.stone = (s.stone || 0) + 500;
          s.items['精钢'] = (s.items['精钢'] || 0) + 3;
          return '你成为真传，得到资源。但看着师弟的眼神，你心里不是滋味。';
        }},
        { t: '拒绝让位', run: function (s) {
          s.qi = (s.qi || 0) + 2000;
          return '你说："我们公平竞争。"最终你以实力取胜，师弟也心服口服。';
        }},
        { t: '推荐师弟', run: function (s) {
          s.qi = (s.qi || 0) + 1500;
          return '你向长老推荐师弟。长老破例收了你们两人为真传。';
        }}
      ] },

    { id: 'se32', gl: 156, title: '妖 兽 报 恩',
      lines: ['你救过的那只妖兽找到你，叼来一枚内丹："恩人，这是我省下的。"', '那内丹对你很有用，但你知道，那是它修行的根基。'],
      choices: [
        { t: '收下内丹', run: function (s) {
          s.qi = (s.qi || 0) + 2500;
          return '你收下了内丹。妖兽开心地走了，但你看出它修为跌落了一个境界。';
        }},
        { t: '婉拒', run: function (s) {
          s.items['妖骨'] = (s.items['妖骨'] || 0) + 2;
          return '你拒绝了。妖兽执意要报恩，留下两块妖骨后消失在密林中。';
        }}
      ] },

    { id: 'se33', gl: 192, title: '魔 宝 诱 惑',
      lines: ['你在古战场废墟中发现一件魔宝，威力惊人。', '但它上面沾满血煞之气，使用它可能会入魔。'],
      choices: [
        { t: '炼化魔宝', run: function (s) {
          s.items['血煞剑'] = (s.items['血煞剑'] || 0) + 1;
          s.ageBonus = (s.ageBonus || 0) + 4;
          return '你炼化了魔宝。威力确实惊人，但你常做噩梦。';
        }},
        { t: '净化后使用', run: function (s) {
          s.stone -= 300;
          s.items['道纹剑'] = (s.items['道纹剑'] || 0) + 1;
          return '你花费大量灵石净化魔宝。虽然威力减弱，但用起来心安。';
        }},
        { t: '销毁魔宝', run: function (s) {
          s.qi = (s.qi || 0) + 1800;
          return '你摧毁了魔宝。这种东西，留在世上就是祸害。';
        }}
      ] },

    { id: 'se34', gl: 228, title: '宗 门 危 机',
      lines: ['宗门遭到强敌围攻，掌门下令："愿留者留，愿走者走，绝不强求。"', '你知道留下来九死一生，但你也知道宗门养育之恩。'],
      choices: [
        { t: '留下死战', run: function (s) {
          var survive = Math.random() > 0.3;
          if (survive) {
            s.items['聚灵珠'] = (s.items['聚灵珠'] || 0) + 1;
            s.qi = (s.qi || 0) + 4000;
            return '你拼死一战，宗门守住了。战后你被封为护法长老。';
          } else {
            s.hp = Math.max(1, Math.round(s.hp * 0.2));
            s.qi = (s.qi || 0) + 2000;
            return '你重伤垂死，被同门救出。宗门虽破，但情义还在。';
          }
        }},
        { t: '离开', run: function (s) {
          s.stone = (s.stone || 0) + 600;
          return '你带着部分弟子撤退。活着，才有希望重建。';
        }}
      ] },

    { id: 'se35', gl: 264, title: '天 才 少 年',
      lines: ['你遇到一个天赋惊人的少年，求你收他为徒。', '你看得出来，他将来成就必定在你之上。'],
      choices: [
        { t: '收为弟子', run: function (s) {
          s.qi = (s.qi || 0) + 3500;
          return '你收他为徒。教学相长，你的修为也有所突破。';
        }},
        { t: '推荐他人', run: function (s) {
          s.stone = (s.stone || 0) + 500;
          return '你推荐他去找更强的师父。少年感激地离开了。';
        }},
        { t: '拒绝', run: function () {
          return '你拒绝了。你还没准备好承担传承的责任。';
        }}
      ] },

    { id: 'se36', gl: 300, title: '心 魔 劫',
      lines: ['渡劫时，你的心魔化形而出，质问你："你真的无愧于心吗？"', '它列举你一路走来的所有选择。'],
      choices: [
        { t: '坦然面对', run: function (s) {
          s.qi = (s.qi || 0) + 5000;
          return '你说："我问心无愧。"心魔散去，你的道心更加坚定。';
        }},
        { t: '压制心魔', run: function (s) {
          s.qi = (s.qi || 0) + 3000;
          s.ageBonus = (s.ageBonus || 0) + 5;
          return '你强行压制心魔。虽然过关了，但它还藏在心底深处。';
        }}
      ] },

    { id: 'se37', gl: 336, title: '古 修 传 承',
      lines: ['你找到一处上古修士的传承洞府，里面有完整的功法和法宝。', '但守护灵要求你立誓："得我传承者，必守我道统，不得入魔。"'],
      choices: [
        { t: '立誓', run: function (s) {
          s.items['八卦盘'] = (s.items['八卦盘'] || 0) + 1;
          s.qi = (s.qi || 0) + 6000;
          return '你立下誓言。得到传承，但从此多了一份责任。';
        }},
        { t: '拒绝立誓', run: function (s) {
          s.stone = (s.stone || 0) + 1000;
          return '你拒绝立誓。守护灵叹息，给了些灵石作为补偿。';
        }}
      ] },

    { id: 'se38', gl: 372, title: '生 死 抉 择',
      lines: ['你和道友被困绝地，只有一人能活着出去。', '道友说："你走，我留下。你比我更有希望突破元婴。"'],
      choices: [
        { t: '接受牺牲', run: function (s) {
          s.qi = (s.qi || 0) + 7000;
          s.items['白玉如意'] = (s.items['白玉如意'] || 0) + 1;
          return '你含泪离开。后来你突破元婴，为道友立了衣冠冢。';
        }},
        { t: '一起拼', run: function (s) {
          var both = Math.random() > 0.5;
          if (both) {
            s.qi = (s.qi || 0) + 5000;
            return '你们拼死一搏，竟然都活了下来。患难见真情。';
          } else {
            s.hp = Math.max(1, Math.round(s.hp * 0.3));
            s.qi = (s.qi || 0) + 3000;
            return '你们拼尽全力，但道友还是没能撑住。你重伤逃出。';
          }
        }}
      ] },

    { id: 'se39', gl: 408, title: '魔 道 大 战',
      lines: ['正魔大战爆发，双方都在征召修士。', '你知道这是一场没有赢家的战争。'],
      choices: [
        { t: '加入正道', run: function (s) {
          s.stone = (s.stone || 0) + 1200;
          s.items['道纹甲'] = (s.items['道纹甲'] || 0) + 1;
          return '你加入正道联盟。虽然艰苦，但你坚信这是对的。';
        }},
        { t: '保持中立', run: function (s) {
          s.qi = (s.qi || 0) + 4000;
          return '你选择中立，专心修炼。战争与你无关。';
        }},
        { t: '调停双方', run: function (s) {
          var peace = Math.random() > 0.7;
          if (peace) {
            s.qi = (s.qi || 0) + 8000;
            return '你奔走调停。虽然很难，但最终促成了停战。';
          } else {
            s.hp = Math.max(1, Math.round(s.hp * 0.4));
            return '你尝试调停，却被双方都视为敌人。你重伤逃离。';
          }
        }}
      ] },

    { id: 'se40', gl: 444, title: '时 空 裂 缝',
      lines: ['你发现一道时空裂缝，可以窥见过去。', '你看到了改变命运的关键时刻，有机会穿越回去改变一切。'],
      choices: [
        { t: '穿越回去', run: function (s) {
          s.qi = (s.qi || 0) + 6000;
          s.ageBonus = (s.ageBonus || 0) + 10;
          return '你穿越回去改变了一个选择。回到现在，一切都不一样了。';
        }},
        { t: '不改变', run: function (s) {
          s.qi = (s.qi || 0) + 5000;
          return '你选择不改变。每个选择都造就了现在的你。';
        }}
      ] },

    { id: 'se41', gl: 504, title: '仙 界 邀 请',
      lines: ['一位仙人降临："你有资格进入仙界，但需放弃人间的一切。"', '你想起人间还有未了的牵挂。'],
      choices: [
        { t: '立即飞升', run: function (s) {
          s.qi = (s.qi || 0) + 10000;
          return '你斩断牵挂，踏入仙界。新的征程开始了。';
        }},
        { t: '了结牵挂', run: function (s) {
          s.stone = (s.stone || 0) + 2000;
          s.qi = (s.qi || 0) + 6000;
          return '仙人同意等你。你回人间了结牵挂，三年后飞升。';
        }},
        { t: '留在人间', run: function (s) {
          s.items['道纹剑'] = (s.items['道纹剑'] || 0) + 1;
          return '你拒绝飞升。仙界虽好，但人间才是你的根。';
        }}
      ] },

    { id: 'se42', gl: 576, title: '道 祖 考 验',
      lines: ['道祖化身出现："你已走到这一步，还有最后一个考验。"', '他要你在力量和智慧之间选择。'],
      choices: [
        { t: '力量', run: function (s) {
          s.items['道纹戟'] = (s.items['道纹戟'] || 0) + 1;
          s.qi = (s.qi || 0) + 12000;
          return '道祖点头："力量是根本。"你得到一柄「道纹戟」。';
        }},
        { t: '智慧', run: function (s) {
          s.qi = (s.qi || 0) + 15000;
          return '道祖微笑："智慧是永恒。"你顿悟大道真谛。';
        }},
        { t: '两者皆要', run: function (s) {
          var succeed = Math.random() > 0.5;
          if (succeed) {
            s.items['道祖令'] = (s.items['道祖令'] || 0) + 1;
            s.qi = (s.qi || 0) + 18000;
            return '道祖大笑："好！这才是我要的传人！"';
          } else {
            s.qi = (s.qi || 0) + 8000;
            return '道祖摇头："贪心了。"你只得到部分传承。';
          }
        }}
      ] },

    { id: 'se43', gl: 648, title: '终 极 选 择',
      lines: ['你站在天道之门前。门内是真正的永生，但你将失去所有记忆。', '门外是轮回，你将带着所有经历重新开始。'],
      choices: [
        { t: '进入永生', run: function (s) {
          s.qi = (s.qi || 0) + 20000;
          return '你推开天道之门。一切归于虚无，又归于永恒。';
        }},
        { t: '选择轮回', run: function (s) {
          s.stone = (s.stone || 0) + 5000;
          s.qi = (s.qi || 0) + 15000;
          return '你转身走向轮回。下一世，你会做得更好。';
        }},
        { t: '创造第三条路', run: function (s) {
          s.items['道源石'] = (s.items['道源石'] || 0) + 1;
          s.qi = (s.qi || 0) + 25000;
          return '你以无上神通开辟第三条路——保留记忆的永生！';
        }}
      ] },

    /* ===== v0.76.0 阶段八：第三批机缘事件扩展（se44-se50）===== */

    { id: 'se44', gl: 84, title: '洞 府 争 夺',
      lines: ['你发现一座无主洞府，里面灵气充裕。但另一位散修也看中了这里。', '他提议决斗，胜者得洞府。'],
      choices: [
        { t: '接受决斗', run: function (s) {
          var win = Math.random() > 0.4;
          if (win) {
            s.stone = (s.stone || 0) + 800;
            s.qi = (s.qi || 0) + 2500;
            return '你赢了决斗，得到洞府。接下来三年，修炼速度大增。';
          } else {
            s.hp = Math.max(1, s.hp * 0.6);
            return '你败了，身受重伤。对方饶你一命，但夺走了洞府。';
          }
        }},
        { t: '共享洞府', run: function (s) {
          s.stone = (s.stone || 0) + 400;
          s.qi = (s.qi || 0) + 1500;
          return '你提议两人共享洞府。他同意了，你们成为道友。';
        }},
        { t: '放弃洞府', run: function (s) {
          s.stone = (s.stone || 0) + 200;
          return '你放弃洞府，继续游历。三个月后，你得知那座洞府是陷阱，进入者皆死。';
        }}
      ] },

    { id: 'se45', gl: 132, title: '师 门 叛 徒',
      lines: ['你的师弟暗中勾结魔修，出卖宗门情报。', '师父重伤，临终前让你决定如何处置师弟。'],
      choices: [
        { t: '清理门户', run: function (s) {
          s.items['师父遗物'] = (s.items['师父遗物'] || 0) + 1;
          s.qi = (s.qi || 0) + 3500;
          return '你亲手清理门户。师父含笑而逝："你做得对。"';
        }},
        { t: '废除修为', run: function (s) {
          s.stone = (s.stone || 0) + 1200;
          s.qi = (s.qi || 0) + 2800;
          return '你废掉师弟修为，将他逐出师门。他发誓报复，但你不后悔。';
        }},
        { t: '饶他一命', run: function (s) {
          s.stone = (s.stone || 0) + 600;
          return '你念及同门之情，放他离开。十年后，他重回正道，感激涕零。';
        }}
      ] },

    { id: 'se46', gl: 204, title: '上 古 遗 迹',
      lines: ['你误入上古遗迹，发现三座石碑，分别记载剑道、阵法、炼丹。', '你只有时间参悟一座。'],
      choices: [
        { t: '剑道石碑', run: function (s) {
          s.items['剑意真解'] = (s.items['剑意真解'] || 0) + 1;
          s.qi = (s.qi || 0) + 5000;
          return '你参悟剑道，领悟一丝剑意。从此，攻击力大增。';
        }},
        { t: '阵法石碑', run: function (s) {
          s.items['阵图残卷'] = (s.items['阵图残卷'] || 0) + 1;
          s.qi = (s.qi || 0) + 4500;
          return '你参悟阵法，学会布置简单阵法。这将在未来救你一命。';
        }},
        { t: '炼丹石碑', run: function (s) {
          s.items['丹方秘录'] = (s.items['丹方秘录'] || 0) + 1;
          s.stone = (s.stone || 0) + 2000;
          return '你参悟炼丹，学会炼制筑基丹。从此，灵石收入大增。';
        }}
      ] },

    { id: 'se47', gl: 276, title: '天 材 地 宝',
      lines: ['你发现一株千年灵芝，但它被一只元婴期妖兽守护。', '妖兽开口："此物是我孩儿的救命药。你若要，拿命来换。"'],
      choices: [
        { t: '强行夺取', run: function (s) {
          var survive = Math.random() > 0.3;
          if (survive) {
            s.items['千年灵芝'] = (s.items['千年灵芝'] || 0) + 1;
            s.hp = Math.max(1, s.hp * 0.4);
            return '你拼死夺得灵芝，但身受重伤。妖兽发誓追杀你至天涯海角。';
          } else {
            s.hp = 1;
            s.qi = Math.max(0, s.qi - 5000);
            return '你败了，妖兽饶你不死，但夺走你所有灵气。';
          }
        }},
        { t: '协商交换', run: function (s) {
          s.stone = (s.stone || 0) - 3000;
          s.items['千年灵芝'] = (s.items['千年灵芝'] || 0) + 1;
          return '你拿出所有灵石，换得灵芝一半。妖兽感激，送你一枚妖丹。';
        }},
        { t: '放弃离开', run: function (s) {
          s.qi = (s.qi || 0) + 3000;
          return '你放弃灵芝，离开此地。妖兽感念你的善心，传你一门妖族秘法。';
        }}
      ] },

    { id: 'se48', gl: 348, title: '时 空 乱 流',
      lines: ['你被卷入时空乱流，看到三个时间节点：', '过去的自己正要做出错误决定；未来的自己身陷绝境；另一个平行世界的自己已成魔修。'],
      choices: [
        { t: '改变过去', run: function (s) {
          s.items['时空碎片'] = (s.items['时空碎片'] || 0) + 1;
          s.qi = (s.qi || 0) + 8000;
          return '你改变了过去，但引发了时间悖论。你得到了力量，却失去了部分记忆。';
        }},
        { t: '拯救未来', run: function (s) {
          s.stone = (s.stone || 0) + 4000;
          s.qi = (s.qi || 0) + 7000;
          return '你拯救了未来的自己，时间线稳定。未来的你留下一份宝物。';
        }},
        { t: '度化魔修', run: function (s) {
          s.items['双生魔种'] = (s.items['双生魔种'] || 0) + 1;
          s.qi = (s.qi || 0) + 10000;
          return '你度化了另一个自己，吸收了他的魔性。你变得更强，但也更接近魔道。';
        }}
      ] },

    { id: 'se49', gl: 420, title: '仙 魔 大 战',
      lines: ['仙魔大战爆发，仙盟召集所有仙人参战。', '你已是大乘期修士，但战场凶险，生死难料。'],
      choices: [
        { t: '加入仙盟', run: function (s) {
          var survive = Math.random() > 0.4;
          if (survive) {
            s.items['仙盟令'] = (s.items['仙盟令'] || 0) + 1;
            s.qi = (s.qi || 0) + 12000;
            return '你在战场上立下赫赫战功，得到仙盟重赏。';
          } else {
            s.hp = Math.max(1, s.hp * 0.3);
            s.qi = (s.qi || 0) + 6000;
            return '你身受重伤，险些陨落。战后，你闭关百年才恢复。';
          }
        }},
        { t: '保持中立', run: function (s) {
          s.stone = (s.stone || 0) + 3000;
          return '你选择中立，远离战场。仙魔两道都视你为叛徒，但你保住了性命。';
        }},
        { t: '暗助魔道', run: function (s) {
          s.items['魔主令'] = (s.items['魔主令'] || 0) + 1;
          s.qi = (s.qi || 0) + 15000;
          return '你暗中帮助魔道，得到魔主赏识。但你从此踏上不归路。';
        }}
      ] },

    { id: 'se50', gl: 516, title: '道 心 之 问',
      lines: ['你即将飞升，但天道问你：', '"你修道至今，为的是什么？长生？力量？还是超脱？"'],
      choices: [
        { t: '为了长生', run: function (s) {
          s.items['长生石'] = (s.items['长生石'] || 0) + 1;
          s.qi = (s.qi || 0) + 18000;
          return '天道认可你的答案。你得到「长生石」，寿元大增。';
        }},
        { t: '为了力量', run: function (s) {
          s.items['力量源泉'] = (s.items['力量源泉'] || 0) + 1;
          s.qi = (s.qi || 0) + 20000;
          return '天道认可你的答案。你得到「力量源泉」，修为暴涨。';
        }},
        { t: '为了超脱', run: function (s) {
          s.items['道心舍利'] = (s.items['道心舍利'] || 0) + 1;
          s.qi = (s.qi || 0) + 25000;
          return '天道大笑："此乃真道！"你顿悟大道，直接飞升上界。';
        }},
        { t: '为了守护', run: function (s) {
          s.items['守护之心'] = (s.items['守护之心'] || 0) + 1;
          s.stone = (s.stone || 0) + 5000;
          s.qi = (s.qi || 0) + 22000;
          return '天道沉默片刻："你的道，比我更高。"你成为天道守护者。';
        }}
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
