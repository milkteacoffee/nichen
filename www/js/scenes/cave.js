/* 赤牙洞：探索引擎包装，狼王巢触发 Boss 战 */
(function () {
  var hooks = {};
  hooks.menu = function (scene) { G.TianDao.openMenu(scene); };
  hooks.overlayTap = G.TianDao.overlayTap;
  hooks.overlayKey = G.TianDao.overlayKey;

  hooks.onInteract = function (o, scene) {
    var save = G.game.save, q = save.quest;
    if (o.type === 'boss') {
      if (q.step === 'm0-5' && save.globalLevel >= 12) {
        G.game.changeScene('battle', {
          script: 'wolfKing', after: 'm0-5', mapId: 'cave'
        });
      } else {
        G.game.toast('洞深处传来可怖的妖兽威压，你不敢近前');
      }
    }
  };

  hooks.renderOverlay = function (x, scene) {
    if (G.TianDao.isMenuOverlay(scene.overlay)) {
      G.TianDao.renderOverlay(x, scene);
      return;
    }
    if (scene.overlay === 'char') G.Overlays.renderChar(x);
  };

  G.scenes.cave = G.Explore.create('cave', hooks);
})();
