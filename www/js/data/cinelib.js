/* ============================================================
 * CineLib 剧情过场库（v0.85.0）
 * 按 arc 世 id 与结局 id 返回 G.Cutscene 可播的镜头序列。
 *   · imgs：高清静帧（Ken Burns），为全平台统一兜底
 *   · video：AI 生成视频（仅真实浏览器播放，缺则自动走静帧）
 * 字幕用短句补情绪，不与正文对白重复。
 * ============================================================ */
(function () {
  var ARC = {
    arc1: [
      { imgs: ['cine.fan_raid'], video: 'assets/video/cine_fan_raid.mp4', dur: 4.6,
        captions: [{ t: 0.3, text: '那一夜，火光把白鹿礁外的海，都烧红了。' }] },
      { imgs: ['cine.fan_soul'], dur: 4.6,
        captions: [{ t: 0.3, text: '他没能护住爷爷，也没能抓住，她离体的那缕魂。' }] }
    ],
    arc2: [
      { imgs: ['cine.shanmen'], dur: 5.2,
        video: 'assets/video/cine_shanmen.mp4',
        captions: [
          { t: 0.3, text: '问罪之下，师父横身挡在他身前，像一座不倒的山。' },
          { t: 3.0, text: '「活下去——别回头。」' }
        ] }
    ],
    arc3: [
      { imgs: ['cine.daolv'], video: 'assets/video/cine_daolv.mp4', dur: 5.2,
        captions: [
          { t: 0.3, text: '心劫落下的那一刻，她先一步，张开了双臂。' },
          { t: 3.0, text: '「这一世，我很欢喜。」' }
        ] }
    ],
    arc4: [
      { imgs: ['cine.tianlun'], dur: 5.2,
        video: 'assets/video/cine_tianlun.mp4',
        captions: [
          { t: 0.3, text: '天妒连降，他分寿、割果，三挡，三败。' },
          { t: 3.0, text: '而那孩子，却自己走向了那片黑。' }
        ] }
    ],
    arc5: [
      { imgs: ['cine.xinhuo'], dur: 5.2,
        captions: [
          { t: 0.3, text: '他终于懂了——一个人会朽，道，不会。' },
          { t: 3.0, text: '他埋下一粒种，等后来人，长成春天。' }
        ] }
    ]
  };

  var ENDING = {
    dream: [
      { imgs: ['cine.chenmeng'], dur: 5.4,
        captions: [
          { t: 0.3, text: '他选择入梦，与残影相守，再不肯醒。' },
          { t: 3.1, text: '镜花水月——于他，也算一场团圆。' }
        ] }
    ],
    release: [
      { imgs: ['cine.fangshou'], video: 'assets/video/cine_fangshou.mp4', dur: 5.8,
        captions: [
          { t: 0.3, text: '他以道果、以逆命珠为祭，送牵挂者，重入新生。' },
          { t: 3.2, text: '逆尘而去，自碎长生，归于尘芥。' }
        ] }
    ],
    defy: [
      { imgs: ['cine.jingsui'], dur: 5.0,
        captions: [
          { t: 0.3, text: '云幕深处，那只冷眼，碎了。' },
          { t: 3.0, text: '维系诸世的规则，一道一道崩断。' }
        ] },
      { imgs: ['cine.zhaohun'], dur: 5.0,
        captions: [
          { t: 0.3, text: '他燃尽自己，送所有魂魄，入了自由轮回。' },
          { t: 3.0, text: '这一次，我不求团圆。' }
        ] }
    ]
  };

  G.CineLib = {
    forArc: function (id) {
      var a = ARC[id];
      return a ? a.map(function (s) { return { imgs: s.imgs, video: s.video || null, dur: s.dur, captions: s.captions }; }) : null;
    },
    forEnding: function (id) {
      var e = ENDING[id];
      return e ? e.map(function (s) { return { imgs: s.imgs, video: s.video || null, dur: s.dur, captions: s.captions }; }) : null;
    }
  };
})();
