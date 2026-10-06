# -*- coding: utf-8 -*-
"""E-A/E-B 表现补丁：
1) sprites.js：npc 增加 girl 配色；
2) arc.js：对话框立绘按目标高度自适应，正文右移避让；
3) arc1.js：热点标签移出小屋。"""
import io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:60])
        s = s.replace(a, b)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)

# 1) sprites.js girl 配色
patch(r'D:\Projects\nichen\www\js\core\sprites.js', [
("""    var cult = kind === 'cultist';
    var pal = {
      hair: kind === 'elder' ? '#cfccc0' : (cult ? '#231d24' : '#2b2833'),
      skin: '#e8b890',
      /* 主色与暗部**必须拉开明度**：只差一点点的话，程序化立绘会糊成一块红方块
         （第一版 6d3038 / 4a1f27 就是这样，远看像邮筒）。 */
      robe: kind === 'elder' ? '#6b7a68' : kind === 'keeper' ? '#7a6a52' : (cult ? '#7a343d' : '#8a8a92'),
      robeDark: kind === 'elder' ? '#4c5949' : kind === 'keeper' ? '#5a4d3a' : (cult ? '#3d171c' : '#66666e'),
      collar: cult ? '#c9a2a6' : '#e6ddc2', belt: '#5a4632', shoe: '#2c2a30'
    };""",
"""    var cult = kind === 'cultist';
    var girl = kind === 'girl';
    var pal = {
      hair: kind === 'elder' ? '#cfccc0' : (cult ? '#231d24' : (girl ? '#3a2a30' : '#2b2833')),
      skin: '#e8b890',
      /* 主色与暗部**必须拉开明度**：只差一点点的话，程序化立绘会糊成一块红方块
         （第一版 6d3038 / 4a1f27 就是这样，远看像邮筒）。 */
      robe: kind === 'elder' ? '#6b7a68' : kind === 'keeper' ? '#7a6a52'
        : (cult ? '#7a343d' : (girl ? '#a86a8a' : '#8a8a92')),
      robeDark: kind === 'elder' ? '#4c5949' : kind === 'keeper' ? '#5a4d3a'
        : (cult ? '#3d171c' : (girl ? '#7d4a64' : '#66666e')),
      collar: cult ? '#c9a2a6' : (girl ? '#f0d8d0' : '#e6ddc2'),
      belt: girl ? '#8a5a72' : '#5a4632', shoe: '#2c2a30'
    };"""),
])

# 2) arc.js 立绘自适应 + 正文避让
patch(r'D:\Projects\nichen\www\js\scenes\arc.js', [
("""        if (img) {
          var sc = sp && sp.scale ? sp.scale : 3;
          x.drawImage(img, DLG.x + 8, DLG.y - img.height * sc + 6, img.width * sc, img.height * sc);
        }""",
"""        var pw = 0;
        if (img) {
          /* 立绘按目标高度自适应（npc 精灵烘焙尺寸较大，不能直接 ×3） */
          var targetH = 96;
          var sc = sp && sp.scale ? Math.min(sp.scale, targetH / img.height) : targetH / img.height;
          pw = img.width * sc;
          x.drawImage(img, DLG.x + 8, DLG.y - img.height * sc + 6, pw, img.height * sc);
        }"""),
("""      var part = ln.tw.part();
      var lines = G.UI.wrap(x, part, 12.5, DLG.w - 28);
      lines.slice(0, 3).forEach(function (l, i) {
        G.UI.text(x, { x: DLG.x + 14, y: DLG.y + 20 + i * 18 }, l, 12.5, G.UI.C.text);
      });""",
"""      var tx0 = DLG.x + 14 + (pw ? pw + 8 : 0);
      var part = ln.tw.part();
      var lines = G.UI.wrap(x, part, 12.5, DLG.x + DLG.w - 12 - tx0);
      lines.slice(0, 3).forEach(function (l, i) {
        G.UI.text(x, { x: tx0, y: DLG.y + 20 + i * 18 }, l, 12.5, G.UI.C.text);
      });"""),
])

# 3) arc1.js 热点位置
patch(r'D:\Projects\nichen\www\js\data\arc1.js', [
("{ id: 'jiang_sp', x: 140, y: 162, pid: 'jiang', label: '陪爷爷',",
 "{ id: 'jiang_sp', x: 108, y: 196, pid: 'jiang', label: '陪爷爷',"),
("{ id: 'wan_sp', x: 340, y: 162, pid: 'wanqing', label: '寻晚晴',",
 "{ id: 'wan_sp', x: 372, y: 196, pid: 'wanqing', label: '寻晚晴',"),
])
