/* 血煞外堂据点（M1 §5.1）：**一次性剧情图**。
   · 连战节点走 explore 的 onScriptBattle（走到格子即开战，节点表在 maps.js 的 special 里）
   · 堂中「血面」走 onInteract（抉择 2 → Boss 战）
   · 血夜落幕的遗言演出与任务转步由本场景的 enter 收口（场景是单例，用 flag 交接）

   ⚠️ 三条与别处不同的约定，改这里前先读：
   ① **禁逃靠显式 noFlee**：连战节点是普通敌群（无 script、无 boss 标记），
      只靠 `params.script` 兜底会漏掉 —— battle._noFlee() 已支持显式 noFlee。
   ② **节点先登记后开战**：`scriptBattlesDone` 在切图前就写入。battle 是单例、
      探索场景会重建地图，若等胜利再登记，中途退出会留下"已开打但没登记"的缝。
   ③ **任务步不在这里推**：battle 只写 `flags.bloodNight`，转 m1-6 由 enter 做。
      battle 结算时地图还没重建，在那边改任务步等于对着旧场景说话。 */
(function () {
  var hooks = {};
  hooks.menu = function (scene) { G.TianDao.openSettings(scene); };
  hooks.overlayTap = G.TianDao.overlayTap;
  hooks.overlayKey = G.TianDao.overlayKey;

  /* ===== 文本 ===== */
  var DIALOGS = {
    /* 血面开条件（抉择 2 之前）。台词按设计 §4：逼索老者遗物。 */
    choice2: {
      title: '血煞外堂 · 堂中', name: '执事·血面', portrait: 'xuemian',
      lines: [
        '血面立在堂中，面具下的声音很轻：“把珠子交出来。”',
        '“那老东西守着它一辈子，如今该换个主人了。”',
        '他抬手，堂外火把次第亮起 —— 镇子就在山下。'
      ],
      note: '这一念，会被记住。'
    },
    /* 沈伯遗言（固定，M1 §4）。 */
    farewell: {
      title: '血煞外堂 · 堂中', name: '沈伯', portrait: 'shenbo',
      lines: [
        '血面跪倒，眼里的红光散了。沈伯也倒了下去，道基燃尽，只剩一口气。',
        '他抓住你的手腕，力道轻得像一片雪。',
        '“别哭……药还在炉上……”',
        '“……好好活。”'
      ]
    },
    /* 抉择 1 = spare：阿七还命（M1 §4）。 */
    aqi: {
      title: '血煞外堂 · 堂外', name: '阿七', portrait: 'cultist',
      lines: [
        '阿七从阴影里走出来，手里攥着两张黄符。',
        '“这条命算还你了。”',
        '“据点塌了，我也不会再回来 —— 云州城，最好别让我再看见你。”'
      ],
      reward: '得 解封符 ×2'
    }
  };

  /* ===== 连战节点 ===== */
  function enemiesOf(sb) {
    return (sb.enemies || []).map(function (e) {
      return G.Data.makeEnemy(e.sp, e.lv);
    });
  }

  hooks.onScriptBattle = function (sb, scene) {
    var save = G.game.save;
    var done = save.scriptBattlesDone || (save.scriptBattlesDone = []);
    done.push(scene.mapId + ':' + sb.id);
    G.Storage.saveCurrent(save);
    G.game.changeScene('battle', {
      mapId: 'bloodhall', after: 'bloodhall',
      enemies: enemiesOf(sb), noFlee: true
    });
    return true;
  };

  /* ===== 抉择 2 + 血面 Boss ===== */
  function startBoss(scene, kind) {
    var save = G.game.save;
    save.quest.flags.choice2 = kind;
    /* 护沈伯先走：沈伯已回身缠斗过一阵 → 血面带伤开局（设计 §4）。
       镇子被焚只写 flag —— 废墟外观是 M2 的事（M1 不引新美术）。 */
    if (kind === 'leave') save.burned = true;
    G.Player.chronicle(save, 'choice2:' + kind,
      kind === 'stand' ? '血夜，你选择死战护镇' : '血夜，你护沈伯先走，镇子被焚');
    G.Storage.saveCurrent(save);
    scene.clearOverlay();
    G.game.changeScene('battle', {
      script: 'xuemian', mapId: 'bloodhall', after: 'bloodhall',
      bossHpPct: kind === 'leave' ? 0.6 : 1
    });
  }

  function openChoice2(scene) {
    var a = new G.UI.Btn({
      x: 26, y: 176, w: 428, h: 24, small: true, variant: 'gold',
      label: '护镇死战 · 不交珠',
      onClick: function () { startBoss(scene, 'stand'); }
    });
    var b = new G.UI.Btn({
      x: 26, y: 200, w: 428, h: 24, small: true, variant: 'danger',
      label: '护沈伯先走 · 假意应承',
      onClick: function () { startBoss(scene, 'leave'); }
    });
    scene.setOverlay('choice2', [a, b]);
  }

  hooks.onInteract = function (o, scene) {
    if (o.type !== 'boss' || o.id !== 'xuemian') return;
    var q = G.game.save.quest;
    /* 血夜已了：Boss 物件还留在图上，但不能再打一次（会重复发奖）。 */
    if (q.flags.bloodNight) { G.game.toast('据点已塌，只剩焦土'); return; }
    if (q.flags.choice2) return;              /* 抉择已做过、正在打：不重复弹卡 */
    openChoice2(scene);
  };

  /* ===== 进门钩子：遗言演出 → 阿七还命 → 转 m1-6 ===== */
  function aqiBtn(scene) {
    return new G.UI.Btn({
      x: 190, y: 214, w: 100, h: 24, small: true, variant: 'gold', label: '接过',
      onClick: function () {
        var save = G.game.save;
        save.items['解封符'] = (save.items['解封符'] || 0) + 2;
        G.Storage.saveCurrent(save);
        G.game.toast('解封符 ×2 已入库');
        scene.clearOverlay();
      }
    });
  }

  hooks.enter = function (scene) {
    var save = G.game.save, q = save.quest;

    /* 血面已倒（battle 写的 flag）→ 沈伯遗言。用 farewell 自己的 flag 防重入：
       clearOverlay 会再存一次档，而 enter 可能因为换图被再调一次。 */
    if (q.flags.bloodNight && !q.flags.farewell) {
      q.flags.farewell = true;
      q.step = 'm1-6';
      G.Storage.saveCurrent(save);
      scene.setOverlay('farewell', [new G.UI.Btn({
        x: 190, y: 214, w: 100, h: 24, small: true, variant: 'gold', label: '合上他的眼',
        onClick: function () {
          scene.clearOverlay();
          /* 抉择 1 = spare：阿七还命（紧接着演，不占另一次 enter） */
          var q2 = G.game.save.quest;
          if (q2.flags.probe === 'spare' && !q2.flags.aqiDone) {
            q2.flags.aqiDone = true;
            G.Storage.saveCurrent(G.game.save);
            scene.setOverlay('aqi', [aqiBtn(scene)]);
          }
        }
      })]);
      return;
    }
  };

  hooks.renderOverlay = function (x, scene) {
    if (G.Overlays.route(x, scene)) return;
    if (scene.overlay === 'choice2') {
      G.Overlays.choice(x, DIALOGS.choice2);
      return;
    }
    var d = DIALOGS[scene.overlay];
    if (d) G.Overlays.dialog(x, d);
  };

  G.scenes.bloodhall = G.Explore.create('bloodhall', hooks);
})();
