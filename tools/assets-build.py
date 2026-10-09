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
    # 雷貂（v1.3.0）：v1.2.0 新增的雷系野怪，原先走程序化 bossGen 兜底；
    # 2026-10-08 出手绘立绘。`enemies.js` 的 `species['雷貂'].artKey` 指到它。
    'battle.enemy.thunder_beast': (192, 192),
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
    'char.hero.down': (168, 252),    'char.hero.up': (168, 252),
    'char.hero.left': (168, 252),
    'char.hero.right': (168, 252),
    # 童年/少年立绘（v0.90.0）——入世演出三拍用。
    # ⚠️ 尺寸 = 16×24 × MAP_SCALE(3.5) = 56×84… 实际取的是 heroAgeStage 的画布
    #    16×24 × MAP_SCALE，这里按 **84×126** 预合成（PASSTHRU，不经 fit 重排），
    #    因为三档必须共用同一画布、脚底对齐、内容高随龄增长。
    #    真实像素尺寸由 _gen/_hero_age_stage.py 保证，构建期只校验。
    'char.hero.age6': (364, 546),
    'char.hero.age10': (364, 546),
    'char.hero.age16': (364, 546),
    # 地图 NPC（设计见《人物形象与文生图设定集 v2.3》§1.2 P_MAP；尺寸同主角，比例 2:3 必须一致）
    #   elder = 沈伯 / keeper = 刘掌柜 / villager = 泛用村民（浣衣妇与老樵夫共用）
    'char.npc.elder': (168, 252),
    'char.npc.keeper': (168, 252),
    'char.npc.villager': (168, 252),
    #   cultist = 血煞教探子（M1 §4 m1-2，化名"行脚商"）—— ✅ 已出图（2026-09-26）
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
    #   cultist = 血煞教探子（M1 §4）—— ✅ 已出图（2026-09-26）
    'portrait.cultist': (512, 512),
    # ===== 道具图标 =====
    #   储物面板格子逻辑 44px，K=4 → 176 设备像素；给到 256 留余量。
    #   取图逻辑名 = `item.<id>`，中文道具名 → id 的映射见 panels.js: ITEM_ICON_ID。
    #   ⏳ 逻辑名先预登记，图未到之前引擎走程序化兜底（art.js: A.itemIcon）。
    'item.pill_huichun': (256, 256),     # 回春丹
    'item.pill_dahuan': (256, 256),      # 大还丹
    'item.pill_juqi': (256, 256),        # 聚气散
    'item.pill_xingshen': (256, 256),    # 醒神散
    'item.pill_jiedu': (256, 256),       # 解毒丹
    'item.pill_ganlin': (256, 256),      # 甘霖丹
    'item.pill_shujin': (256, 256),      # 舒筋丹
    'item.pill_cuiti': (256, 256),       # 淬体突破丹
    'item.pill_zhuji': (256, 256),       # 筑基丹
    'item.pill_jiedan': (256, 256),      # 结丹丹（v0.67.0 补：原先只在 ITEM_D 有说明、无图标）
    'item.pill_daowen': (256, 256),      # 道纹丹（v0.67.0 补）
    'item.talisman_jiefeng': (256, 256), # 解封符
    'item.talisman_huicheng': (256, 256),# 回城符
    'item.mat_yaodan': (256, 256),       # 妖丹
    'item.shard_fan': (256, 256),        # 凡品功法碎片
    'item.shard_ling': (256, 256),       # 灵品功法碎片
    'item.shard_bao': (256, 256),        # 宝品功法碎片
    'item.stone': (256, 256),            # 灵石
    # 主角陆尘：**正面**全身立绘（角色面板用）。
    #   原来角色面板取 battle.hero（战斗侧身站姿），玩家看到的是"侧脸背影"。
    'portrait.luchen': (512, 512),
    # 主角头像：**正面**胸像，专供 HUD 左上角圆形头像。
    #   拿全身立绘裁头要放大 4 倍，圆里糊成一团；胸像的面部像素密度够。
    'avatar.luchen': (512, 512),
    # ===== 地面纹理（v0.20.0 文生图）=====
    #   引擎取图逻辑名 = ground.<kind>（art.js: A.groundTex），命中就整张替换程序化纹理。
    #   ⚠️ 尺寸必须 ≥ GTS(224) 且是 16 的整数倍（按格取子矩形）；这里给 448 = 224×2。
    #   ⚠️ **必须四方无缝** —— 平铺按世界坐标取子块，有缝就会看到规则网格线。
    #      出图后走 tools/ 的镜像拼贴（2×2 镜像 → 四边必然对接），实测接缝差 0.00。
    # ===== 区域专属底图（v0.21.0 文生图，28 区各一张）=====
    #   取图优先序：`ground.<区域id>` → `ground.<地面类型>` → 程序化（art.js: A.groundTex）。
    #   出图方式：一张 **2×2 纹理集**（4 个主题）→ 切片 → 每格做 2×2 镜像拼贴保证四方无缝。
    #   ⚠️ 必须完全不透明（BG_KEYS 已含 ground.*，cover() 末尾强制 alpha=255）。
    'ground.fan1': (448, 448),
    'ground.fan2': (448, 448),
    'ground.fan3': (448, 448),
    'ground.fan4': (448, 448),
    'ground.fan5': (448, 448),
    'ground.fan6': (448, 448),
    'ground.fan7': (448, 448),
    'ground.fan8': (448, 448),
    'ground.fan9': (448, 448),
    'ground.ling1': (448, 448),
    'ground.ling2': (448, 448),
    'ground.ling3': (448, 448),
    'ground.ling4': (448, 448),
    'ground.ling5': (448, 448),
    'ground.xian1': (448, 448),
    'ground.xian2': (448, 448),
    'ground.xian3': (448, 448),
    'ground.xian4': (448, 448),
    'ground.xian5': (448, 448),
    'ground.xian6': (448, 448),
    'ground.xian7': (448, 448),
    'ground.xian8': (448, 448),
    'ground.xian9': (448, 448),
    'ground.dao1': (448, 448),
    'ground.dao2': (448, 448),
    'ground.dao3': (448, 448),
    'ground.dao4': (448, 448),
    'ground.dao5': (448, 448),
    # 云州城专属地面（v2.1.0）：`fan10` 是**复用型区域**（map: 'yunzhou'），
    #   理论上会走手写图 `yunzhou` 的 `tex: 'fan4'`。但它是有独立主题
    #   （`TINT.fan10 = 'city_grand'`，凡界大城）的重要主线城，给它一张专属的
    #   "大城青砖"底图；接入方式见 `maps.js: yunzhou.tex`（改成 'fan10'）。
    'ground.fan10': (448, 448),
    # ===== 功法属性图标（v0.26.0 文生图，10 个：9 属性 + 无）=====
    #   逻辑名 `skill.<拼音>`，取图见 art.js: A.itemIcon（asset-first）。
    # ===== 灵根图标（v0.40.0 文生图，9 个）=====
    #   逻辑名 `root.<拼音>`；灵根页的九宫格用（与 `skill.<拼音>` 的功法属性图标**分开** ——
    #   灵根是"先天灵珠"、功法属性是"术法徽记"，两处用同一张图会显得偷懒）。
    'root.jin': (256, 256),
    'root.mu': (256, 256),
    'root.shui': (256, 256),
    'root.huo': (256, 256),
    'root.tu': (256, 256),
    'root.guang': (256, 256),
    'root.lei': (256, 256),
    'root.feng': (256, 256),
    'root.an': (256, 256),
    # ===== 材料图标（v0.40.0 文生图，15 种：草药 / 矿石 / 兽材 / 辅料）=====
    #   逻辑名 `mat.<拼音>`；炼丹 / 炼器 / 灵兽三系共用这一套基础材料。
    'mat.xuecao': (256, 256),
    'mat.lingzhi': (256, 256),
    'mat.youlan': (256, 256),
    'mat.huolian': (256, 256),
    'mat.xuantie': (256, 256),
    'mat.chitong': (256, 256),
    'mat.hanyu': (256, 256),
    'mat.xingsha': (256, 256),
    'mat.shoupi': (256, 256),
    'mat.shougu': (256, 256),
    'mat.yumao': (256, 256),
    'mat.lingye': (256, 256),
    'mat.fuzhi': (256, 256),
    'mat.zhusha': (256, 256),
    'mat.lingmu': (256, 256),
    # ===== v0.61.0 新增：资源四品 + 缺失道具 + 副本徽记（用户第 1/10/11 点）=====
    #   三张 4×4 集换表切出来的 48 张，切图见 `_gen/iconslice.js`（与 iconpipe 同一套抠图口径）。
    #   · `res.<币种>.<品级>`：灵石 / 灵晶 / 仙晶 / 道晶 各 下品/中品/上品/极品
    #     （用户第 11 点：四界四品，1 下品道晶 = 10 极品仙晶 = 10^5 极品灵晶 = 10^9 极品灵石）
    #   · `mat.*`：储物页里"有名字没图标"的采集/驯兽材料
    #   · `dungeon.<原型id>`：副本枢纽与入口面板的徽记（原先只有文字）
    'res.stone.low': (256, 256),
    'res.stone.mid': (256, 256),
    'res.stone.high': (256, 256),
    'res.stone.top': (256, 256),
    'res.lingjing.low': (256, 256),
    'res.lingjing.mid': (256, 256),
    'res.lingjing.high': (256, 256),
    'res.lingjing.top': (256, 256),
    'res.xianjing.low': (256, 256),
    'res.xianjing.mid': (256, 256),
    'res.xianjing.high': (256, 256),
    'res.xianjing.top': (256, 256),
    'res.daojing.low': (256, 256),
    'res.daojing.mid': (256, 256),
    'res.daojing.high': (256, 256),
    'res.daojing.top': (256, 256),
    'mat.yaozha': (256, 256),        # 药渣
    'mat.siliao': (256, 256),        # 饲灵草料（v0.67.0 补：灵兽进化材料，原先无图标）
    'mat.munang': (256, 256),        # 木囊
    'mat.xuannang': (256, 256),      # 玄囊
    'mat.baonang': (256, 256),       # 宝囊
    'mat.lingshi': (256, 256),       # 灵食
    'mat.lingquan': (256, 256),      # 灵泉水
    'mat.steel': (256, 256),         # 精钢
    'mat.lingyu': (256, 256),        # 灵玉
    'mat.tiemu': (256, 256),         # 铁木
    'mat.daoherb': (256, 256),       # 道纹草
    'mat.daoore': (256, 256),        # 道纹矿
    'mat.daoshard': (256, 256),      # 道纹残片
    'mat.bloodessence': (256, 256),  # 血精
    'mat.yaogu': (256, 256),         # 妖骨
    'mat.lingyu_f': (256, 256),      # 灵羽
    'mat.lingcao': (256, 256),       # 灵草
    'dungeon.B1': (256, 256),
    'dungeon.B2': (256, 256),
    'dungeon.B3': (256, 256),
    'dungeon.B4': (256, 256),
    'dungeon.B5': (256, 256),
    'dungeon.S1': (256, 256),
    'dungeon.S2': (256, 256),
    'dungeon.S3': (256, 256),
    'dungeon.S4': (256, 256),
    'dungeon.S5': (256, 256),
    'dungeon.S6': (256, 256),
    'dungeon.S7': (256, 256),
    'dungeon.S8': (256, 256),
    'dungeon.S9': (256, 256),
    'dungeon.S10': (256, 256),
    'dungeon.dao': (256, 256),       # 道则回廊（道界试炼）
    # 宗门徽记（v0.61.0，用户第 12 点）：**只做 9 个「根宗门」**——
    # 灵界总部 / 仙界道场与凡界同根（`sects.rootOf`），共用一张徽记，
    # 所以不需要按 21 个宗门各出一张。
    'sect.qxj': (256, 256),          # 青溪剑阁
    'sect.lxb': (256, 256),          # 落霞宗
    'sect.yhy': (256, 256),          # 幽篁药庐
    'sect.hyg': (256, 256),          # 火云观
    'sect.cwl': (256, 256),          # 翠微御灵宗
    'sect.txjz': (256, 256),         # 太虚剑宗
    'sect.dxg': (256, 256),          # 丹霞谷
    'sect.xtzz': (256, 256),         # 玄天阵宗
    'sect.wssz': (256, 256),         # 万兽山庄
    # 灵/仙两界**自成一根**的 4 个（没有 parent，不挂凡界山门）：雷泽散人盟 /
    # 云海剑冢·守冢一脉 / 寒渊水府·鲛族 / 南天门天兵营。
    'sect.lzm': (256, 256),          # 雷泽散人盟
    'sect.yhjz': (256, 256),         # 云海剑冢·守冢一脉
    'sect.hysf': (256, 256),         # 寒渊水府·鲛族
    'sect.tmty': (256, 256),         # 南天门天兵营
    'skill.jin': (256, 256),
    'skill.mu': (256, 256),
    'skill.shui': (256, 256),
    'skill.huo': (256, 256),
    'skill.tu': (256, 256),
    'skill.guang': (256, 256),
    'skill.lei': (256, 256),
    'skill.feng': (256, 256),
    'skill.an': (256, 256),
    'skill.wu': (256, 256),
    # ===== 法宝图标（v0.26.0 文生图，16 件）=====
    #   逻辑名 `equip.<法宝id>`，与 data/equips.js 的 id 一一对应。
    'equip.eq_qingfeng': (256, 256),
    'equip.eq_chixiao': (256, 256),
    'equip.eq_dianqiang': (256, 256),
    'equip.eq_fangtian': (256, 256),
    'equip.eq_bujia': (256, 256),
    'equip.eq_xuanwu': (256, 256),
    'equip.eq_fayi': (256, 256),
    'equip.eq_huwan': (256, 256),
    'equip.eq_yupei': (256, 256),
    'equip.eq_soulbell': (256, 256),
    'equip.eq_fozhu': (256, 256),
    'equip.eq_xianglian': (256, 256),
    'equip.eq_bagua': (256, 256),
    'equip.eq_ruyi': (256, 256),
    'equip.eq_tongjing': (256, 256),
    'equip.eq_hulu': (256, 256),
    'ground.grass': (448, 448),
    'ground.cave': (448, 448),
    'ground.town': (448, 448),
    'ground.bloodcave': (448, 448),
    # ===== 背景图（v0.12.0）=====
    #   逻辑尺寸 480×272，引擎里按 K=2 超采样绘制 → 出图给 960×544（2 倍）。
    #   ⚠️ 背景走 cover（等比放大铺满 + 居中裁切），**不走 fit 的"裁 alpha 外接框"** ——
    #      背景是要铺满整屏的，裁外接框会让画面里出现透明边。
    #   引擎取图逻辑名 = 'bg.battle.<主题>'，主题由 battle.js: _bgKey() 决定
    #   （bloodcave→blood / cave→cave / floor→hall / town→town / 其余按界 fan·ling·xian·dao）。
    #   没有素材时全部走程序化主题背景（见 battle.js 的 BG_THEME / BG_FEAT），不会黑屏。
    # 建筑（v0.16.0，文生图出图）：取图键 = `struct.<bk>`（药铺/铁匠铺/丹房…），
    #   没有 bk 时退回 `struct.<kind>`（house / ruin / gate）。
    #   引擎侧按**等比内含 + 底部居中**绘制（art.js: A.house），不拉伸 ——
    #   建筑尺寸从 3×5 到 6×5 都有，拉伸会让门窗比例各不相同。
    #   ⚠️ 建筑名字一律**矢量叠加**（explore.js: _drawPlaque），**不要烘进图里**：
    #      生图里的中文必然是乱码，而且同一张图要复用到不同建筑。
    # 建筑（v0.33.0 重出：**斜俯视 2.5D** —— 看得见屋顶 + 正面墙 + 门窗 + 基座）。
    #   取图键 `struct.<bk>`（bk = 建筑类型：house/shop/apothecary/smithy/alchemy/inn/
    #   temple/hall/tower/gate），没写 bk 才退回 `struct.<kind>`。
    #   ⚠️ 建筑匾额**一律矢量叠加**（explore.js: _drawPlaque），绝不烘进素材图。
    'struct.smithy': (256, 192),
    'struct.alchemy': (256, 192),
    'struct.inn': (256, 192),
    'struct.temple': (256, 192),
    'struct.hall': (256, 192),
    'struct.tower': (256, 192),
    'struct.house': (256, 192),
    'struct.apothecary': (256, 192),
    'struct.shop': (256, 192),
    'struct.ruin': (256, 192),
    'struct.gate': (256, 192),
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
#   ⚠️ ground.* 同理：地面纹理是**整幅平铺**的材质，走 fit 会把四边裁出透明带，
#      铺到地图上就是一条条黑缝（实测踩过：alpha min=0 → 场景里出现黑色十字带）。
BG_KEYS = set(k for k in SIZES if k.startswith('bg.') or k.startswith('ground.'))

# ===== 像素画类别：缩放必须用 NEAREST（v2.1.0，本批最重要的一条修正）=====
# ⚠️ 为什么必须分两类：默认 `LANCZOS` 是**抗锯齿**重采样，会把像素画的
#    **硬边块插值成渐变** —— 而"硬边 + 不产生新颜色"正是像素画的立身之本。
#    实测：同一张 16px 颗粒的地面原图，LANCZOS 缩到 448 后横向同色段平均长度
#    只有 ~1.5px（读起来就是"高清小图"），改 NEAREST 后升到 ~7px（真的块）。
#    **不修这条，出多少张像素原图都是白出** —— 画风在切图这一步就被磨掉了。
# ⚠️ 只列**本版起改为像素风**的类别；图标/道具等仍是高清素材，继续走 LANCZOS
#    （它们本来就是小尺寸平滑图，用 NEAREST 会产生锯齿反而更丑）。
# ⚠️ 每重出一类像素素材，就把它的前缀加进这里。
# ⚠️⚠️ 只列**已经真的重出为像素风**的键。**不要按前缀图省事**。
#
# 为什么用**显式键表**而不是前缀（v2.6.0 踩出来的）：
#   前缀匹配（`struct.`）会**连带**把同类别里**还没重出**的素材（struct.gate /
#   hall / inn / ruin / temple / tower）也按 NEAREST 重采样一次 ——
#   它们本来是高清明细图，被硬降采样后**悄悄变差**，而 diff 里只有一行 "Bin ... changed"，
#   完全看不出原因。实测：一次重建误伤 6 张。
#   ⇒ 显式键表 + "改素材的同时改这张表"，两者**同一次提交**。
#
# 判定：像素类走 `Image.NEAREST`（保硬边），其余走 `Image.LANCZOS`（抗锯齿）。
#   LANCZOS 会把像素画的硬色块插值成渐变 → 像素感在**切图这一步**就被磨平。
PIXEL_KEYS = set([
    # 地面（v2.2.0~v2.5.0 全部重出）：29 区域 + 4 兜底
    'ground.fan1', 'ground.fan2', 'ground.fan3', 'ground.fan4', 'ground.fan5',
    'ground.fan6', 'ground.fan7', 'ground.fan8', 'ground.fan9', 'ground.fan10',
    'ground.ling1', 'ground.ling2', 'ground.ling3', 'ground.ling4', 'ground.ling5',
    'ground.xian1', 'ground.xian2', 'ground.xian3', 'ground.xian4', 'ground.xian5',
    'ground.xian6', 'ground.xian7', 'ground.xian8', 'ground.xian9',
    'ground.dao1', 'ground.dao2', 'ground.dao3', 'ground.dao4', 'ground.dao5',
    'ground.town', 'ground.grass', 'ground.cave', 'ground.bloodcave',
    # 建筑（v2.6.0 起逐张重出；**换一张就加一行**）
    'struct.house', 'struct.apothecary', 'struct.shop', 'struct.smithy', 'struct.alchemy',
    'struct.gate', 'struct.inn', 'struct.hall', 'struct.ruin', 'struct.temple', 'struct.tower',
])


def is_pixel_key(key):
    return bool(key) and key in PIXEL_KEYS
# 地图角色的三帧：同一张图登记三次，动感由引擎的上下浮动提供
HERO_DIRS = ['down', 'up', 'left', 'right']
PAD = 0.04          # 外接框四周留白比例（防止描边贴边被切）

# PASSTHRU_KEYS：**原样落盘**（不做 fit 的"填满可用高度"重排）。
# 用途：源图已经是**按目标几何预合成**的 —— 如童年立绘 char.hero.age6/age10。
#   它们必须在**同一块画布(84×126)内脚底对齐、内容高随龄增长**(87/105/125)，
#   而 fit() 会把内容缩到 avail_h 填满，三档高度全变一样 → "长高"观感直接压平。
#   这类素材在 _gen 里已是最终尺寸，这里只校验尺寸并落盘。
PASSTHRU_KEYS = set(['char.hero.age6', 'char.hero.age10', 'char.hero.age16'])

# OPAQUE_KEYS：**本来就该是不透明的**素材，跳过"必须 RGBA"的校验。
# 为什么要这份白名单：定期有一批"人物 + 场景"的**电影化满幅图**（不用抠背景，
#   抠了反而毁掉构图，且深色头发与深色背景同色系根本抠不干净）。
#   它们走 cover 式绘制（`arc.js: _drawBigPortrait` / 过场静帧的 Ken Burns），
#   透明底对它们**没有意义**，报"非 RGBA"只会制造噪音、掩盖真正的缺口。
#   ⚠️ 白名单要**按用途**加，不能为了消警告随手加 —— 加错会把真缺透明底的立绘放过。
OPAQUE_KEYS = set([
    # 过场静帧（cinelib）：满幅电影化场景，Ken Burns 平移用
    'cine.chenmeng', 'cine.daolv', 'cine.fan_raid', 'cine.fan_soul', 'cine.fangshou',
    'cine.jingsui', 'cine.shanmen', 'cine.tianlun', 'cine.xinhuo', 'cine.zhaohun',
    # 写实半身立绘（标题/关于页大图）
    'portrait.hero',
    # arc 主线剧情立绘（v0.90.1）：人物 + 场景的电影化构图，按立绘框比例取景，
    # 不再抠背景（深发与深底同色，抠图会连头发一起吃掉）
    'portrait.wanqing', 'portrait.aheng', 'portrait.changgeng', 'portrait.jiang',
    'portrait.jingyan', 'portrait.nianchen', 'portrait.shouye', 'portrait.xuanjizi'
])


def _resampler(key):
    """选重采样方式。**像素画类别必须用 NEAREST**（见 PIXEL_PREFIXES 的说明）。"""
    return Image.NEAREST if is_pixel_key(key) else Image.LANCZOS


def fit(im, tw, th, key=''):
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
    im = im.resize((nw, nh), _resampler(key))
    canvas = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    # 底边对齐：角色脚底贴住画布下沿，和程序化精灵的锚点一致
    canvas.paste(im, ((tw - nw) // 2, th - nh - int(th * PAD)), im)
    return canvas, None


def cover(im, tw, th, key=''):
    """等比放大到**铺满** (tw, th)，居中裁切多余部分。背景 / 地面纹理专用。

    为什么背景不能用 fit：fit 会先裁到 alpha 外接框、再按 PAD 留白，
    产出的图四周有透明边 —— 背景是要铺满整屏的，透明边会露出引擎底色。

    ⚠️ 整幅平铺类（bg.* / ground.*）**一律不允许透明**：末尾把 alpha 拉满。
       地面纹理走的是"整张周期平铺"，只要有一个透明像素，地图上就会出现黑缝
       （实测踩过：alpha min=0 → 场景里出现黑色十字带，且不报任何错）。
    """
    im = im.convert('RGBA')
    k = max(tw / im.width, th / im.height)
    nw = max(1, int(round(im.width * k)))
    nh = max(1, int(round(im.height * k)))
    im = im.resize((nw, nh), _resampler(key))
    left = (nw - tw) // 2
    top = (nh - th) // 2
    out = im.crop((left, top, left + tw, top + th))
    r, g, b, _a = out.split()
    out = Image.merge('RGBA', (r, g, b, Image.new('L', out.size, 255)))
    return out, None


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
                if im.mode != 'RGBA' and key not in OPAQUE_KEYS:
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
            if key in PASSTHRU_KEYS:
                # 原样落盘（尺寸必须已经是目标尺寸；不等则报错，不要静默缩）
                out = im.convert('RGBA')
                if out.width != tw or out.height != th:
                    problems.append('%s：PASSTHRU 素材尺寸应为 %d×%d，实为 %d×%d'
                                    % (key, tw, th, out.width, out.height))
                    continue
                err = None
            else:
                # 传 key 进去：fit / cover 要按它选 NEAREST（像素类）还是 LANCZOS
                out, err = (cover if key in BG_KEYS else fit)(im, tw, th, key)
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
