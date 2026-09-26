#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 _gen/ 里 AI 生成的原图切成游戏能直接用的素材，并写 www/assets/manifest.json。

用法（需要装 Pillow 的 python）：
    python tools/assets-build.py            # 切图 + 写 manifest
    python tools/assets-build.py --check    # 只校验：manifest 里的键/文件是否齐、尺寸是否达标

为什么需要这一步：
    生图工具出的是 1024×1024 的方图，角色四周留了大片透明边距，而且不同角色的
    占比不一致。直接把方图登记进 manifest 会有两个后果——
      · 角色在画布里偏小、偏一侧（引擎按整张图缩放到槽位，边距一起被算进去）；
      · 每个角色的视觉大小随机，同一个战场上大小不一。
    所以统一做「裁到 alpha 外接框 → 按目标宽高比补透明边 → LANCZOS 缩放到目标尺寸」。

命名约定：_gen/ 下的文件名就是逻辑名（如 battle.hero.png）。
    · char.hero.left 会顺带镜像出一份 char.hero.right。
    · char.hero.<dir> 会展开成 .0/.1/.2 三个键（帧表按同一张图登记，
      走路动感由 sprites.js 里的 1 像素上下浮动提供）。
"""
import argparse
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('需要 Pillow：pip install Pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '_gen')
OUT = os.path.join(ROOT, 'www', 'assets', 'img')
MANIFEST = os.path.join(ROOT, 'www', 'assets', 'manifest.json')
MANIFEST_JS = os.path.join(ROOT, 'www', 'assets', 'manifest.js')

# 逻辑名 → 目标尺寸。尺寸按引擎里的槽位反推：
#   战斗立绘 = 40×40 逻辑 × 4 倍超采样 = 160，留到 192 是为了 K 提到 6 时不至于放大
#   地图角色 = 28×42 逻辑 × 4 倍 = 112×168，留到 168×252（比例 2:3 必须一致）
SIZES = {
    'battle.hero': (192, 192),
    'battle.enemy.snake': (192, 192),
    'battle.enemy.wolf': (192, 192),
    'battle.enemy.tree': (192, 192),
    'battle.enemy.wolfking': (192, 192),
    'battle.enemy.killer': (192, 192),
    'battle.enemy.heartDemon': (192, 192),
    # M1 血煞教（设计见《逆尘》M1剧情与内容设计 v1.0 §5.3）。
    # ⚠️ 图还没出，引擎现走程序化兜底（sprites.js: BAKE 的 cultist / bloodbat / xuemian）；
    #    这里先登记尺寸，图一旦放进 _gen/ 就能被切图脚本认下（否则报「未登记尺寸，跳过」）。
    # ⚠️ heartDemon2 只服务「心魔残影」；筑基心魔走 battle.js 的 species==='心魔' 特判，不吃这张图。
    'battle.enemy.cultist': (192, 192),
    'battle.enemy.bloodbat': (192, 192),
    'battle.enemy.xuemian': (192, 192),
    'battle.enemy.heartDemon2': (192, 192),
    # 副本 Boss 立绘（20 张，设计见《副本Boss形象与关卡结构设计 v3.3》§7.1）
    #   大副本：b<n>big = 第 9 关大 Boss；b<n>mid = 第 5 关小 Boss
    #   小副本：s<n>    = 第 5 关头领
    'battle.enemy.b1big': (192, 192),
    'battle.enemy.b1mid': (192, 192),
    'battle.enemy.b2big': (192, 192),
    'battle.enemy.b2mid': (192, 192),
    'battle.enemy.b3big': (192, 192),
    'battle.enemy.b3mid': (192, 192),
    'battle.enemy.b4big': (192, 192),
    'battle.enemy.b4mid': (192, 192),
    'battle.enemy.b5big': (192, 192),
    'battle.enemy.b5mid': (192, 192),
    'battle.enemy.s1': (192, 192),
    'battle.enemy.s2': (192, 192),
    'battle.enemy.s3': (192, 192),
    'battle.enemy.s4': (192, 192),
    'battle.enemy.s5': (192, 192),
    'battle.enemy.s6': (192, 192),
    'battle.enemy.s7': (192, 192),
    'battle.enemy.s8': (192, 192),
    'battle.enemy.s9': (192, 192),
    'battle.enemy.s10': (192, 192),
    'char.hero.down': (168, 252),
    'char.hero.up': (168, 252),
    'char.hero.left': (168, 252),
    'char.hero.right': (168, 252),
    # 地图 NPC（设计见《人物形象与文生图设定集 v2.3》§1.2 P_MAP；尺寸同主角，比例 2:3 必须一致）
    #   elder = 沈伯 / keeper = 刘掌柜 / villager = 泛用村民（浣衣妇与老樵夫共用）
    'char.npc.elder': (168, 252),
    'char.npc.keeper': (168, 252),
    'char.npc.villager': (168, 252),
    #   cultist = 血煞教探子（M1 §4 m1-2，化名"行脚商"）—— ⏳ 待出图，
    #   先在这里预登记逻辑名，否则图放进去会被静默忽略（缺键 → 退回程序化兜底）
    'char.npc.cultist': (168, 252),
    # 对话立绘（逻辑框 74×74，见 art.js PORTRAIT_LW/LH）
    #   74×4 倍超采样 = 296 是"不被放大"的下限，这里给到 512 留足余量、避免 K=4 时发虚
    'portrait.shenbo': (512, 512),
    'portrait.keeper': (512, 512),
    'portrait.villager': (512, 512),
    'portrait.elder': (512, 512),
    'portrait.killer': (512, 512),
    'portrait.demon': (512, 512),
    'portrait.aran': (512, 512),
    #   cultist = 血煞教探子（M1 §4）—— ⏳ 待出图，同上先预登记逻辑名
    'portrait.cultist': (512, 512),
    # 主角陆尘：**正面**全身立绘（角色面板用）。
    #   原来角色面板取 battle.hero（战斗侧身站姿），玩家看到的是"侧脸背影"。
    'portrait.luchen': (512, 512),
    # 主角头像：**正面**胸像，专供 HUD 左上角圆形头像。
    #   拿全身立绘裁头要放大 4 倍，圆里糊成一团；胸像的面部像素密度够。
    'avatar.luchen': (512, 512),
    # ===== 背景图（v0.12.0）=====
    #   逻辑尺寸 480×272，引擎里按 K=2 超采样绘制 → 出图给 960×544（2 倍）。
    #   ⚠️ 背景走 cover（等比放大铺满 + 居中裁切），**不走 fit 的"裁 alpha 外接框"** ——
    #      背景是要铺满整屏的，裁外接框会让画面里出现透明边。
    #   引擎取图逻辑名 = 'bg.battle.<主题>'，主题由 battle.js: _bgKey() 决定
    #   （bloodcave→blood / cave→cave / floor→hall / town→town / 其余按界 fan·ling·xian·dao）。
    #   没有素材时全部走程序化主题背景（见 battle.js 的 BG_THEME / BG_FEAT），不会黑屏。
    'bg.title': (960, 544),
    'bg.battle.night': (960, 544),
    'bg.battle.town': (960, 544),
    'bg.battle.cave': (960, 544),
    'bg.battle.blood': (960, 544),
    'bg.battle.hall': (960, 544),
    'bg.battle.ling': (960, 544),
    'bg.battle.xian': (960, 544),
    'bg.battle.dao': (960, 544),
}

# 背景类逻辑名：走 cover 而不是 fit（见 SIZES 里的说明）
BG_KEYS = set(k for k in SIZES if k.startswith('bg.'))
# 地图角色的三帧：同一张图登记三次，动感由引擎的上下浮动提供
HERO_DIRS = ['down', 'up', 'left', 'right']
PAD = 0.04          # 外接框四周留白比例（防止描边贴边被切）


def fit(im, tw, th):
    """裁到 alpha 外接框 → 等比缩放 → 贴进 (tw, th) 的透明画布（居中、底边对齐）。"""
    im = im.convert('RGBA')
    bbox = im.getbbox()
    if bbox is None:
        return None, '整张图全透明'
    im = im.crop(bbox)
    # 留白后再算可缩放空间
    avail_w = tw * (1 - PAD * 2)
    avail_h = th * (1 - PAD * 2)
    k = min(avail_w / im.width, avail_h / im.height)
    nw = max(1, int(round(im.width * k)))
    nh = max(1, int(round(im.height * k)))
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    # 底边对齐：角色脚底贴住画布下沿，和程序化精灵的锚点一致
    canvas.paste(im, ((tw - nw) // 2, th - nh - int(th * PAD)), im)
    return canvas, None


def cover(im, tw, th):
    """等比放大到**铺满** (tw, th)，居中裁切多余部分。背景专用。

    为什么背景不能用 fit：fit 会先裁到 alpha 外接框、再按 PAD 留白，
    产出的图四周有透明边 —— 背景是要铺满整屏的，透明边会露出引擎底色。
    """
    im = im.convert('RGBA')
    k = max(tw / im.width, th / im.height)
    nw = max(1, int(round(im.width * k)))
    nh = max(1, int(round(im.height * k)))
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return im.crop((left, top, left + tw, top + th)), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只校验，不写文件')
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        sys.exit('缺少原图目录：' + SRC)

    manifest = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            manifest = json.load(f)

    problems = []
    if args.check:
        for key, path in manifest.items():
            p = os.path.join(ROOT, 'www', path)
            if not os.path.exists(p):
                problems.append('manifest 登记的图不存在：%s → %s' % (key, path))
                continue
            with Image.open(p) as im:
                if im.mode != 'RGBA':
                    problems.append('%s 不是 RGBA（没有透明底）：%s' % (key, path))
        # 地图角色四个方向都必须齐 .0/.1/.2 —— 漏一个方向就会静默回退成程序化精灵，
        # 表现是"走起来四个方向长得不一样"。镜像出来的 right 曾经就是这么漏的。
        for d in HERO_DIRS:
            for step in (0, 1, 2):
                k = 'char.hero.%s.%d' % (d, step)
                if k not in manifest:
                    problems.append('缺少帧键 %s（该方向会回退成程序化精灵）' % k)
        # manifest.js 必须与 manifest.json 同步，否则脚本标签那条路会拿到旧清单
        if os.path.exists(MANIFEST_JS):
            with open(MANIFEST_JS, encoding='utf-8') as f:
                js = f.read()
            for key, path in manifest.items():
                if '"%s"' % key not in js:
                    problems.append('manifest.js 与 manifest.json 不同步，缺键：%s' % key)
        else:
            problems.append('缺少 www/assets/manifest.js（file:// 与沙箱预览下 manifest.json 取不到）')
        if problems:
            print('=== 素材校验发现问题 (%d) ===' % len(problems))
            for p in problems:
                print(' - ' + p)
            sys.exit(1)
        print('素材校验通过：manifest %d 个键，四向帧键齐全，文件与格式均正常。' % len(manifest))
        return

    os.makedirs(OUT, exist_ok=True)
    made = []
    for fn in sorted(os.listdir(SRC)):
        if not fn.lower().endswith('.png'):
            continue
        key = fn[:-4]
        if key not in SIZES:
            problems.append('未登记尺寸的逻辑名，跳过：%s' % fn)
            continue
        tw, th = SIZES[key]
        with Image.open(os.path.join(SRC, fn)) as im:
            out, err = (cover if key in BG_KEYS else fit)(im, tw, th)
        if err:
            problems.append('%s：%s' % (key, err))
            continue
        rel = 'assets/img/%s.png' % key
        out.save(os.path.join(ROOT, 'www', rel), optimize=True)
        manifest[key] = rel
        made.append('%s → %s (%d×%d)' % (key, rel, tw, th))

        # 侧面图顺手镜像出另一侧（源图统一朝左）
        if key == 'char.hero.left':
            out.transpose(Image.FLIP_LEFT_RIGHT).save(
                os.path.join(ROOT, 'www', 'assets', 'img', 'char.hero.right.png'), optimize=True)
            manifest['char.hero.right'] = 'assets/img/char.hero.right.png'
            made.append('char.hero.right → assets/img/char.hero.right.png（镜像自 left）')

    # 地图角色的三帧键必须**四个方向都**展开。right 是镜像出来的、_gen 里没有源文件，
    # 所以不能放在"遍历源文件"的循环里做，否则 right 永远拿不到 .0/.1/.2 帧键。
    for d in HERO_DIRS:
        rel = manifest.get('char.hero.' + d)
        if not rel:
            problems.append('缺少 char.hero.%s（该方向会回退成程序化精灵）' % d)
            continue
        for step in (0, 1, 2):
            manifest['char.hero.%s.%d' % (d, step)] = rel
        made.append('  ↳ char.hero.%s 展开为 .0/.1/.2' % d)

    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write('\n')

    # 同时产出一份 JS 版清单，供 <script> 标签直接引入。
    # 为什么不能只靠 manifest.json：它要用 fetch 取，而 fetch 在 file:// 打开、
    # 以及在部分沙箱预览里会被拦掉 —— 一被拦就静默退回全程序化画面，
    # 玩家只会看到"人物不对"，完全不知道是素材没加载。script 标签没有这个问题。
    lines = ['/* 由 tools/assets-build.py 生成，请勿手改。与 manifest.json 内容一致。',
             '   用 <script> 引入是为了绕开 fetch：file:// 与部分沙箱预览里 fetch 会被拦，',
             '   那样 manifest.json 取不到、素材全部静默退回程序化画面。 */',
             '(function (root) {',
             '  var G = root.G || (root.G = {});',
             '  G.AssetManifest = {']
    keys = sorted(manifest.keys())
    for i, k in enumerate(keys):
        lines.append('    %s: %s%s' % (json.dumps(k, ensure_ascii=False),
                                       json.dumps(manifest[k], ensure_ascii=False),
                                       ',' if i < len(keys) - 1 else ''))
    lines.append('  };')
    lines.append('})(typeof window !== \'undefined\' ? window : this);')
    with open(MANIFEST_JS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print('切图完成，共写入 %d 个文件：' % len(made))
    for m in made:
        print('  · ' + m)
    print('manifest 共 %d 个键 → %s' % (len(manifest), os.path.relpath(MANIFEST, ROOT)))
    print('          同步产出 → %s' % os.path.relpath(MANIFEST_JS, ROOT))
    if problems:
        print('=== 提醒 (%d) ===' % len(problems))
        for p in problems:
            print(' - ' + p)


if __name__ == '__main__':
    main()
