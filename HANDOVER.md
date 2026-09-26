# 《逆尘》开发交接文档

> 最后更新：2026-09-26 · 代码版本 **v0.8.0（底栏六功能 + 天道多协议 + 轮回档案）** · 前一里程碑 v0.7.0 commit `07a9c88`
> 本次增量（详见 §8）：
> ①**底栏六功能 + 删「菜单」**：角色/功法/秘术/任务/储物/成就从「菜单」二级页拆到**常驻底栏**
>   （新文件 `core/panels.js`），一键直达；「菜单」这一页**整体删除**，顶栏右上角只剩「设置」；
> ②**天道支持云端多协议**：OpenAI / Claude / 原生 Response 三选一，端点/模型/密钥可配
>   （密钥为密码态输入、界面只回显头尾，只写本机存档）；
> ③**每一世经历可回溯 + 设备标识**：死亡结算记录来源设备，轮回殿新增「前世经历」视图
>   （倒序分页 / 走马灯 / 非本机记录标红）；
> ④**主角正面立绘**：新增 `portrait.luchen`（正面全身）+ `avatar.luchen`（正面胸像），
>   角色面板与 HUD 圆头像不再是侧脸背影；
> ⑤**削减线框感**：面板三层描边收成一层、标题云纹菱形删除、按钮全部去角饰。
> `www/js` 13.5k → **14.3k 行**，`tools/` 5.6k → **5.8k 行**（新增 4 条契约）。
> **设计基线：GDD v3.3（2026-09-25，全案文档版本统一）** —— 全部文档清单、状态与权威顺序见
> `doc/《逆尘》设计文档总索引与版本基线 v3.2.md`（文件名保留 v3.2，内容已 v3.3）；单份文档不再单独代表“最新”。
> 用途：换电脑继续开发时的**唯一入口**。仓库里其它文档的分工见 §2.3。

---

## 0. 三十秒速览

**《逆尘》** —— 横屏单机仙侠**轮回** Roguelite RPG。2D 像素、俯视探图 + 回合制战斗。

| 项 | 值 |
|---|---|
| 技术栈 | **纯原生 JS + Canvas2D**，零框架、零构建、零依赖（浏览器直接跑 `<script src>`） |
| 代码风格 | ES5 风（`var` + `function`），全局命名空间 `G` |
| 逻辑分辨率 | **480 × 272**，内部超采样倍率 `S ∈ [3,4]` 按窗口自适应 |
| 打包 | Capacitor（`capacitor.config.json` 已配好，**但 `android/` 还没 init**） |
| 代码量 | `www/js` ≈ 14.3k 行；`tools/` ≈ 5.8k 行（无头测试与审查工具） |
| 当前进度 | **M0 主线全通 + 天道意志（三协议云端模型）+ 19境/四界/15副本 + 签名秘术效果 + 20 Boss 立绘 + NPC 精灵/立绘全量替换 + 主角正面立绘 + 四界 28 区域层/建筑可进/副本入口随机落位 + 地狱难度体系（三碎片开道界）+ 区域裂隙与界门可见 + 副本入口面板 + 轮回殿飞升台（选下一世主界/调界域难度/碎片与称号）+ 飞升·道界·地狱成就 + 常驻底栏六功能 + 每一世经历回溯与设备标识**（圣术面板% / 神术战斗被动 / 仙术每场一次主动，数值随品阶），**道界内容（道则回廊三试炼）未开工** |
| 回归状态 | smoke · playthrough · rebirth · **dungeon-run（凡→灵→仙）** · **secret-test（秘术效果）** 全过；smoke 共 **14 条契约**（本轮新增 `panels` / `panels.bounds` / `tiandao.protocol` / `device` 四条，均已做反例验证）；浏览器实测难度页/秘境枢纽/战斗/秘术面板通过 |

**最重要的一句话**：这个项目**没有构建步骤**。改完 `www/js/*.js` 直接刷新浏览器就能看到效果；
`tools/` 下的 node 脚本是**测试与审查**用的，不参与运行。

---

## 1. 新机器上跑起来

### 1.1 拉代码

```bash
git clone git@github.com:milkteacoffee/nichen.git
cd nichen
```

> 仓库里已经包含全部素材（`www/assets/img/*.png`，41 个文件：27 张战斗立绘（7 张旧怪 + 20 张副本 Boss）+ 4 张主角四向行走 + 3 张地图 NPC + 7 张人物立绘）。
> `_gen/`（切图中间产物）和 `_shots/`（截图输出）被 gitignore，不需要也不应该带过来。

### 1.2 跑游戏本体（只需要这个）

```bash
# 任选一种起静态服务，然后在浏览器开 http://127.0.0.1:8173
npx serve www -l 8173
# 或
python -m http.server 8173 --directory www
```

**必须走 HTTP，不能双击 `index.html`**：素材清单走 `fetch('assets/manifest.json')`，
`file://` 协议下会被 CORS 拦掉，画面会全部退回程序化兜底（能跑，但看不到 AI 素材）。

Windows 上可以直接用 Chrome 的 `--allow-file-access-from-files`，但别养成习惯。

### 1.3 跑测试与审查工具（需要额外装两个东西）

工具不在运行链路上，但**改完代码必须跑**。它们依赖：

| 依赖 | 用途 | 装法 |
|---|---|---|
| **Node ≥ 18** | 全部 `tools/*.js` | 任意版本管理器 |
| `@napi-rs/canvas` | 真实光栅化（截图 / 帧耗基准） | `npm i -D @napi-rs/canvas`（当前用的是 **1.0.9**） |
| **Python ≥ 3.10 + Pillow** | `tools/assets-build.py`（切图/生成 manifest） | `pip install Pillow`（当前用的是 **12.3.0**） |

`@napi-rs/canvas` **不在 `package.json` 里**，是刻意留的（它带原生二进制，
不想让 `npm i` 在没必要的机器上拖 20MB）。装完之后跑工具要指 `NODE_PATH`：

```bash
# 如果装在项目里（推荐，路径最省心）
npm i -D @napi-rs/canvas
NODE_PATH=./node_modules node tools/smoke.js

# 如果装在全局/别处
NODE_PATH=/path/to/node_modules node tools/smoke.js
```

> 本文档里所有命令都写成 `node` / `python`。本机（旧环境）的实际路径见 §7.3，
> 是 WorkBuddy 的托管运行时，**换机后路径一定会变**，不要照抄。

### 1.4 一键自检（换机后第一件事）

```bash
export NODE_PATH=./node_modules          # 或你的实际路径
node tools/smoke.js       && echo "① 冒烟 OK"
node tools/playthrough.js && echo "② 通关 OK"
node tools/rebirth.js     && echo "③ 轮回 OK"
```

三条都过、且**数字与 §3.2 的基线一致**，说明环境完全正常。
不一致但没报错，先看是不是 Node/Pillow 版本差异（概率低），再 diff 数值。

---

## 2. 目录与文件地图

```
nichen/
├── HANDOVER.md              ← 你正在看的这份
├── package.json             Capacitor 依赖 + serve/cap/apk 三个脚本
├── capacitor.config.json    appId com.nichen.game，webDir=www，横屏
├── www/                     ★ 全部游戏代码（部署单元就是这一整个目录）
│   ├── index.html           脚本加载顺序表（见 §4.1，动它要同步改测试）
│   ├── css/style.css        画布居中 + 等比缩放
│   ├── _probe.html          素材接线自检页（手开浏览器用，见 §3.4）
│   ├── assets/              素材层 + README.md（★ 换皮指南，内容很全）
│   └── js/
│       ├── core/            引擎层
│       ├── data/            纯数据表（无逻辑）
│       └── scenes/          场景层
├── tools/                   无头测试与审查工具（不参与运行）
├── doc/                     32 份设计规格 · 统一基线 GDD v3.3（见 §2.3）
├── _gen/                    (gitignore) 切图中间产物
└── _shots/                  (gitignore) 截图/审查输出
```

### 2.1 `www/js/core/` —— 引擎层

| 文件 | 行数 | 职责 |
|---|---|---|
| `art.js` | 2509 | **全部程序化美术**。地面纹理、建筑、家具、装饰、精灵、立绘、图标、**区域物件（秘境裂隙 / 界门）**；三级缓存（`cached` / `G.Sprites` / `G.UI`）都在这里定义。**头像走 `A.avatar`（专用胸像 `avatar.luchen`），取景表 `AVATAR_HEAD` 是显式的，不要写自动检测** |
| `ui.js` | 720 | UI 套件：调色板 `C`、字体 `F`、`panel/frame/bar/seal/icon/avatar/divider/rr`、`Btn`（含底栏页签变体 `tab`）、打字机 `Typewriter` |
| `sprites.js` | 1091 | 主角四向行走帧 + NPC 精灵，程序化兜底 |
| `explore.js` | 994 | **探索引擎**（镇/山/洞/室内/区域通用）：寻路、交互、遭遇、**HUD**、**区域物件绘制（宝箱 / Boss / 裂隙 / 界门）**；导出 `HUD_H`（顶栏 48）与 `BOT_H`（底栏 28），两段都靠它挡误触 |
| `panels.js` | 483 | **常驻底栏 + 六个面板**（v0.8.0 新增）：角色/功法/秘术/任务/储物/成就。底栏页签 `barBtns`、面板矩形 `PANEL_RECT`、路由 `isPanel/renderPanel`、状态标记矢量绘制 `mark()`（**不要用 `✓`/`▶` 字符，缺字会变豆腐块**） |
| `player.js` | 575 | 数值中枢：19境/四界WORLDS/寿元/ascend飞升、`computeStats`（含圣术 `secretPct`）/ `breakState` / `rates` / `xianliOf`（成就 A1–A9）/ **`cycleWorldDiff`（界域难度轮换）** |
| `game.js` | 219 | 主控：Canvas 适配、场景路由、主循环、`die()` / `checkAged()` / toast（toast 的 y 要让开底栏 `BOT_H`） |
| `mapgen.js` | 186 | 地图生成：地面、路、建筑、家具、NPC 落位、可达性（**门格会被标成已占用**，防随机散布把门堵死） |
| `regiongen.js` | 390 | **四界 28 区域生成**：由 `data/regions.js` 的紧凑规格确定性产出完整地图并注册进 `G.Data.maps`；场景工厂 + 建筑门路由 + **界门面板/传送（`openGate` / `travelTo`）** |
| `interiorgen.js` | 230 | **建筑内部程序化生成**：9 类模板（民居/杂货/客栈/药铺/铁匠铺/丹房/神殿/大殿/楼阁/守卫所），`int.<regionId>.<buildingId>` 惰性生成 |
| `overlays.js` | 222 | 覆盖层公共件：暗底、对话（立绘+台词）、**角色面板（含称号行）**、**统一路由 `route(x, scene)`**（面板 → 天道菜单页，五处场景共用这一个入口） |
| `tiandao.js` | 592 | **天道意志**：配置/感应五阶段/世界状态包/**三协议调用（OpenAI `/chat/completions` · Claude `/messages` · 原生 `/responses`，见 `buildRequest` / `extractText`）**/JSON 校验/模板兜底/问卦/注视低语/DOM 输入框（密钥为密码态）/**设置面板（`SET_P`）·界域难度 · 关于**（`G.TianDao`，含 `isMenuOverlay` 路由白名单；**v0.8.0 起没有「菜单」这一页**） |
| `assets.js` | 107 | 素材登记/查询/加载（`G.Assets.img/register/load`） |
| `storage.js` | 197 | localStorage 存档 **v4**（`nichen_meta` / `nichen_save`，各带 `_bak`；含历史迁移）＋**设备/浏览器标识**（`deviceId` / `browserId` / `stampDevice`，纯本地不外发） |
| `input.js` | 51 | 指针/键盘输入 → `onTap` / `onKey` |
| `rng.js` | 50 | 可复现随机（种子化，测试靠它） |
| `ns.js` | 3 | `window.G = window.G \|\| {}` |

### 2.2 `www/js/scenes/` —— 场景层（**全部是单例**，见 §4.3）

| 文件 | 行数 | 职责 |
|---|---|---|
| `battle.js` | ~1500 | 回合制战斗：数据驱动通用 Boss 阶段引擎、全体技/护盾/吸血/破防/纯状态技、多敌前后排、自动战斗、**秘术被动与仙术施放**、副本胜利分支 |
| `dungeon.js` | — | **秘境系统**：枢纽 + 关卡推进 + 休整 + 两套奖励（小Boss/大Boss/头领）+ 通关飞升；秘术按获得世界写品阶 |
| `difficulty.js` | — | **三难度选择卡片**（普通/困难/地狱） |
| `reincarnation.js` | 365 | 转世流程：**出身 → 灵根 → 天赋 → 直接入世** |
| `town.js` | 350 | 青溪镇：门、NPC 对话表 `NPC_ACTS`、任务钩子 |
| `title.js` | 331 | 标题菜单、关于页 |
| `death.js` | 258 | 死亡结算：死因/享年/走马灯/仙力明细/**称号** → 写入轮回档案（每世记来源设备 `dev`）+ **天道跨世记忆**（memory 最近 30 世、watchTotal） |
| `heaven.js` | 225 | **天道拦魂**（v0.0.2 新增）：死亡后全屏星河场景，≤3 轮模型对话（预设/自由应答）→ 死亡结算 |
| `reincarnation-hall.js` | 436 | 轮回殿：**三视图 `perfuse`（五线灌注）/ `ascend`（飞升台）/ `lives`（前世经历，倒序分页 + 走马灯 + 设备号）**；底部显示本机 `deviceId` / `browserId` |
| `field.js` | 64 | 翠微山（含山神庙覆盖层） |
| `cave.js` | 24 | 赤牙洞 |

### 2.3 `doc/` —— 设计规格（**34 份，统一基线 GDD v3.3**）

> 每份文档文首都带【统一设计基线】戳与【文档状态】（现行有效 / 历史快照）。
> **完整清单、状态与权威顺序以 `doc/《逆尘》设计文档总索引与版本基线 v3.2.md` 为准。**

- **现行有效 15 份**：总索引 v3.2、**全案闭环检查报告 v3.4（新增，取代 v3.2 的世界推进/道界/难度条目）**、
  **境界体系（淬体至道祖）v3.2**、**副本系统与四界轮回 v3.2**（§3.1/§3.3 已作废，见闭环报告 §6）、
  **四界区域与副本落位 v1.0（内容已修订至 v1.1：一世可连续飞升 + 地狱体系）**、
  总纲 v2.0、战斗 v2.1、功法秘术 v2.2、形象 v2.3、六卷剧情 v2.4、难度曲线 v2.5、破境天劫 v2.6、天道部署 v2.7、M1 v1.0。
- **历史快照 18 份**：v0.1–v0.9 旧系列 + 2 份无编号稿，留存追溯。
  - `v0.1 角色成长与功法修炼系统规格` —— **六维系统已整体删除**（v0.5.2），文首已加 ⚠️
  - `v0.6 出身天赋与全流程` —— **幼年阶段（1–15 岁事件卡）已整体删除**（v0.5.2），文首已加 ⚠️
- v3.2 核心：**19 境（gl1–171）**；天花板为凡界合体门槛（炼虚圆满 gl63）、灵界渡劫巅峰 gl90、
  仙界大罗巅峰 gl144；道界扩为**准圣/圣人/道祖**三境，地狱仙界掉「道之钥匙」方可入；
  15 副本每世随机 5（2 大 3 小、末位必大）；**六大循环经闭环检查全部闭合**。

> 判断"现在到底怎么实现"的**权威顺序**是：
> `代码` > `www/assets/README.md`（技术手册） > `HANDOVER.md`（本文件） > `总索引 v3.2` > `闭环/境界/副本 v3.2` > `v2.x 专题稿` > `doc 旧稿`。

### 2.4 `tools/` —— 工具（改完代码必须跑）

| 工具 | 行数 | 用途 |
|---|---|---|
| `smoke.js` | 2174 | **冒烟测试**：加载全部脚本、走遍所有场景、几十组契约断言（素材接线 / `regions.contract` 区域+建筑+入口落图 / `entrances.contract` 落位算法 / `hell.contract` 地狱体系 / `worlds.panel.contract` 界域难度 / `worldgate.contract` 界门 / **`region.visual.contract` 裂隙与界门真的画出来（差分绘制探针）** / **`dungeon.entrance.contract` 裂隙→入口面板+序列一致** / **`ascend.hall.contract` 飞升台** / **`achieve.contract` 飞升·道界·地狱成就**）。改任何东西后第一件事 |
| `playthrough.js` | 392 | **M0 通关模拟**：新档 → m0-1..m0-5 → 赤炎狼王，打印每步数值 |
| `rebirth.js` | 562 | **轮回闭环模拟**：一世终结算 → 五线灌注 → 浮世重生，验证"第二世确实变强" |
| `dungeon-run.js` | ~240 | **副本全流程无头测试**：凡界5本→飞升灵界→灵界5本→飞升仙界（结构断言 + 真实开局逐关胜） |
| `secret-test.js` | ~230 | **秘术效果测试**：品阶/圣术面板/神术被动/仙术主动施放断言 |
| `browser-probe.js` | 677 | **真实浏览器探针**（CDP 驱动本机 Chrome/Edge），唯一能验证素材是否生效的工具 |
| `shot.js` | 555 | 46 个场景导出 PNG（`@napi-rs/canvas` 真实光栅化；新增区域裂隙 / 界门 / 副本入口面板 / 飞升台 4 帧） |
| `zoom.js` | 182 | 单场景局部放大审查（看精灵清晰度） |
| `portrait-sheet.js` | 126 | 立绘总览 + ASCII 缩略图（图片直读会间歇失败，文本化更可靠） |
| `sprite-sheet.js` | 105 | 战斗立绘高倍导出 |
| `bench-frame.js` | 113 | 帧耗基准（S=4 最小帧耗） |
| `bench-ground.js` | 50 | 地面纹理烘焙耗时基准 |
| `assets-build.py` | 199 | 切图 + 生成/校验 manifest（`--check` 模式） |

---

## 3. 常用命令 + 当前基线

### 3.1 命令速查

```bash
export NODE_PATH=./node_modules      # 只对 node 工具需要

# —— 每次改完代码 ——
node tools/smoke.js                       # 必须过
node tools/shot.js 04_hud                 # 只落这一张（其它帧照常推进）
node tools/shot.js                        # 全部 46 张
node tools/playthrough.js                 # 数值回归
node tools/rebirth.js                     # 轮回回归
node tools/bench-frame.js                 # 帧耗回归

# —— 真实浏览器（要常驻服务）——
python -m http.server 8173 --directory www &     # 必须常驻！
node tools/browser-probe.js town                 # 场景见下
# 场景：town | field | cave | town_home | town_shop | town_market |
#       field_temple | battle | charpanel | perf | ablate | ground

# —— 素材 ——
python tools/assets-build.py --check      # 校验 manifest 与文件是否对得上
node tools/portrait-sheet.js              # 立绘审查
```

### 3.2 当前回归基线（**换机后拿这三个对表**）

> ✅ 以下数字已于 **2026-09-26（v0.8.0）在本机实测复核**（smoke 通过 / playthrough 13 步逐字吻合 /
> rebirth 仙力 +386、攻击 41→43 / dungeon-run 8·15 / secret-test 全过）。新机上跑出来不一致，
> 基本就是环境问题，别怀疑代码。
> ⚠️ **随机源会推移 rebirth 的「第 2 世变强」数字**：它取决于入世时抽到的灵根/天赋，
> 而抽取用的全局 `G.rng` 序列会被任何**新增的随机消耗**推移。v0.6.0 期间本机实测为 `41→46`，
> v0.7.0 把秘境序列与入口落位改成**独立种子 RNG**（不再消耗全局 rng）后回到 `41→43`，
> v0.8.0 未触碰随机源、仍为 `41→43`。
> 判定标准是「第 2 世四维是否**全面高于**第 1 世」，不是某个具体数字。

**`smoke.js`** → `冒烟测试通过：脚本加载 + 标题/转世/镇/山/洞/战斗/死亡/轮回殿 全场景渲染无异常。`

**`playthrough.js`** → 最终一行：

```
  ⑬ 击杀狼王 · M0 通关   境界 炼气三重  灵气 4013  灵力 696  灵石 1422  战斗 16 场  任务 free
```

完整 13 步（**任何一步对不上就是回归**）：

```
 ① 入世             淬体一段    100    0   50   0 场 m0-1
 ② m0-1 教学        淬体一段    100    0   50   0 场 m0-1
 ③ 首战胜利          淬体一段    411   24   68   1 场 m0-1
 ④ 得灵石 → m0-2     淬体一段    411   24  118   1 场 m0-2
 ⑤ 杀手战 → m0-3     淬体一段   1411   24  218   1 场 m0-3
 ⑥ 珠内梦境 → m0-4   淬体一段   3911   24  218   1 场 m0-4
 ⑦ 淬体九段          淬体九段    221  344  458   9 场 m0-4
 ⑧ 沈伯赠丹          淬体九段    221  344  658   9 场 m0-4
 ⑨ 灵气备足          淬体九段   3331  584  838  14 场 m0-4
 ⑩ 心魔战 → 炼气一重  炼气一重    521  584  838  14 场 m0-5
 ⑪ 炼气三重          炼气三重   1013  696  922  16 场 m0-5
 ⑫ 入赤牙洞          炼气三重   1013  696  922  16 场 m0-5
 ⑬ 击杀狼王 · 通关    炼气三重   4013  696 1422  16 场 free
```

**`rebirth.js`** → 结尾三行：

```
  仙力合计  +386
  第 2 世变强（同 炼气三重）：攻击 41→43　防御 27→28　气血 382→394　速度 16→17
  轮回闭环通过：一世终结算 → 五线灌注 → 浮世重生，第 2 世确已变强。
```

**`bench-frame.js`（S=4 最小帧耗，软件光栅器）**：

| 场景 | ms/帧 |
|---|---|
| 镇 `town` | 1.9 – 2.1 |
| 野外 `field` | 2.7 – 3.4 |
| 洞 `cave` | 1.7 – 2.6 |
| 室内（四张） | 1.3 – 2.5 |

> 16.7ms 预算下余量 5 倍以上。**单轮噪声极大（同场景能差 2 倍），只认多轮最小值。**

**`browser-probe.js`** → `页面错误：无`，且 `超采样 S=3 美术 K=3 ✅ 一致`。

### 3.3 基线为什么会变（改数值前先想清楚）

改了数值公式/天赋/出身，上面这些数字**一定会动**。动之前先判断"这是预期内的还是断链"：

- v0.5.2 那次：战斗场次从 17 → 16 场，是因为出身给了灵气 +8%，更快攒够突破所需。
  **是合理结果，不是断链**。
- 判断方法：看 `playthrough` 的**逐步**输出，如果某一步的境界/任务突然错位，那才是真断链。

### 3.4 `www/_probe.html`

一个独立自检页：手动在浏览器打开，它会 `G.game.start()` → 进镇 → 走四向 → 进战斗 →
把"素材命中情况 / 精灵位图尺寸 / S 与 K / 页面错误"写进 `#probe-report`，
并把 `document.title` 设成 `PROBE_DONE`（方便脚本轮询）。
比 `browser-probe.js` 轻量，适合"我怀疑素材没生效"时手开一下。

---

## 4. 架构与硬约束

### 4.1 脚本加载顺序 = 依赖顺序

`index.html` 里的 `<script src>` 是**有序的**，而且**被 `smoke.js` / `shot.js` / `bench-frame.js`
用正则解析**（它们不自己维护脚本列表）。所以：

- 加/删 js 文件 → **只改 `index.html`**，测试会自动跟上（也会自动发现你漏改了）。
- 删了一个文件但忘了摘 `<script>` → 测试会报 `缺失脚本：xxx`。
- 顺序约定：`ns → rng/input/storage/assets/art/ui/sprites/game` →
  `data/*` → `player/mapgen/explore/overlays` → `scenes/*`。

### 4.2 分辨率与三级缓存（**最容易出错的地方**）

- 逻辑坐标恒为 **480×272**，内部超采样倍率 `G.game.S` 由 `resize()` 按窗口算：
  `S = clamp(ceil(显示倍率 × dpr), 3, 4)`。
- **`G.Art.K` 必须等于 `G.game.S`**，靠 `game._rebakeArt()` 保证。
- 缓存分三级，**改倍率要全清**，漏一级就会残留旧倍率位图：
  1. `G.Art` 的 `store`（`A.clear()` / `A.setK()`）
  2. `G.Sprites`（`Sprites.clear()`）
  3. `G.UI`（`UI.clearCache()`）
- **素材到货也要清这三级**（`game.js` 的 `Assets.load` 回调里）。只清 `Art` 的话，
  首个场景已经烘进去的程序化精灵会一直复用，表现成"人物形象和素材不一致"。
- 缓存画布是 **K 倍超采样**的：`x.drawImage(c, dx, dy, 逻辑宽, 逻辑高)`，
  给逻辑尺寸，别给像素尺寸。要从缓存画布上**取源矩形**（比如圆形头像）时，
  源坐标必须 **×K**。

### 4.3 场景是**单例**

`G.scenes[name]` 在脚本加载时创建一次，`enter()` 只重置它关心的字段。
**状态会跨进出复用**，所以：

- 每个 `enter()` 必须显式重置自己的瞬时状态。反例（真实 bug）：
  `explore.enter()` 忘了清 `flash/flashDir/_pending`，导致"在 A 图踩到暗雷、
  闪白没走完就离开、再回 A 图第一帧当场进战斗"。
- 测试里往场景上打的桩（比如覆盖 `_heldDir`）**必须还回去**，否则会污染后续用例。

### 4.4 UI 的硬约束

- **HUD 顶栏高度 `explore.js: HUD_H = 48`**，它同时是"点地不响应"的高度
  （`onTap` 里 `p.y < HUD_H`）。画得比它高 → "点在 HUD 上人却动了"。
- **数值绝不压在进度条上**。旧版把 `155 / 155` 画在血条正中，数字和条的高光叠一起，
  亮色地面背景直接糊成一片（用户明确报过"粗糙"）。一律排在条的**右侧**。
- 室内地图的家具**不能摆进 `y < 5`**，NPC 同理 —— 会被顶栏压住。
- `G.UI.icon` / `G.UI.panel` 等带缓存的件要复用；**HUD 是常驻层，每帧重建的渐变/路径
  都要预烘**（见 §5.6）。

### 4.5 数值来源（v0.5.2 之后）

角色面板上的数字**只有五个来源**，别再往里塞第六个中间层（六维就是这么被删掉的）：

```
computeStats = 境界成长  +  功法  ×(1 + 天赋百分比 + 出身百分比)  +  仙躯(meta.perfusion.body)
```

- 天赋与出身走**同一套聚合**：`Player.talentEffects()` 开头
  `mergeInto(e, save.originFx)`，然后逐个天赋 `mergeInto(e, t.e)`。
- 可用的效果键（`ADD_KEYS` / `MERGE_KEYS`）在 `player.js` 顶部，
  加新键要同步改这三处：`empty()`、`mergeInto()`、`ADD_KEYS`/`MERGE_KEYS`。
- 出身只发**百分比**，不发固定值 —— 发固定值面板上就会出现"看不见来源"的数字。

### 4.6 存档

- `localStorage`，键 `nichen_meta`（跨世）与 `nichen_save`（当世），各带一个 `_bak` 兜底。
- `meta` 存：`lives / xianli / totalXianli / perfusion{body,qi,po,stone,rescue} /
  pity / achieve / heaven / past[]`。
- 写完当世档要 `G.Storage.saveCurrent(save)`；切世时 `clearCurrent()`。

---

## 5. 踩过的坑（照抄别重犯）

> 这一节是**血泪清单**，每条都对应一个真实 bug。改相关代码前先读一眼。

### 5.1 无头测试的虚拟时钟必须单调递增

`tools/smoke.js` / `shot.js` 用虚拟时钟驱动 `requestAnimationFrame`。
以前每次 `pump()` 都重新 `let t = sandbox.performance.now()` 起算，而
`game.loop` 的 `this._last` 还停在上一次 pump 末尾 —— 虚拟时间每帧 +16.7ms，
几十帧就比真实时间快 1 秒多，于是**下一次 pump 的第一帧 `now - _last` 是负数**：

`dt` 变负 → 所有 `-= dt` 的计时器**倒着走** → 闪白从 1 涨到 4、
战斗 cue 永不结束、结算演出收不了尾。

**一个时钟 bug 能伪造出一整屏"游戏逻辑坏了"。** 现在虚拟时钟在模块加载时取一次基准、
跨 `pump()` 单调递增；`game.loop` 的 `dt` 也**上下都夹**（下夹 0，上夹 0.05）。

### 5.2 延迟渲染下"逐阶段计时"完全不可信

Canvas2D 是**延迟渲染**的，`drawImage` 只是把命令塞进 display list，
真正光栅化发生在 flush 时。给每个 `_draw*` 包一层计时，时间会被记到
"恰好触发 flush 的那一步"头上 —— 曾把地面层的开销全记到 `_drawDecor`，得出相反结论。

**要看真实开销，用消融**（把某一步换成空函数，比较整帧耗时的差值）。

### 5.3 消融的"基准帧间隔"也要先怀疑

`browser-probe ablate` 是**先灌 60 帧同步渲染、再采样 rAF**，合成器还压着一堆待画内容，
于是 `field / cave / field_temple` 会读到 **33.3ms（30fps）**，
而同一份代码 `bench-frame.js` 的最小帧耗只有 3–5ms —— **差 7 倍，是量法不是代码**。

**解读规则**：如果**每一个**步骤禁用后都得到同一个改善值
（`field` 里 13 个步骤全是 `-16.6ms`），说明**没有任何一步是瓶颈**，
只是整帧刚好越过 vsync 边界掉档；这时候"优化哪一步"是伪命题。
只有**少数几步**显著大于其它步时，才有真瓶颈。

可信的替代：`browser-probe perf` 的**「每帧」列**（`update+render` 的 60 帧同步平均），
`> 16.7ms` 才算真掉帧。

### 5.4 别在跑循环测试的同时改 `www/` 源码

`smoke.js` 每个进程启动时**读盘**。24 连跑时我中途改了 `ui.js`，
有 4 次跑到了重构中间态（语法错 → `G.UI` 没挂上），报了一屏
`Cannot read properties of undefined (reading 'Btn')` —— **假失败**。
干净环境重跑 24/24。跑循环测试时要么改文档，要么改完再跑。

### 5.5 立绘的取景与兜底链

- **三级兜底链**：`portrait.<key>` 素材 > `art.js: PORTRAIT_ART`（复用战斗立绘）
  > 程序化 `PORTRAIT_P`。漏掉中间这级，角色面板会显示一张跟地图上走着的人
  毫无关系的程序化半身像（用户报过"面板和人物不一致"）。
- 素材支会先量**不透明像素包围盒**（`contentBox`）再**按内容**居中 ——
  AI 出图四周留白不对称（刀往左伸、头发往右飘），按整图居中的话可见内容会整体偏出画心。
  裁完乘 `PORTRAIT_FIT = 0.92` 留呼吸位，否则头顶只剩 0.7px。
- **圆形头像的取景走显式表 `art.js: AVATAR_HEAD`，不要写自动检测**。
  实测 `battle.hero` 逐行 alpha 宽度是
  `y3:w3 → y10:w17 → y17:w11 → y24:w18 → y45:w25 → y56:w32`，
  **肩颈是平滑过渡，没有"脖子塌陷"这个断点**，任何"宽度突变就停"的启发式都会一路扫到腰
  （第一版头像里只剩一件蓝袍子）。立绘有两种版式（全身站姿 / 半身像），取景本来就不该同规则。
  **换立绘素材时这张表要一起改。**

### 5.6 HUD 是常驻层，每帧重建的渐变/路径都要预烘

`stone` 图标每次都要现建线性渐变、`qi`/`po` 要现描路径；资源格底与铭牌底
每帧现描圆角矩形 + 现填 + 现描边。这些在**每个探索场景每帧**都要跑一遍。
改成预烘后（`G.UI.icon` → `drawIcon` 预烘；底走带缓存的 `G.UI.panel`），
HUD 开销从 ~0.9–1.1ms/帧降到 **~0.5–0.7ms/帧**。

### 5.7 探索遭遇闪白（曾经的 P0）

`_encounter` 只置 `flash = 0; flashDir = 1`，而 `_checkFlash` 要求 `flash >= 1`，
**全项目没有一行推进 `flash`** → 暗雷一踩中**永久卡死**：`_pending` 永远排队、
`onTap` 因 `flashDir === 1` 永远 early return。手机上只有点击寻路，
表现就是"**这张图动不了**"（画面一切正常，没有任何提示）。v0.4.4 就上线了。

修法：`update()` 里 `flashDir === 1 → flash += dt * 3.2`（到 1 交给 `_checkFlash`）并 `return`。
回归用例：`smoke.js` 的 `encounter.enter`。

### 5.8 无头环境跑不到素材路径

`smoke.js` 等用的是**桩 canvas + 桩 fetch**，`fetch` 被桩成 reject，
`manifest` 永远加载失败 —— **素材路径在无头环境里根本跑不到**。
只有 `browser-probe.js`（真 Chrome）能回答"素材到底生效没有"。
`browser-probe.js` 需要**常驻**的 `http.server 8173`（用后台任务起），
中途断掉会让所有子资源变 502，表现为"驱动里 `window.G` 是 undefined"。

---

## 6. 已知遗留 / 下一步

### 6.1 已拍板 / 已处理

- **`doc/` 文档版本与闭环问题（2026-09-25 已处理，当日升至 v3.2）**：全案统一为 **GDD v3.2 基线**，
  每份文档加盖基线戳；`v0.1 角色成长`（六维已删）与 `v0.6 出身天赋`（幼年已删）标记为历史快照并加 ⚠️；
  六大循环经《全案闭环检查报告 v3.2》核验全部闭合；清单与权威顺序登记在《总索引 v3.2》。

### 6.2 明确未接线 / 未开工

| 项 | 状态 |
|---|---|
| `bg.battle` / `bg.cave` / `bg.hall` / `bg.death` 背景素材 | 逻辑名已定，**未接线**（全走程序化背景） |
| `portrait.luchen`（主角正面立绘）/ `avatar.luchen`（正面胸像） | **已出图并接线**（v0.8.0）：角色面板走 `A.portrait('luchen')`、HUD 圆头像走 `A.avatar('luchen')`；其余 7 张 `portrait.*`（沈伯/刘掌柜/村民/老者/阿阮/杀手/心魔）也已接线 |
| `obj.rift` / `obj.worldgate` 区域物件素材 | 未出图，走程序化（`A.rift` / `A.worldgate`；登记素材键即自动优先） |
| **道界内容（道则回廊三试炼）** | **未开工**（缺口 U4）：`dungeon.js` 对 `dao` 只显示“尚未开放”，`SLOT_GL` 无 `dao`；飞升台里道界行也标「未开放」、不可选为入世主界 |
| 区域美术换皮（U7） | 28 区共用同一套程序化外观（主题地面/建筑外观未分化） |
| 野怪收益曲线验算（U5） | 各区 `zones` 已按 gl 分段，但未做过“某区刷 N 场能否支撑到下一段破境”的数值验算 |
| **天道模型接入的真机实测** | **未做**：三协议（OpenAI/Claude/原生 Response）的请求形状已由 `tiandao.protocol.contract` 钉死，但**没打过真实云端端点**；`browser-probe` 跑不到网络。换机/上线前建议各协议各问一次卦 |
| `android/` | Capacitor **未 init**，`npm run cap:sync` / `apk:debug` 现在会失败 |
| M1 内容 | 未开工 |
| 御兽 / 炼丹炼器 | 有规格（`doc/` v0.2），未实现 |

### 6.3 工具层面的欠账

- `browser-probe ablate` 的基准帧间隔不可信，应改成"丢弃预热帧 + 多轮取最小"。
- `bench-frame.js` 的头条数字只取 5 轮最小，在这台机器上噪声仍偏大；
  可以考虑加 `--rounds N` 参数。

### 6.4 建议的下一步

1. 先跑 §1.4 的三条自检，确认新环境与基线一致。
2. 开 `npm run serve` 手玩一遍 M0 主线（新档 → 赤炎狼王），感受一下当前手感。
3. **P4 已收口**（U1/U2/U3/U6 全闭合，见 §8）。剩余按 v3.3 基线推进，按性价比排序：
   - **道界道则回廊**（U4，P5 最大一块）：`SLOT_GL` 补 dao、固定三境试炼（斩三尸/证道/合道）、
     道晶经济、秘术飞升升品；做完把飞升台的道界行改为可选（现在标「未开放」）；
   - **区域美术换皮**（U7）：28 区目前共用一套程序化外观，主题地面/建筑外观未分化；
   - **野怪收益曲线验算**（U5）：逐区算“刷 N 场能否支撑到下一段破境”，必要时调 `zones.enc`；
   - **M1 内容** / **补素材接线**（`bg.*`、`obj.rift` / `obj.worldgate`）。
4. 工具层欠账（§6.3）优先级低，但 `browser-probe ablate` 的基准帧间隔建议顺手修掉。
5. **v0.8.0 遗留的小尾巴**：天道三协议没打过真实云端端点（见 §6.2），下次动 `tiandao.js` 时顺手实测一次。

---

## 7. Git 与协作

### 7.1 仓库

- 远程：`git@github.com:milkteacoffee/nichen.git`，默认分支 `main`
- 提交身份：**本机（当前）是 `翰璃鑫 <1973433049@qq.com>`**（仓库级 `git config` 已设）。
  旧机用的是 `周鑫 <h-zhoux11@vanke.com>` —— **两者不一致，提交前先 `git config user.name / user.email` 确认**，
  别把两台机器的身份混在一条历史里。
- 提交信息风格：`vX.Y.Z 逆尘：<一句话>（+ 正文分条说明）`，中文。

### 7.2 SSH

旧机用的是 `C:\Users\h-zhoux11\.ssh\id_ed25519_yitiandao`（ED25519，无口令）。
**这是本机专属文件，不会跟仓库走。** 换机后要么把私钥拷过去，要么在 GitHub 上
注册新机的公钥。验证：

```bash
ssh -T git@github.com
git ls-remote origin      # 能列出 refs 就通了
```

### 7.3 旧机的运行时路径（**仅作参考，换机后会变**）

```bash
# WorkBuddy 托管运行时
node   = D:/SoftWare/WorkBuddyAI/data/config/binaries/node/versions/22.22.2-3/node.exe
python = D:/SoftWare/WorkBuddyAI/data/config/binaries/python/envs/default/Scripts/python.exe
         （Pillow 12.3.0 装在这个 venv 里，不在 base）
NODE_PATH = D:/SoftWare/WorkBuddyAI/data/config/binaries/node/workspace/node_modules
            （@napi-rs/canvas 1.0.9）
```

新机上装好 §1.3 的两个依赖，把 `NODE_PATH` 指向你的 `node_modules` 即可。

### 7.4 `.gitignore` 与"什么不入库"

```
_gen/            切图中间产物（可重新生成）
_shots/          截图/审查输出
node_modules/
.workbuddy-ai/   ★ AI 的项目记忆（daily log + MEMORY.md）
*.log
```

> ⚠️ **`.workbuddy-ai/` 不入库**，所以换机后**项目记忆不会跟过来**。
> 那份记忆里有相当多的踩坑记录与经验。本文件（`HANDOVER.md`）已经把其中
> 对开发有长期价值的部分**搬了过来**（§4 / §5 / §6）。
> 新机上的 AI 会话如果需要更细的历史，可以看 git log 的提交正文
> —— v0.5.0 之后的提交都写了比较详细的分条说明。

---

## 8. 最近一次改了什么

### v0.8.0：底栏六功能 + 天道多协议 + 轮回档案 + 削减线框感（2026-09-26）

**背景**：v0.7.0 收口 P4 之后，玩家侧反馈了五条界面问题（附截图）。本轮一次做完。

**① 底栏六功能，删掉「菜单」这一页**
- 原先「角色/功法/秘术/任务/储物/成就」全塞在「菜单」二级页里，探索途中要点两下才到。
  现在拆成**常驻底栏**（六个等宽页签），一键直达；**「菜单」这一页整体删除**，
  顶栏右上角那颗按钮直接叫「设置」。
- 新增 `www/js/core/panels.js`（483 行）承载底栏与六个面板。**新增面板只改 `PANELS` 表 +
  一个 `draw` 函数**，路由不用动。
- 三条约束（改之前先读 `panels.js` 文件头）：
  ① 底栏高度 = `Explore.BOT_H`（28），探索场景的 `onTap` 靠它挡误触（同 `HUD_H` 的道理）；
  ② 面板内**也画底栏**，六个面板可直接互切，不必先退回探索；
  ③ 面板矩形 `PANEL_RECT = {x:12, y:26, w:456, h:212}`，底边 238 —— **底栏占 244 起**。
- **路由统一**：原先五处场景各自判断 `G.TianDao.isMenuOverlay`，现在收成一个
  `G.Overlays.route(x, scene)`（面板 → 天道菜单页），`town/field/cave/regiongen/interiorgen`
  五处都只调它。

**② 天道支持云端多协议**
- 原先只认 OpenAI 兼容的 `/chat/completions`。现在 `protocol` 三选一：
  | 协议 | 端点 | 鉴权 | 请求体要点 |
  |---|---|---|---|
  | `openai`（默认） | `/chat/completions` | `Authorization: Bearer` | `messages`；**刻意不带 `response_format`**（很多第三方实现不支持，会 400） |
  | `claude` | `/messages` | `x-api-key` + `anthropic-version: 2023-06-01` | `system` 是**顶层字段**，不在 `messages` 里 |
  | `response` | `/responses` | `Authorization: Bearer` | `instructions` + `input` + `max_output_tokens` |
- 差异全收在 `buildRequest(cfg, sys, usr)` 与 `extractText(j, proto)` 两个函数里；
  `joinUrl(base, path)` 已带后缀就不重复拼。
- 设置页可配 **服务器 / 模型名 / 密钥**；密钥走**密码态**输入框，界面只回显头尾（`maskKey`），
  **只写本机存档、不外发**。老存档缺 `protocol` / `apiKey` 由 `ensure()` 的 `_fill` 补默认值。

**③ 每一世经历可回溯 + 设备标识**
- `Storage.deviceId()`（localStorage 持久，首次生成 `dev-xxxxxxxx`）与
  `Storage.browserId()`（UA/语言/平台/屏幕/时区/核数 → `RNG.hash`，得 `br-xxxxxxxx`）——
  **纯本地，不外发**。`stampDevice(meta)` 记录首次/最近使用；换浏览器时把旧的推进 `device.prev[]`（上限 8）。
- 死亡结算给每一世记录加 `dev` 字段（`death.js`）。
- 轮回殿新增第三个视图 **「前世经历」**（`reincarnation-hall.js`，`view = perfuse | ascend | lives`）：
  倒序分页（`LIVES_PER = 4`），每世一行「第 n 世 / 境界·年龄·死因 / +仙力」+ 一行走马灯 +
  右端设备号（**非本机记录标红**）；页面底部常驻本机 `deviceId` / `browserId`。

**④ 主角正面立绘**
- 原先角色面板取 `battle.hero`（战斗侧身站姿），玩家看到的是侧脸背影。新增两张素材：
  `portrait.luchen`（512×512 正面全身，角色面板用）与 `avatar.luchen`（512×512 正面胸像，HUD 圆头像用）。
- **为什么要单独出胸像**：圆头像只取"脸"那一小块，拿全身立绘裁头要放大 4 倍（源 9 逻辑 px → 目标 36），
  圆里会糊；胸像的面部像素密度够。
- 接线三处：`art.js: A.AVATAR_ART` / `A.avatar(key)` / `A.headBox(key)` 的 `AVATAR_HEAD`。
  没登记头像就照旧回退 `A.portrait(key)`（含 `battle.hero` 兜底链）。

**⑤ 削减线框感**
- `panelCanvas`：**删掉"内墨线"与"金线内衬"两层**，只留最外一层描边；`cornerMarks` 每角 2 段 → 1 段。
- `UI.frame`：删掉标题两侧的「云纹短线 + 两个菱形端点」。
- `btnCanvas`：**所有变体去掉 `cornerMarks`**；`gold` 的"内亮线 + 外描边"两层收成一层；
  `ghost` 描边 0.55 → 0.34。新增 `tab` 变体（底栏页签：无描边、无角饰、纯渐变底，选中时底部一条亮线）。
- `barFrame` / `divider`：描边与菱形透明度整体下调。

**审查中新发现的静默问题（截图复核时抓到，均已修 + 补契约）**

| 编号 | 症状 | 根因 |
|---|---|---|
| G21 | 任务面板第 6 条「逍遥世间」落到面板外 | 6 行 × 15px 从写死的 `P.y+142` 起 → 末行 243 > 面板底 238 |
| G22 | 成就面板 9 条越界、且「称号」行**压在第 8 条上** | 9 行 × 21px → 末行 238；称号行在 218 |
| G23 | 「已完成」标记渲染成**空心方框** | `'✓'` / `'▶'` 无字体保证（工程没有 `@font-face`，字体是系统回退），缺字变豆腐块 |
| G24 | 设置页底部提示被「关闭」按钮压住 | 提示 y=232 与按钮 y=236 只差 4px，水平区间还重叠 |

- G21/G22 的修法：任务链条起点**按目标文案的实际折行数推算**（不再写死）；成就改**两列**排布
  （5 行 × 26px，收在 194 以内）。
- G23 的修法：`panels.js` 新增 `mark(x, cx, cy, state)`，**一律矢量绘制**（对勾 / 三角 / 圆点）。
  ⚠️ **不要再改回字符**。
- G24 的修法：设置页底部改成**一行四键**（问卦 / 界域难度 / 关于 / 关闭），提示单独压在最底（244..254）。

**新增契约（`tools/smoke.js`，均已做反例验证）**

| 契约 | 钉什么 |
|---|---|
| `panels.contract` | 六项底栏入口存在且 `variant === 'tab'`；`Explore.BOT_H` 已导出；六个面板都能 `openPanel` 且有高亮页签 + **文本探针**确认标题真的画出来；面板内可切页；再点当前页签收起；**点底栏不移动人物** |
| `panels.bounds.contract` | **面板内容不得越界 / 不得叠字 / 不得压在按钮上 / 不得用缺字标记**。用**带坐标的文本探针 `textSpyXY()`**（记录 `fillText` 的文本 + x/y/字号/对齐）取最坏情况数据（6 步任务链 + 9 项成就全达成 + 满背包）逐条断言。覆盖六个底栏面板 + 天道三页（设置/界域难度/关于）。**G21/G22/G24 就是这条契约的活反例** |
| `tiandao.protocol.contract` | 三协议的 url / 鉴权头 / 请求体形状；端点已是完整路径不重复拼；密钥留空不带 `Authorization`；`extractText` 四种响应体；`pickJson` 剥 ``` 围栏与夹叙；`validate` 正常台词与违禁词；**旧档 cfg 迁移补 `protocol` / `apiKey`** |
| `device.contract` | `deviceId` / `browserId` 稳定；`stampDevice` 写入；轮回殿有「前世经历」入口；文本探针查标题/走马灯/境界/本机设备号/`dev-other`/浏览器号；倒序（第 2 世在第 1 世之前） |

> 💡 **`panels.bounds.contract` 是可复用的范式**：排版类问题（越界、叠字、压按钮）**全是静默的**
> —— 不报错、只是难看，只有截图才发现。凡是要往固定矩形里塞动态条数的列表，都该补一条这样的契约。

**截图**：`tools/shot.js` 46 → **54 张**，新增 `29_hud_bar`、`30_panel_skills`、`31_panel_secrets`、
`32_panel_quest`、`33_panel_bag`、`34_panel_achieve`、`35_settings`（Claude 协议配置态）、
`36_hall_lives`（前世经历）。

---

### v0.7.0：飞升台 + 区域可见性 + 奖励可见性（2026-09-26，P4 收口）

**背景**：v0.6.0 落地了四界 28 区域层与地狱体系，P4 还剩 U1–U3 / U6 四个缺口
（《全案闭环检查报告 v3.4》§5）。本轮把 P4 一次做完（含 v0.6.0 之后已补、随本次一并入库的
U1 界门 / U2 界域难度入口，见本节的下面两节），并修掉两个**审查中新发现**的静默问题（G19 / G20）。

1. **区域物件可见性（新发现缺口 G19）—— 本轮最严重的一处。**
   秘境裂隙与界门此前**只登记在 `map.md.special` 里、没有任何绘制分支**
   （`explore._drawSpecial` 只画 chest / boss）。表现是**地图上什么都不出现**：
   玩家走到正面才冒出一个小三角，等于把副本入口藏了起来。
   - 新增 `art.js: A.rift`（紫黑裂口 + 内芯幽光 + 逸散碎屑）与 `A.worldgate`（石拱 + 光幕 + 门楣金符）；
     程序化件，登记 `obj.rift` / `obj.worldgate` 素材键即自动优先用素材。
   - `explore._drawSpecial` 补两个分支 + 紫 / 蓝呼吸光晕。
   - 契约 `region.visual.contract` 用**差分绘制探针**：同一张图摘掉该类物件后，
     每帧 `drawImage` 次数必须减少（只断言"绘制函数存在"抓不到漏路由）。已做反例验证。

2. **副本入口面板（U6）**：区域裂隙的 `onInteract` 早就在 `changeScene('dungeon', { entrance })`，
   但 `dungeon.enter` 只认 `fromBattle`、其余一律跳**通用枢纽** —— 玩家看到的不是他点的那处秘境。
   新增 `dungeon._showEntrance` / `_renderEntrance`：按落位显示副本名 / 类型 / 属性 / 推荐境界 /
   最终首领 / 签名秘术 / 状态（封印中·可挑战·可重刷），槽位语义与枢纽完全一致；
   「返回」或 Esc 回到裂隙所在的区域。

3. **裂隙与枢纽的序列一致性（新发现缺口 G20）**：`dungeonSet` 与 `entrances` 原先**各自独立随机**
   （`rollSet()` 一次、`rollEntrances()` 内部又一次），两条序列不同 ——
   会出现"裂隙点进去是万骨渊、枢纽第 3 槽却是黑风寨"。
   现在 `rollEntrances(worldId, seed, set)` 支持**复用调用方的 `dungeonSet`**，入世与飞升重抽都走同一条序列。

4. **副本序列种子化（U8）**：`dungeons.rollSet(seed)` 支持传 seed（字符串 → `RNG.hash` FNV-1a，
   或直接传 `G.RNG` 实例），同一世同一界的序列可复现；不传仍回落 `Math.random`（测试靠它覆盖随机性）。
   顺手把 `G.RNG.hash(str)`（字符串 → 32 位种子）收进 `rng.js` 作为公共件。

5. **轮回殿·飞升台（U2 的正式入口 + U3 的展示位）**：`reincarnation-hall.js` 改双视图
   （「仙躯灌注」/「飞升台」）：
   - **左列选下一世主界**（`meta.progress.nextWorld`）：未解锁置灰并显条件，再点一次取消（交回天道抽定）；
   - **右列调各界难度**：与菜单「界域难度」共用 `Player.cycleWorldDiff` —— 口径只有一份；
     菜单那处保留为**世内便捷入口**，此处是正式入口；
   - 底部显示道之钥匙碎片 n/3 与已得称号；道界行在三碎片齐后出现，但**标「未开放」不可选**
     （U4 未开工，选进去会是一个没有主线的界）；
   - `reincarnation.finish()` 消费 `nextWorld`：只认已解锁的界，未解锁 / 越界一律回落天道抽取。

6. **称号展示 + 飞升 / 道界 / 地狱成就（U3）**：
   - 称号（`meta.titles`）此前"发了但看不见" → 现在**角色面板**（右栏底部）、**死亡结算**（左栏第六行）、
     **飞升台**三处可见；
   - `Player.ACHIEVE` 补 **A6 飞升上界（+200）/ A7 仙门中人（+400）/ A8 叩门道界（+1500）/ A9 破狱者（+300）**；
     这四项进度在 `meta` 里（跨世），所以 `hit` 签名扩展为 `(save, meta)`，
     `xianliOf` 相应改为 `a.hit(save, meta)`。契约 `achieve.contract` 覆盖触发条件与一次性。

7. **基线校正**：
   - `playthrough.js` 第⑩步的文案残留旧命名「炼气一段」→ 改为「炼气一重」（v0.6.0 已定炼气用「重」）；
   - `rebirth` 的「第 2 世变强」数字对**全局随机消耗**敏感（详见 §3.2 说明）：v0.6.0 期间实测 `41→46`，
     本轮把秘境序列与入口落位改成**独立种子 RNG**（不再消耗全局 `G.rng`）后回到文档基线 `41→43`、
     仙力合计 `+386`。

8. **新增 4 条契约**（均做反例验证：改坏 → 报错 → 还原 → 通过）：
   `region.visual.contract` / `dungeon.entrance.contract` / `ascend.hall.contract` / `achieve.contract`。
   五条无头测试（smoke / playthrough / rebirth / dungeon-run / secret-test）全绿。

### 界门：下界回访通道（U1 闭合）

1. **mapgen 新增 `worldgate` 物件类型**：占格实心、交互点登记在正下方一格
   （与 chest / boss / entrance 同一套"站到旁边才能触发"的走位约定）。
2. **regiongen 新增 `openGate` / `travelTo`**：区域内踩/点界门 → 弹出「界门」面板，
   列出凡/灵/仙/道四界与状态（当前 / 可往 / 未解锁），点击即传送。
   传送做三件事：切 `meta.progress.activeWorld` → 落到目标界首区出生点 →
   目标界的入口落位若还没 roll 则补一次（`save.entrances[界]`）。
3. **各界界门所在**：灵界雷泽荒原（L1）/ 仙界南天门（X1）/ 道界道则回廊（D1）/
   **凡界落霞镇（F4）**。
   > 凡界的门**没放在首区青溪镇**：青溪镇复用现有手写地图（`town`），
   > 往里塞界门对象会动到 M0 教学链与既有测试契约；落霞镇是商旅重镇（交通枢纽），更顺。
   > 因此规则是「**每界至少一座界门**」，不是「首区必有」。
4. **界门放完立刻 `carve` 一次**，保证从出生点**走得到**（不然就是"看得见、点不着"）。
5. **契约 `worldgate.contract`**：每界有界门 / 生成型界门真有物件且走得到 /
   未解锁的界去不了 / 已解锁的界能传 / 目标界入口落位补齐 / 渲染分支真的画出来（文本探针）。
   **反例验证过**：关掉界门放置立刻报 4 处。
6. **验证**：五条无头测试全绿。

### 飞升口径修订 + 地狱难度体系（2026-09-26，设计 v1.1）

1. **飞升口径修订**：v1.0 的「一世一主界」**作废**，改为「**一世内可连续飞升**」——
   **普通难度**通关该界第 5 副本即可飞升（**不需要地狱**）；一世理论上能打通凡 → 灵 → 仙三界。
   已通关的界转为「下界」，可回访（只刷资源与副本，不推进主线）。
2. **地狱难度体系（新增）**：三档难度改为**每界独立**（`meta.progress.worldDiff`，缺省回落新游戏默认档）。
   地狱通关该界第 5 副本额外给：
   - **称号**：凡 `破狱·凡尘` / 灵 `破狱·灵渊` / 仙 `破狱·仙穹`；
   - **跨世永久全属性 +10%**（写 `meta.hellCleared`，不随轮回清空）；
   - **道之钥匙碎片 ×1**（该界专属）。
3. **道界开启条件变更（重要）**：由「地狱通关仙界掉整把钥匙」改为
   **三界地狱各一枚碎片、集齐 3 枚**才 `daoKey = true` 开道界。
   → **副本 v3.2 §3.3 作废**；旧档若 `daoKey` 已 true，迁移时把三枚碎片一并标为已得（**不收回道界**）。
4. **实现**：`player.hellBonusPct(meta)` + `computeStats` 四维同乘
   （生效时机：凡界地狱 → 飞升灵界起；灵界地狱 → 飞升仙界起；仙界地狱 → 道界开启后）；
   `dungeon.grantHell(meta, world)` 为**纯逻辑、幂等**（同界只发一次，回刷不重复发）；
   `dungeon._diff()` 改为读本界的 `worldDiff`。
5. **存档 v3 → v4**：`meta` 加 `hellCleared` / `titles` / `progress.worldDiff` / `progress.daoShards`；
   `save.entrances` 由**数组改为按界分桶的对象**（回访下界时原落位仍在）。
6. **修掉一处设计矛盾（G11）**：当前界此前有**两个真相源** —— `player.activeWorldId()` 读
   `meta.progress.activeWorld`（`ascend` 会写），而 v1.0 又新增了 `save.mainWorld`，两者会分叉。
   现已**删除 `save.mainWorld`**，统一到 `meta.progress.activeWorld`。
7. **修掉一处静默失败（G12）**：`rollEntrances` 原本从该界**全部**区域抽，会抽到凡界 F1–F3
   （复用现有手写地图，没有裂隙位）与安全区 —— 落位后地图上**什么都不出现、且不报错**。
   现候选收紧为**生成型 + 非安全区**；仙界为此把兜率天宫 / 蟠桃园 / 天枢阁改为非安全区并补了 `zones`。
8. **新增契约 `hell.contract`**：grantHell 幂等 / 三碎片齐才开道界 / 永久 +10% 的**生效时机** /
   加成**真的进了 computeStats**（四维同倍率 ≈1.30）。
   `regions.contract` 另加「入口落位真的落到地图上」（裂隙 special + 交互点 + 从 spawn 可达）。
9. **新增文档** `doc/《逆尘》全案闭环检查报告 v3.4.md`（152 行）：**设计层已闭环**；
   实现层列出 **8 个缺口**（U1–U8，集中在 P4 主界/回访流程与 P5 道界内容/美术）。
10. **验证**：五条无头测试全绿（smoke / playthrough / rebirth / dungeon-run / secret-test）。
11. **新增「界域难度」入口（缺口 U2 闭合）**：通用菜单 →「界域难度」→ `G.TianDao.openWorlds`，
    列出凡/灵/仙三界与当前难度，点击按 普通→困难→地狱→普通 轮换、**立即生效**并写 `meta`；
    未解锁的界置灰。**这是临时入口，正式入口归「飞升台」**（未开工）。
    顺手把 overlay 路由收成 `G.TianDao.isMenuOverlay()` 白名单 —— 原先 `menu`/`tiandao`
    这个条件**散落在 5 个场景里**（town/field/cave/regiongen/interiorgen），
    新增一种菜单页漏改一处就是"点了没反应"，现在只改 `MENU_OVERLAYS` 一处。
    契约 `worlds.panel.contract` 用**文本探针**验面板真的画出来 ——
    只断言"render 不抛异常"是空的：漏路由时它会**静默不画**、不报错。

### 四界 28 区域层 + 建筑可进 + 副本入口随机落位（2026-09-26，设计基线 v1.0）

1. **新增设计文档** `doc/《逆尘》四界区域与副本落位设计 v1.0.md`（355 行）——
   此前**文档里根本没有"区域"这一层**，代码里只有 7 张地图（`doc` 里的探图规格 v0.2 是旧三图快照，已被取代）。
2. **新增 `data/regions.js`（222 行）**：四界 **28 个区域**（凡 9 / 灵 5 / 仙 9 / 道 5）的紧凑规格。
   凡界 F1–F3 **复用现有手写地图**（`town`/`field`/`cave`，靠 `mapIdOf`/`regionIdOf` 双向映射），
   其余 25 个由生成器产出 —— 这样 M0 教学链与既有测试契约零改动。
3. **新增 `core/regiongen.js`（310 行）**：由规格**确定性生成**完整地图（种子 = `worldSeed + ':' + regionId`），
   注册进 `G.Data.maps`。因为 `mapgen.buildMap` 只读这张表，**mapgen 零改动**就能吃下 25 张新图。
   同时提供场景工厂（惰性创建 `G.scenes[regionId]`）与建筑门路由。
4. **新增 `core/interiorgen.js`（231 行）**：**9 类建筑内部模板**，`int.<regionId>.<buildingId>` 惰性生成。
   实测 **25 区 / 92 栋建筑 / 92 间内部**全部可进。
5. **副本入口天道随机落位**：`regions.rollMainWorld(meta)`（已解锁界中**未通关的界优先**）+
   `regions.rollEntrances(worldId)`（从主界区域无放回抽 5 个落位点；原型顺序由 `dungeons.rollSet()` 给，
   2 大 3 小、第 5 必大）。入世时写入 `save.mainWorld` / `save.entrances`。
   道界例外：5 个区域 = 固定试炼，不参与随机池（副本 v3.2 §6.3）。
6. **存档 v2 → v3**：`save` 新增 `mainWorld` / `entrances` / `visited` / `indoor`；缺字段补默认、不白屏。
7. **`mapgen` 修掉一处既有隐患（重要）**：登记门交互点后**没把门格标成"已占用"**，
   随机散布的树/石可以正好落在门格上把门堵死 —— 表现是"那栋建筑永远进不去"且**不报任何错**。
   现已补 `mark(doorX, doorY)`。**这条对既有地图同样生效**（镇上民居门也可能被树堵），
   修复后 town/field 的散布布局会有微调。
8. **新增两条回归契约**：`regions.contract`（区域可生成 / 出口不被堵 / 建筑门从 spawn 可达 / 内部合规，
   实测 25 区 92 栋 92 间）与 `entrances.contract`（30 轮随机 + 主界优先规则 + 道界固定）。
   `regions.contract` 已做**反例验证**：撤掉 `mark(doorX, doorY)` 立刻报 2 处门被堵。
9. **验证**：五条无头测试（smoke / playthrough / rebirth / dungeon-run / secret-test）全绿。
10. **未完成**：**P4** 主界/回访下界接入轮回流程（界门交互、回访限制、主界推进口径）、
    **P5** 区域美术换皮（主题地面/建筑外观）与 HANDOVER 基线。

### NPC 角色形象全量替换（2026-09-26，依据 人物形象与文生图设定集 v2.3）

1. **出图 10 张**：地图精灵 3 张（`char.npc.elder` 沈伯 / `keeper` 刘掌柜 / `villager` 泛用村民）
   + 人物立绘 7 张（`portrait.shenbo` / `keeper` / `villager` / `elder` 重伤老者 /
   `aran` 阿阮 / `killer` 杀手 / `demon` 心魔）。形象口径见该设定集 §1.2 / §3 / §6。
2. **规格**：地图精灵 **168×252**（同主角，比例 2:3、脚底对齐下沿）；人物立绘 **512×512**
   （立绘框逻辑 74×74，超采样上限 K=4 → 至少 296 才不被放大；512 是干净的 1/2 下采样）。
   全部透明底、单角色居中满幅。
3. **接线**：`sprites.js: npcSprite(kind)` 查 `char.npc.<kind>`；
   `art.js: A.portrait(key)` 查 `portrait.<key>` → 再退 `PORTRAIT_ART` → 再退程序化。
   10 张全部命中素材，不再走兜底。
4. **"帧率/动感一致"是管线自带的**：主角行走图的 `.0/.1/.2` 三帧**登记的是同一张图**，
   动感由引擎的 1px 上下浮动提供；NPC 走同一套 `npcFrames`，按同规格出图即天然对齐，
   不需要额外做动画帧。
5. **工具**：`assets-build.py` 的 `SIZES` 补登 10 个新键（**不补会被「未登记尺寸，跳过」**）；
   manifest 43 → **53 键**，`assets/img/` 31 → **41 张**。
6. **新增回归契约**：`smoke.js` 的 `npc.portrait.assets` —— 磁盘级读 `manifest.json`，
   要检查的键**不写死**，直接从 `data/maps.js` 的 `npcs[]` 取 `kind` / `portrait`，
   再补 4 个只由场景引用的立绘键（`elder` / `killer` / `demon` / `aran`）。
   以后地图里加新 NPC 却忘了出图/登记，这里会立刻报错。
   已做**反例验证**：删掉 `char.npc.villager` 与 `portrait.aran` 登记即报错，恢复即通过。
7. **画风对齐的教训（重要）**：**只靠文字描述风格不管用。** 首版严格按设定集 P_MAP 母版出图，
   结果 NPC 比主角高一截、脸更细、还带一圈粗黑描边。改成**把主角素材当参考图喂进生图工具**
   （image-to-image：地图精灵锚 `char.hero.down`、立绘锚 `battle.hero`，风格保真度取中档）后，
   头身比 / 像素颗粒 / 描边处理立刻对齐。**`killer` / `demon` 的立绘要锚它们自己的战斗立绘**，
   否则对话立绘与战斗立绘会变成两个人（§5.5 记过这个坑）。
8. **验证**：五条无头测试（smoke / playthrough / rebirth / dungeon-run / secret-test）全绿；
   `assets-build.py --check` 通过；三组对照图在 `_shots/`（`npc_map_final.png` /
   `npc_portrait_final.png` / `npc_portrait_enemy.png`，gitignore 不入库）。
9. **已知取舍**：`char.npc.villager` 与 `portrait.villager` 被**浣衣妇与老樵夫共用**，
   两人在场上长得一样。要区分需给 `maps.js` 换独立 kind（如 `washer` / `woodman`）并各出一张图。

### 副本 Boss 立绘 20 张出图接线（2026-09-26，设计基线 v3.3 §3/§4）

1. **出图**：按《副本Boss形象与关卡结构设计 v3.3》§3（大副本 5×2：大 Boss + 小 Boss）与
   §4（小副本头领 10）的提示词，产出 20 张；1024×1024 出图 → 切图至 **192×192**。
   逻辑名 `battle.enemy.b1big…b5big` / `b1mid…b5mid` / `s1…s10`，与 §7.1 完全一致。
2. **接线**：`data/dungeons.js` 的 `artKey` → `battle.js:1320` →
   `sprites.js: beastResolve(artKey, fallback)` 查 `battle.enemy.<artKey>`；20 张全部命中。
3. **工具**：`assets-build.py` 的 `SIZES` 补登 20 个新键；manifest 23 → 43 键。
4. **新增回归契约**：`smoke.js` 的 `dungeon.boss.assets`（断言 20 个 artKey 均已登记 + RGBA）。
   已做反例验证：删掉 `battle.enemy.s10` 登记即报错。
5. **画风说明（需知情）**：本批为**高完成度写实插画**风格，与旧 7 张战斗立绘
   （平涂赛璐璐 + 粗描边，如 `battle.enemy.wolfking`）**存在画风断层** —— 已确认接受。
   后续若要统一全游戏画风，可连带重出旧 7 张。
6. **踩坑（批量出图必读）**：生图工具按「提示词前 ~22 字 + 时间戳」命名文件，
   **同类立绘前缀相同 + 同秒即同名覆盖**。本次 `b3big 九渊妖皇` 曾被 `b4big 雷泽蛟龙` 覆盖，
   已重出补齐。规避办法：把 **Boss 名放在提示词最前面**，或逐张出图落盘核对数量。

### 19境/四界/15副本 + 签名秘术效果（2026-09-25，设计基线 v3.3）

1. **境界与四界**：`player.js` REALMS 扩为 19 境（MAX_GL171）、WORLDS 四界（凡/灵/仙/道）、
   完整寿元 LIFESPAN、`ascend` 飞升接引（跨界不走破境）。
2. **副本数据 `data/dungeons.js`**：15 原型 ARCH（大副本九关含第5关小Boss+第9关大Boss、
   小副本五关含第5关头领）、GROWTH/SLOT_GL/DIFF/WORLD_COEF/TRASH 与各工厂；
   `SECRET_EFFECTS` 效果表 + `secretEffectById/secretGrade/gradeOf`。
3. **战斗 `battle.js`**：写死狼王重构为数据驱动通用 Boss 阶段引擎（summon/clone/enrage/heal），
   新增敌方全体技、护盾、吸血、破防、纯状态技、副本胜利分支；秘术接入——
   圣术面板%（`secretPct` 在 computeStats 乘算）、神术战斗被动（血海吸血/诛邪封印/枯荣受击回血/
   芒山每回合回灵/四象开局护盾）、仙术每场一次主动（`_castSecret` 按 self/all/single 路由，数值×品阶）。
4. **新增 `difficulty.js`（三难度卡片）/ `dungeon.js`（枢纽+关卡+休整+奖励+飞升）**；
   `storage.js` 重写 v2（含 v1→v2 迁移）；`sprites.js` 增 beastResolve；index.html 全接线。
5. 设计：产出《副本Boss形象与关卡结构设计 v3.3》（20 Boss 名号/外观/文生图提示词/素材逻辑名），doc 共 32 份、文首戳统一 v3.3。
6. 验证：`smoke/playthrough/rebirth/dungeon-run/secret-test` 五条全绿；浏览器真机走查难度页、
   转世、城镇、秘境枢纽、第1关战斗、奖励简报，以及功法/物品/选目标三个浮层（含 8 项满员）布局一致。

### v0.0.2（天道意志接入，2026-09-25）

1. **新增 `core/tiandao.js`（`G.TianDao`）**：模式 remote/off（默认 off 模板兜底）；
   OpenAI 兼容调用（默认 `http://localhost:11434/v1` + `qwen2.5:7b-instruct-q4_K_M`），
   30s 超时、失败重试 1 次后模板兜底；世界状态包含当世灵根/境界/近期事件/跨世记忆/感应阶段；
   模型输出走 JSON 校验与禁忌词过滤；注视值 notify（破境/杀手/狼王埋点），
   每满 30 点触发一次非阻断「天道低语」，最多 3 次；问卦测试；DOM 隐藏输入框（支持 IME）。
2. **新增 `scenes/heaven.js`（天道拦魂）**：死亡不再直跳结算，先进全屏星河场景，
   最多 3 轮对话（默然叩首/只求长生/自由应答），完成后 talks+1 再进死亡结算。
3. **death.js**：本世摘要写入 `meta.heaven.memory`（最近 30 世）、watchTotal 累计。
4. 菜单（镇/山/洞/室内通用）改为「角色 / 天道设置 / 返回」面板；版本号升 v0.0.2。
5. 验证：smoke / playthrough（13 步基线不变）/ rebirth（+386）全过；
   浏览器实测模板问卦、远程问卦（745ms · 模型）、拦魂三轮、破境低语、跨世记忆落盘。

### v0.5.2（`814d8f2`）

用户报三件事，一次做完：

1. **角色面板的六维是错的** —— 角色只有攻击/生命/防御
   → **六维整体删除**（不是藏起来）。出身改发百分比（`save.originFx`），
   15 个发六维的天赋改写成百分比，死亡账目 `sixSum` → `atk`。
2. **不需要 1–16 岁选择事件加属性，太多太乱**
   → **幼年阶段整体删除**。`scenes/childhood.js` + `data/events.js` 已 `git rm`；
   `reincarnation.finish()` 直接产出入世态（16 岁 / `m0-1` / 进镇），并自己写 `birth` 大事记。
3. **主界面顶部做得很粗糙**，参考《烟雨江湖》《宝可梦》
   → **HUD 重做**：`HUD_H` 34 → 48；左圆头像 + 境界·第N世 + 气血/修为双条
   + 右上菜单 + 三格等宽资源；数值一律排到条的右侧（修掉 `155/155` 压在血条上的问题）。
   角色面板同步改成「攻击/气血/防御 三张主属性卡 + 2×2 次要属性格」。

验证：`smoke` 24/24、`playthrough` 新基线（见 §3.2）、`rebirth` 仙力 +386、
`shot` 42 张、`browser-probe` 六个场景页面错误全无。

---

## 9. 给下一个会话的最短上手路径

```bash
# 1) 拉代码 + 装依赖
git clone git@github.com:milkteacoffee/nichen.git && cd nichen
npm i -D @napi-rs/canvas && export NODE_PATH=./node_modules

# 2) 自检（三条都要过，且数字与 §3.2 一致）
node tools/smoke.js && node tools/playthrough.js && node tools/rebirth.js

# 3) 手玩
python -m http.server 8173 --directory www &
# 浏览器开 http://127.0.0.1:8173

# 4) 改完代码
node tools/smoke.js            # 必须过
node tools/shot.js 04_hud      # 看一眼 HUD 有没有被改坏
node tools/bench-frame.js      # 帧耗没退化
```

**改任何东西之前**，先读 §4（硬约束）和 §5（踩过的坑）。
**`www/assets/README.md` 是素材/美术方向的技术手册**，内容比本文件细，换皮前必读。
