一级分类：应用
二级分类：可交互模拟器

请你扮演一名资深体育模拟前端工程师，擅长回合制比赛引擎、能力驱动概率、垒包状态机、投手调度、胜率模型与可复现 replay。请实现一个「棒球比赛逐球模拟与战术调整器」：用户管理一支球队，设置先发阵容、投球与跑垒策略，逐球模拟比赛，管理投手体力与换人，并查看胜率时间线与逐球员 box score 复盘。本题的难度不在美术，而在模拟深度与状态机正确性——很多实现会用"固定概率表 + 能力值当摆设 + 所有人进一垒"蒙混，本题要求结果由能力驱动、垒上推进符合真实棒球情境、可复现可测试。

交付形式必须是一个可运行的多文件前端工程，而不是单个 HTML 文件。请使用 Vite + React + TypeScript 实现；SVG、Canvas、Vitest 与 Playwright 均可通过 npm 依赖引入。禁止请求真实体育 API、远程球员数据、外部图片或在线概率服务；所有球员、能力值、概率与比赛事件必须由 deterministic seed + pseudo random generator 生成，可测试且可复现。

## 视觉与场景风格

1. 采用电视转播计分风：顶部 scorebug（比分、局数、出局、balls/strikes、垒包缩略），中部球场示意与逐球叙事，侧栏战术/名单/胜率，信息密度高但清晰。
2. 球场、垒包、跑者、当前打者/投手 matchup、胜率曲线与 box score 需有清晰视觉层级与图例。
3. 是可实时交互的逐球模拟器，不是静态比分牌、球队 dashboard 或投注分析页。

## 工程结构要求

1. 必须包含 package.json、index.html、src/main.tsx、src/App.tsx、README.md。
2. package.json 至少提供 npm run dev、npm run build、npm run test、npm run lint 或 npm run typecheck。
3. 至少拆分出以下职责模块：
   - 球员能力、阵容、投手状态、打席、垒包、局数、战术与名单数据
   - deterministic RNG、能力驱动 matchup 概率、垒上推进状态机、换局、比分与终局判定
   - 投手体力/换人/代打、战术影响、胜率派生、事件日志 replay、box score 派生
   - scorebug/球场、战术面板、名单/换人面板、胜率时间线、事件日志、赛后复盘组件
5. 至少定义 Player、PlayerRatings、LineupSlot、PitcherState、AtBatState、BaseState、InningState、StrategySetting、SubstitutionState、GameEvent、WinProbPoint、BoxScore 等 TypeScript 类型。
6. matchup 概率、balls/strikes、垒上推进、换局、比分、投手体力、战术影响、胜率、事件 replay 与 box score 必须放在可测试的 simulation/domain 模块中。
7. 不允许使用 dangerouslySetInnerHTML，不允许把完整页面或大段组件写成字符串模板。

## 核心体验要求

1. 页面必须是逐球比赛模拟器：显示当前 inning/半局、出局数、balls、strikes、比分、当前打线位置、垒包占用、当前打者与投手 matchup 说明。
2. 两支球队各至少 9 名球员（含投手），每名球员有基础能力值（如打者 contact/power/discipline、投手 control/velocity/stamina）。
3. 用户可调整 batting order 并校验阵容合法（9 人、无重复、投手位合理）。
4. 投球策略（保守/强攻/诱导滚地/三振优先）与跑垒策略（保守/正常/激进）可选，中途可调整。
5. 点击 Sim Pitch 逐球推进；支持 Sim At-Bat 与 Sim Half Inning。
6. 事件至少包括 strike、ball、single、double、triple、home run、walk、strikeout、groundout、flyout、double play、sacrifice、error、runner thrown out。
7. 赛后显示逐球员 box score、关键回合与胜率时间线。
8. 360px viewport 下可查看 scorebug、球场、胜率与核心操作。

## 重点难点要求

以下机制是逐球体育模拟的高频失分点，请确保模拟深度与状态机正确：

1. **能力驱动的 matchup 概率**：每一球的结果分布必须由当前打者与投手的能力值共同派生（如打者 discipline 高更易选到 walk、power 高更易长打，投手 control 高更少 walk、velocity/strikeout 倾向更多三振，体力下降后被打概率上升），并叠加投球/跑垒策略与 seed。更换阵容或球员能力必须改变结果分布。高频失败反例：固定概率表、能力值只展示不参与计算、换人换阵容结果不变。
2. **情境化垒上推进状态机**：垒上推进必须符合真实棒球情境，而非"所有人进相同垒数"：
   - 一垒有人且不足两出局的滚地球可触发**双杀**；
   - 三垒有人的高飞球出局可触发**高飞牺牲**得分（tag-up）；
   - 强制进垒与非强制进垒区分正确（如满垒保送挤回本垒）；
   - 激进跑垒策略下跑者可能多进一垒，也可能在**试图额外进垒时被触杀**出局；
   - 任何时刻不得出现两名跑者占同一垒。
3. **投手体力、换投与代打**：投手每球消耗体力，体力下降影响其 matchup 效果；用户可在任意打席间**更换投手或代打/代跑**，被换下的球员不可再次上场；名单/换人状态需一致且可持久化到当前对局。
4. **胜率时间线与完整 box score 联动**：提供一条由局/比分/垒-出局状态确定性派生、逐球更新的胜率（win probability）曲线，关键转折回合高亮；hover 曲线某点与事件日志/回合联动。box score 必须是**逐球员**统计（打者 AB/H/R/RBI/BB/K、投手 IP/H/R/ER/K/BB），由真实事件派生、非写死。
5. **确定性、战术影响与 replay**：同一 seed + 同一操作序列（含换人、策略调整）必须产生同一比赛结果；战术调整只影响**后续**事件分布与解释，不得改写历史事件；replay 使用 event log 复现、不重新随机；reset same seed 回到可复现初始状态。

## 比赛规则和一致性要求

1. Balls/strikes 计数符合棒球规则，walk/strikeout 后重置打席；三出局换边；打线轮转跨 inning 延续。
2. 九局结束结算，平局的处理规则必须明确（extra innings 或明确 tie 规则）。
3. Sim At-Bat / Sim Half Inning 完成后状态一致、可取消或不产生脏状态。
4. invalid lineup 必须阻止开赛或给出明确错误，不让 simulation 崩溃。
5. 控制台不能出现运行时报错、资源 404、React key 警告或未处理 Promise rejection。
