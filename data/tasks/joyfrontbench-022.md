一级分类：网页 / 业务界面
二级分类：检测系统

请你扮演一名资深产品型前端工程师，擅长复杂业务状态、时间轴交互、数据复核系统和可测试前端架构。请实现一个完全本地运行的野生动物摄像头告警与误报复核系统，用于模拟多台野外相机在一天内捕捉动物活动，并让用户完成检测事件复核、告警规则配置、误报处理和告警发送队列排查。

交付形式必须是一个可运行的多文件前端工程，而不是单个 HTML 文件。请使用 Vite + React + TypeScript 实现；Canvas、SVG、IndexedDB/localStorage、Vitest 和 Playwright 均可通过 npm 依赖引入。禁止调用真实摄像头、真实识别模型、短信服务、外部 API 或远程图片；所有相机、帧序列、检测框、告警事件和发送结果必须由 deterministic seed 生成。

工程结构要求：

1. 必须包含 package.json、index.html、src/main.tsx、src/App.tsx、README.md。
2. package.json 至少提供：
   - npm run dev
   - npm run build
   - npm run test
   - npm run lint 或 npm run typecheck
3. 至少拆分出以下职责模块，不要把主要逻辑堆在 App.tsx：
   - 相机、物种、检测框、帧样本和告警规则数据
   - deterministic seed 数据生成器
   - 视频帧播放器和时间轴组件
   - 检测框 overlay、事件列表和筛选面板
   - 告警规则编辑器和规则测试预览
   - 告警发送队列与 retry/suppression 逻辑
   - 复核状态 reducer 和物种修正逻辑
   - localStorage/IndexedDB 持久化与坏值回退工具
   - 时间格式、置信度格式和统计派生工具
5. 至少定义 CameraTrap、FrameSample、DetectionBox、SpeciesLabel、AlertRule、AlertEvent、ReviewDecision、DetectionTrack、AlertDeliveryState 等 TypeScript 类型。AlertRule 需含 enabled 开关与 suppressionWindowMinutes；DetectionBox/AlertEvent 需能表达“人工补标”来源；AlertDeliveryState 需含状态（pending/sent/failed/suppressed）、尝试次数与 suppressed 原因。
6. 事件生成、规则匹配、重复告警抑制、时间窗口聚合、物种修正传播、复核状态迁移、复核结论对告警的联动、多规则风险裁决、发送/retry 成败判定必须放在可测试的纯函数、selector 或 reducer 中。
7. 不允许使用 dangerouslySetInnerHTML，不允许把完整页面或大段组件写成字符串模板。

核心体验要求：

1. 页面必须像一个真实的野外相机复核工作台，而不是动物记录表格或普通监控 dashboard。
2. 至少准备 4 台相机、8 种动物、80 个检测事件，并包含误报、漏报、低置信度和重复告警场景。
3. 左侧显示相机列表、在线/离线状态、最近触发时间和待复核数量。
4. 中央提供可播放的模拟视频帧视图，视频可以用 Canvas/SVG 程序化生成，但必须有播放、暂停、跳转和帧级检测框。
5. 视频帧上显示动物检测框、物种标签、置信度和当前复核状态。
6. 视频帧必须渲染清晰可辨识的动物主体或误报干扰物，检测框应包围对应目标，不得仅显示空背景和检测框。正常、低置信度和重复事件应显示动物与检测框；漏报场景应显示动物但不显示检测框；误报场景应显示岩石、枝叶等非动物目标与错误检测框。
7. 下方提供一天时间轴，标记检测事件、告警事件、复核完成点和 suppressed 事件。
8. 用户可以拖动 scrubber 定位到任意时间点，也可以点击事件让播放器跳到对应帧并高亮检测框。
9. 用户可以将检测标记为 confirmed、false positive、needs review，并能修正物种标签。对漏报画面（有动物但无检测框），用户可以在该帧手动补标一个检测框（补标检测）；补标后的检测进入正常的复核与告警流程。补标属于人工标注，与复核结论、物种修正一样，规则重算时不得丢失。
10. 支持按物种、相机、复核状态、置信度范围和告警状态筛选事件。
11. 显示复核进度、未处理高风险事件、误报率和告警发送成功率。统计口径必须明确并在页面可解释：

- 复核进度 = 已复核事件数 / 需复核事件总数。
- 误报率 = 被标记为 false positive 的事件数 / 已复核事件数（基于用户复核结论而非 seed 真值，因此复核操作会实时改变该值；已复核数为 0 时显示为 0 或 N/A）。
- 告警发送成功率 = sent 状态告警数 / （sent + failed）状态告警数，suppressed 与 pending 不计入分母。
- 未处理高风险事件 = 命中高风险规则、且复核状态仍为 needs review 的事件数。

12. 相机的在线/离线是 seed 生成的静态属性（离线相机在模拟当天没有任何检测事件，或在某个 seed 指定的离线时刻后不再产生检测事件）。离线相机仍可查看其历史帧与既有检测，但用户在离线相机上不能使用补标检测功能，也不会有新的检测/告警产生。
13. 用户复核 session、筛选器和当前相机要持久化，刷新页面后自动恢复；坏值不能导致白屏。

告警规则要求：

1. 提供规则编辑器，支持配置物种、相机、时间段、置信度阈值、风险等级，以及抑制时间窗口（duplicate suppression window，单位分钟）。每条规则都有 enabled/disabled 开关，禁用的规则不参与匹配、预览与发送；开关状态与筛选器一样需要持久化。时间段用小时区间表示，其中“夜间”约定为 20:00–06:00。
2. 至少内置一条规则，例如“夜间检测到黑熊且置信度 >= 0.72 时告警”。seed 生成的数据必须保证内置规则在默认状态下真实命中若干事件（即存在夜间、目标物种、达到阈值的检测），从而能直接演示告警触发、去重抑制与发送队列。
3. 支持规则测试：用户选择时间范围后，预览会触发哪些告警、哪些会被 suppressed、哪些会进入发送队列。
4. 规则修改后，历史告警模拟结果必须可重新计算。重算规则如下：告警是否触发、是否 suppressed、风险等级等“规则派生结果”按最新规则重新计算；人工复核结论、物种修正和补标检测等“人工标注”不能丢失，重算后继续作用于新结果。发送队列中由重算导致不再成立的告警（例如规则禁用或不再匹配）转为 suppressed 而非删除，保留可追溯记录。
5. 重复告警抑制必须基于 camera + species + time window，不能只按事件 id 去重。
6. 模拟发送队列必须包含 pending、sent、failed、suppressed 四种状态。一条告警首次发送的成败由 deterministic seed 决定（不依赖真实网络），因此发送成功率是可复现的。
7. failed 告警可以 retry。retry 的成败同样由 seed 决定，但必须保证每条 failed 告警在有限次 retry 内可以成功（例如按 seed 预设“第 N 次重试成功”），使发送成功率能通过 retry 提升。retry 只更新该告警的投递状态与尝试次数，不得生成重复告警记录。
8. 用户修正物种后，相关告警预览、风险统计和队列结果必须同步更新。由于去重键包含 species，物种修正可能导致去重分组重排（原被抑制的重复可能解除抑制，反之亦然）；已处于 sent/failed 终态的投递记录不被物理删除，若因修正而不再成立则转为 suppressed 并标注原因，保证队列可追溯、成功率变化可解释。
9. 复核结论必须与告警联动：被标记为 false positive 的事件，其尚处于 pending 的告警转为 suppressed（原因记为 false-positive）；已 sent/failed 的告警保留记录但计入“已发出的误报”统计，不再作为待处理项。被标记为 confirmed 或 needs review 不抑制其告警。未处理高风险事件（needs review 且命中高风险规则）需在统计中突出显示。
10. 规则匹配与风险裁决：一个事件的风险等级由所有命中的 enabled 规则中风险等级最高者决定；不命中任何规则的事件风险等级为“无/最低”，不进入告警队列。多条规则命中时按此优先级合并，不产生重复告警。
11. 抑制窗口以规则配置的 duplicate suppression window 为准（未配置时使用系统默认值，例如 10 分钟）；同一 camera + species 且落在同一窗口内的多次触发只保留首个告警，其余记为 suppressed。

交互和稳定性要求：

1. 播放器连续 Play/Pause 不得创建多个 timer。
2. 时间轴、帧视图、事件列表和统计卡片必须读取同一份 event state，不能各自维护互相矛盾的数据。
3. 所有关键操作都要有键盘路径和清晰 focus 状态。
4. modal、popover 或 drawer 打开后必须处理 focus，Escape 可关闭并返回合理触发元素。
5. 360px viewport 下仍可完成事件复核、规则开关、时间轴跳转和 retry 操作。
6. prefers-reduced-motion 下减少非必要动画，但播放状态、检测框变化和复核反馈仍然清楚。
7. 控制台不能有运行时报错、资源 404、React key 警告或未处理 Promise rejection。
