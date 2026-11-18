一级分类：应用
二级分类：3D游戏

请你扮演一名资深游戏前端工程师，设计并实现一个完全本地运行的原创 3D 第一人称射击游戏《Pulse Arena》。

玩家需要在一个封闭的 3D 竞技场中生存并击败持续出现的敌方无人机。游戏必须包含真正可操作的第一人称移动、鼠标视角控制、射击、换弹、敌人 AI、可见敌方弹道、生命值、可站立高低差碰撞、阶梯式波次难度、累计击杀武器升级、计分和游戏结束流程。

最终结果必须是一个实际可玩的浏览器 FPS，而不是静态 3D 场景、动画演示、只支持按钮控制的假 FPS 或预渲染效果。

所有游戏名称、地图、武器、敌人、美术和 UI 必须原创。禁止直接复制或明显模仿现有商业游戏的角色、地图、美术资源、Logo、音效或界面。

交付形式必须是一个可运行的多文件前端工程，而不是单个 HTML 文件。

必须使用 Vite + React + TypeScript 实现。

允许通过 npm 安装 Three.js、React Three Fiber、drei、zustand、vitest 等依赖。

禁止调用真实外部 API、远程游戏服务器、云数据库或需要 API Key 的服务。

不得依赖远程 CDN 图片、模型或纹理。游戏应尽量使用程序化几何体、CSS、SVG 或本地生成的简单素材。

必须至少包含：

* package.json
* index.html
* src/main.tsx
* src/App.tsx
* README.md

并提供：

* npm run dev
* npm run build
* npm run typecheck
* npm run test

---

## 一、第一人称控制

玩家必须支持：

* WASD 移动
* 鼠标控制水平和垂直视角
* 点击游戏区域后进入 Pointer Lock
* Esc 可以退出 Pointer Lock
* Space 跳跃
* Shift 冲刺

要求：

1. 玩家移动方向必须相对于当前摄像机朝向，而不是固定世界坐标。
2. 鼠标上下视角必须限制俯仰角，避免摄像机无限翻转。
3. 玩家不能穿过竞技场墙壁、掩体或其他实体障碍。
4. 玩家不能掉出地图。
5. 玩家不能通过连续按 Space 无限叠加跳跃。
6. 冲刺速度必须明显高于正常移动速度。
7. 高速冲刺时不能一步跨过较薄的掩体。应使用分段移动、扫掠检测或其他等效方式避免 tunneling。
8. 高台、坡道和指定箱体顶部必须参与高度碰撞。玩家应能落在箱顶、在箱顶移动，并能正常走下箱子。
9. 玩家处于箱体边缘或发生轻微碰撞重叠时，不得永久卡死；继续向外移动必须能够脱离障碍。

游戏失去焦点、暂停或 Game Over 后，不得继续响应移动和射击。

---

## 二、3D 竞技场

创建一个原创封闭竞技场。

至少包含：

* 地面
* 四周边界墙
* 8 个以上不同位置、不同高度或尺寸的掩体
* 至少一处可站立的高台结构
* 至少一个能够正常上下的坡道或楼梯
* 至少一个能够从高台助跑跳到并稳定站立的箱体顶部
* 至少 4 个敌人出生区域

场景应具有环境光、方向光、局部光源、阴影、雾效或其他明显的空间深度表现。

场景不能因为曝光过低或大面积纯黑而看不清。玩家出生视角中必须能够清楚辨认地面、中央坡道、多个掩体和敌人轮廓；发光材质只能作为强调，不能代替基础照明。

竞技场必须能够让玩家绕掩体移动，而不是只有一个空房间。

竞技场 Canvas 应铺满主视口，不能把实际游戏缩成卡片中的小型 3D 预览。

不得依赖下载的商业地图或第三方游戏资产。

---

## 三、武器与射击

玩家初始拥有一把原创能量步枪。

默认属性：

* Magazine Size：30
* Reserve Ammo：120
* Damage：25
* Fire Rate：约每秒 6 发
* Reload Time：约 1.5 秒

必须支持：

* 鼠标左键射击
* R 键换弹
* 弹匣为空后无法继续射击
* Reserve Ammo 不得出现负数
* Reload 后从 Reserve Ammo 正确补充弹匣
* Reload 期间不可射击
* 已满弹匣时不得无意义消耗备用弹药

射击时必须有明显反馈，例如：

* muzzle flash
* hit marker
* 枪口或准星反馈
* 敌人受击闪烁
* 简单射击音效或程序化反馈

玩家武器可以使用从准星中心发出的 raycasting / hitscan 实现命中检测，不要求为玩家子弹模拟真实弹道物理。敌人的攻击弹道要求见下一节，不能用直接扣血替代。

准星中心与实际射击方向必须一致。

### 武器成长与击杀奖励

累计击杀必须自动升级武器，采用以下五档基准数值：

| 等级 | 累计击杀要求 | Damage | Fire Rate | Magazine | Reload | 升级备用弹药奖励 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LV 1 | 0 | 25 | 约 6.0/s | 30 | 1.50s | 0 |
| LV 2 | 6 | 30 | 约 7.0/s | 36 | 1.40s | +24 |
| LV 3 | 16 | 36 | 约 7.8/s | 42 | 1.30s | +36 |
| LV 4 | 32 | 43 | 约 8.6/s | 48 | 1.20s | +48 |
| LV 5 | 55 | 52 | 约 9.5/s | 54 | 1.05s | +60 |

升级发生时必须：

* 立即切换到新武器属性
* 将当前弹匣补满到新的 Magazine Size
* 增加对应的 Reserve Ammo 奖励
* 取消正在进行的 Reload，避免旧弹匣容量污染新等级
* 显示短暂且明显的 Weapon Evolved 动态提示

达到 LV 5 后显示 Max Level，不得继续产生不存在的等级。

---

## 四、敌方无人机

敌人全部使用原创程序化几何体表示，例如不同颜色和尺寸的低多边形机器人。

至少实现两种敌人：

### Scout Drone

* HP：75
* 移动速度较快
* 攻击伤害较低

### Heavy Drone

* HP：150
* 移动速度较慢
* 攻击伤害较高

敌人至少包含以下状态：

* Spawn
* Patrol
* Chase
* Attack
* Dead

要求：

1. 敌人生成后能够主动寻找或接近玩家。
2. 玩家进入攻击范围后，敌人能够周期性攻击玩家。
3. 敌人的攻击必须降低玩家 HP。
4. 敌人死亡后必须停止移动和攻击。
5. 死亡敌人应从活动敌人集合中移除。
6. 敌人不得在死亡后继续造成伤害。
7. 敌人不得无限生成在玩家当前位置上。
8. 敌人生成位置应与玩家保持最小安全距离。

不要求复杂导航网格，但敌人不能明显永久卡死在墙体中。

### 敌方可见弹道

敌人进入 Attack 状态后，必须从自身位置发射可见的飞行能量弹，不能在攻击计时结束时直接扣除玩家 HP。

要求：

1. Scout 与 Heavy 的弹体应在颜色、大小、速度或尾迹上容易区分。
2. 弹体应沿发射时确定的方向飞行，并具有明显弹头、发光尾迹或等效动态反馈。
3. 只有弹体真正命中玩家碰撞体后才能降低 HP。
4. 地面、边界墙、高台和掩体必须能够拦截弹体。
5. 弹体应使用分段采样、线段扫掠或等效检测，避免高速弹体穿过玩家或薄墙。
6. 弹体超出生命周期、击中世界或命中玩家后必须及时移除。
7. Pause、Wave Transition 或 Game Over 时，在途弹体不得继续移动或造成伤害。

---

## 五、生命值与战斗状态

玩家：

* Max HP：100
* Initial HP：100

玩家受到敌人攻击后降低 HP。

HP 不得低于 0。

当 HP = 0 时：

* 玩家死亡
* 禁止继续移动
* 禁止继续射击
* 敌人攻击停止影响游戏结果
* 游戏计时停止
* 显示 Game Over 面板
* 显示本局成绩
* 提供 Restart 按钮

---

## 六、Wave 生存系统

游戏开始后进入 Wave 1。

每 3 波提升一个 Threat Level：

```text
Threat Level = floor((max(1, Wave) - 1) / 3) + 1
Enemy Count = 3 + (Wave - 1) + (Threat Level - 1) * 2
```

基准敌人数必须符合：

| Wave | Threat Level | Enemy Count |
| ---: | ---: | ---: |
| 1 | 1 | 3 |
| 2 | 1 | 4 |
| 3 | 1 | 5 |
| 4 | 2 | 8 |
| 5 | 2 | 9 |
| 6 | 2 | 10 |
| 7 | 3 | 13 |

Wave 规则：

* 每一波生成对应数量的敌人
* 当前波所有敌人被击败后才能进入下一波
* 波次之间存在约 3 秒倒计时
* Wave 越高，敌人生命值和攻击伤害持续增强
* Threat Level 提升时额外增加敌人数、生命倍率、伤害倍率和 Heavy 出现比例
* Wave 3 → 4、Wave 6 → 7 等升级波必须显示明显的 Threat Escalation 提示

HUD 必须清晰显示：

* 当前 Wave
* 当前 Threat Level
* 剩余敌人数

不得在上一波敌人仍存活时直接开始下一波。

---

## 七、计分系统

玩家击败敌人获得分数。

可增加额外奖励：

* 连续击杀
* 快速完成一波
* 高命中率

至少必须保证基础击杀分数计算准确。

Kill Count 同时作为武器升级进度，不得只显示升级文案而不实际改变 Damage、Fire Rate、Magazine Size 和 Reload Time。

Game Over 后显示：

* Score
* Wave Reached
* Enemies Defeated
* Accuracy
* 最终 Weapon Level

Accuracy 应根据：

shots hit / shots fired

计算。

---

## 八、HUD

游戏界面必须包含明显且实时更新的 HUD。

至少显示：

左下：

* HP
* 当前生命值

右下：

* 当前弹匣子弹
* Reserve Ammo
* Weapon Level / Weapon Name
* Weapon Damage
* 当前击杀数与下一等级阈值
* 武器升级进度条或等效进度反馈

顶部：

* Wave
* Threat Level
* Remaining Enemies
* Score

中心：

* Crosshair

可额外包含：

* Hit Marker
* Reload 提示
* Damage Direction Indicator
* Wave Start / Threat Escalation 提示
* Weapon Evolved 提示

HUD 不应遮挡主要游戏视野。

HUD 必须在常见桌面视口（验收基准为 1440 × 900）内保持完整；生命值面板、弹药面板、顶部状态栏和准星不得互相重叠、超出视口或造成横向滚动。

---

## 九、暂停系统

按 P 或点击 Pause 可以暂停游戏。

暂停后：

* 敌人停止移动
* 敌人停止攻击
* 在途敌方弹体冻结
* Wave 计时停止
* Reload 倒计时停止
* 玩家不能射击
* 玩家不能移动

显示 Pause Menu。

Pause Menu 至少包含：

* Resume
* Restart

恢复后应继续当前游戏，而不是重新初始化。

---

## 十、游戏状态

至少明确维护以下状态：

* menu
* playing
* paused
* wave-transition
* game-over

不得仅通过多个无关联 boolean 随意组合游戏状态。

---

## 十一、开始界面

进入应用后，不应立即开始战斗。

显示 Start Screen。

至少包含：

《Pulse Arena》

以及操作说明：

* WASD Move
* Mouse Look
* Left Click Fire
* R Reload
* Space Jump
* Shift Sprint
* P Pause

提供：

Start Game

点击后进入游戏。

---

## 十二、重新开始

Restart 必须彻底恢复游戏状态。

包括：

* HP = 100
* Magazine = 30
* Reserve Ammo = 120
* Score = 0
* Wave = 1
* Kill Count = 0
* Weapon Level = 1
* Weapon Upgrade Progress 清零
* Accuracy statistics 清零
* 敌人重新初始化
* 在途弹体全部清除
* 玩家位置回到出生点

不得残留上一局敌人、Timer、event listener 或 animation loop。

---

## 十三、本地持久化

使用 localStorage 保存：

* Highest Score
* Highest Wave

刷新页面后仍应保留。

Start Screen 或 Game Over 页面必须显示历史最佳成绩。

提供：

Reset Records

用于清除最佳成绩。

---

## 十四、Debug Panel

为了便于自动化测试，必须提供可观察的游戏状态。

在开发环境或通过页面上的 Debug 开关启用一个 Debug Panel。

至少显示：

* Player HP
* Player Position
* Ammo
* Reserve Ammo
* Score
* Wave
* Threat Level
* Enemy Count
* Weapon Level
* Weapon Damage
* Game State
* Shots Fired
* Shots Hit

并为关键值提供稳定 DOM 标识，例如：

* data-testid="player-hp"
* data-testid="ammo"
* data-testid="reserve-ammo"
* data-testid="score"
* data-testid="wave"
* data-testid="threat-level"
* data-testid="enemy-count"
* data-testid="weapon-level"
* data-testid="weapon-damage"
* data-testid="game-state"

Debug Panel 可以默认折叠，但必须能够打开。

不得让核心游戏逻辑仅存在于 Three.js canvas 内而完全无法通过 DOM 或程序状态验证。

---

## 十五、工程结构要求

不得把 Three.js 场景、游戏状态、敌人 AI、HUD 和所有逻辑全部写进 App.tsx。

---

## 十六、性能与稳定性

要求：

* 不得因为 React state 高频更新导致页面明显卡顿
* animation loop 中避免不必要的大量 React re-render
* EventListener 必须正确清理
* requestAnimationFrame 或 Three.js animation loop 不得在 Restart 后重复创建
* 敌人死亡后相关资源需要合理清理
* 弹体命中或超时后必须清理，暂停时不得持续创建新弹体
* 长时间运行不应持续累积不可见敌人对象

目标是在普通桌面浏览器中保持流畅运行。

---

## 十七、视觉要求

整体风格采用原创科幻低多边形竞技场。

不要求复杂纹理和真实人物模型。

视觉方向应为清晰、明亮、具有竞技可读性的科幻训练场。颜色不能只依赖深蓝或黑色；应使用青色、白色、黄色、红色等功能性色彩区分地形、危险、敌人类别和状态。

优先使用：

* primitive geometry
* emissive material
* procedural shapes
* CSS HUD
* simple particle effects

场景必须具有持续可见的动态表现，而不是静态几何体：

* 敌人悬浮、旋翼、巡逻或追击运动
* 玩家枪械后坐、muzzle flash 或等效开火反馈
* 飞行能量弹及其发光尾迹
* 敌人受击闪烁和 Hit Marker
* 玩家受伤的屏幕反馈
* Wave Transition 扫描线或倒计时动效
* Threat Escalation 和 Weapon Evolved 动效

必须让以下元素视觉上容易区分：

* 玩家受到伤害
* Scout Drone
* Heavy Drone
* 可碰撞墙体
* 当前准星
* 命中反馈
* 敌方弹体及其飞行方向
* Game Over
* Wave Transition
* Threat Escalation
* Weapon Upgrade

不得使用任何受版权保护的商业游戏 Logo、角色、地图截图、音频或专有素材。

---
