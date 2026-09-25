/* 翠微山：探索引擎包装；山神庙是一栋可以走进去的房子（室内地图 field_temple） */
(function () {
  var hooks = {};
  hooks.menu = function (scene) { G.TianDao.openMenu(scene); };
  hooks.overlayTap = G.TianDao.overlayTap;
  hooks.overlayKey = G.TianDao.overlayKey;

  hooks.onInteract = function (o, scene) {
    if (o.type !== 'ruin') return;
    var q = G.game.save.quest;
    if (q.step === 'm0-1') { G.game.toast('一座破败山神庙，庙门紧闭'); return; }
    scene._transition({ to: 'field_temple', spawn: G.Data.maps.field_temple.spawn });
  };

  hooks.renderOverlay = function (x, scene) {
    if (scene.overlay === 'menu' || scene.overlay === 'tiandao') {
      G.TianDao.renderOverlay(x, scene);
      return;
    }
    if (scene.overlay === 'temple') {
      G.Overlays.frame(x, '雪夜 · 山神庙');
      var lines = [
        '大雪夜，你避雪山神庙。庙中一重伤老者，',
        '怀中紧紧护着一枚' + G.game.save.world.vessel + '。',
        '老者将珠塞入你手中，气绝而亡。',
        '庙门骤开，一黑衣杀手提刀而立：',
        '“小子，把东西交出来，留你全尸。”'
      ];
      lines.forEach(function (l, i) {
        G.UI.text(x, { x: 92, y: 78 + i * 24 }, l, 13, G.UI.C.text);
      });
    } else if (scene.overlay === 'char') {
      G.Overlays.renderChar(x);
    }
  };

  G.scenes.field = G.Explore.create('field', hooks);

  /* ===== 山神庙室内：进门即遇老者赠珠，杀手破门 ===== */
  function playTemple(scene) {
    scene.setOverlay('temple', [
      new G.UI.Btn({
        x: 150, y: 196, w: 180, h: 26, small: true, variant: 'gold',
        label: '血煞教杀手现身 · 迎战',
        onClick: function () {
          G.game.changeScene('battle', { script: 'killer', mapId: 'field' });
        }
      })
    ]);
  }

  G.scenes.field_temple = G.Explore.create('field_temple', {
    menu: function (scene) { G.TianDao.openMenu(scene); },
    overlayTap: G.TianDao.overlayTap,
    overlayKey: G.TianDao.overlayKey,
    /* 一进门就演：比"在庙外点一下弹面板"更符合"走进去探索" */
    enter: function (scene) {
      var save = G.game.save;
      if (!save) return;
      var q = save.quest;
      if (q.step === 'm0-2' && !q.flags.templeDone) playTemple(scene);
    },
    onInteract: function (o, scene) {
      if (o.type !== 'furn' || o.act !== 'temple') return;
      var q = G.game.save.quest;
      if (q.step === 'm0-2' && !q.flags.templeDone) { playTemple(scene); return; }
      if (q.flags.templeDone) { G.game.toast('神台上只剩一层薄灰'); return; }
      G.game.toast('神台空着，香灰早已冷透');
    },
    renderOverlay: hooks.renderOverlay
  });
})();
