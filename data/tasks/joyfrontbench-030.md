一级分类：网页 / 业务界面
二级分类：08_证据审阅与标注工作台

请你扮演一名资深审阅工具前端工程师，开发一个面向诉讼支持团队的“法庭证据时间线与证词矛盾标注工作台”。审阅员要阅读虚构证词、照片说明、通话摘要和保全记录，把精确文本片段结构化为时间线证据，处理自动矛盾提示，并生成每条结论都可回跳来源的案件摘要草稿。

这不是普通文档列表、静态时间线、AI 自动定罪工具或真实法律意见。所有人物和材料均为虚构，系统只做结构化审阅辅助；完成状态必须由可追溯引用链、矛盾处置理由、摘要和持久化审阅状态证明。

交付形式必须是一个可运行的多文件前端工程，而不是单个 HTML 文件。请使用 Vite + React + TypeScript 实现；SVG 时间线、localStorage、Vitest 和 Playwright 均可使用。禁止请求真实案件、在线 OCR、远程文档、AI 摘要服务、外部字体/图片或 API。`@playwright/test` 固定为 `1.58.1`，package.json 不得使用 `latest`。

## 一、产品边界与视觉方向

1. 首屏直接是四区审阅工作台：材料目录、文档阅读器、统一时间线、矛盾/摘要侧栏；不要做营销 hero 或普通 CRM 首页。
2. 视觉采用“纸质卷宗 + 法庭审阅台”：象牙纸、石墨正文、档案蓝、黄铜索引、酒红矛盾标记、细时间轴和来源编号。
3. 文档正文必须保持长文阅读舒适度；时间线和矛盾对照要密集但有清晰层级，不能把每个字段都做成独立浮卡。
4. 禁止黑蓝赛博监控台、通用项目管理看板、聊天应用、渐变营销页和无差别卡片墙。
5. 360px 使用“材料 / 时间线 / 矛盾 / 摘要”底部导航或等价结构；当前卷宗、撤销/重做和选中片段状态始终可恢复。
6. 页面明确标注“虚构演示数据 / 非法律结论”，导出只是本地草稿预览。

### 动态表现与审阅反馈

1. 动效应服务于证据关系理解，而不是让长文持续晃动。至少实现文本选区确认、标注落位、时间线事件插入/移动、引用链绘制、矛盾关系聚焦、来源回跳和 Undo/Redo 中的四类短反馈。
2. 从正文创建标注时，选区应以 120-300ms 的高亮/索引反馈连接到 composer；保存后对应时间线事件和引用编号出现，点击引用时正文目标获得短暂聚焦而不是仅瞬间跳转。
3. 矛盾对照可用克制的连接线、酒红边缘或短脉冲标明正在比较的两条 claim；确认、忽略或重新打开时，关系线和状态必须由结构化数据同步变化，不能播放与实际结论无关的装饰动画。
4. 时间线缩放、过滤和事件定位应平滑但不拖慢阅读；所有过渡建议不超过 350ms，不使用持续漂浮、纸张摇摆、闪烁或大面积视差。
5. `prefers-reduced-motion` 下改用立即定位、静态连接线和焦点描边。切换文档、Reset、坏值恢复和卸载后清理 scroll/resize observer、timer 和动画监听，避免旧高亮残留。

## 二、固定卷宗与领域模型

1. 提供固定虚构卷宗“镜湖案卷 · R-17”，日期固定为 `2025-04-18`，时间按 `Asia/Shanghai` 解释，不读取当前系统日期。
2. 至少包含 4 名虚构人物、6 份文档、36 个 seed 引用片段和 14 个 seed 时间线事件；文档类型至少有 testimony、photo、call、record。
3. 每个文档由稳定 paragraph id 和不可变正文组成；片段使用 `documentId + paragraphId + startOffset + endOffset` 定位。
4. 至少定义 `CasePerson`、`EvidenceDocument`、`EvidenceSpan`、`Annotation`、`TimelineEvent`、`ContradictionClaim`、`AnnotationState`、`CitationLink`、`ReviewSummary` 和 `PersistedReview` 类型。
5. 时间区间统一为 ISO datetime，并采用半开区间 `[start, end)`；`start < end`，仅端点相接不算重叠。
6. 可信度为 `0..100`；标注类型固定为 `alibi | location | phone-call | photo | conflict | uncertain`。

## 三、工程与模块要求

1. 必须包含 package.json、index.html、src/main.tsx、src/App.tsx、README.md。
2. package.json 至少提供 `npm run dev`、`npm run build`、`npm run test`、`npm run test:e2e`、`npm run lint` 或 `npm run typecheck`。
3. 至少拆分：
   - 人物、文档、seed spans、seed events 和标签数据；
   - 时间解析/规范化、排序、筛选、引用、矛盾检测和摘要派生；
   - 标注 reducer、级联删除、撤销/重做、持久化；
   - 材料目录、阅读器、标注 composer、时间线、矛盾面板、摘要和导出预览。
4. 推荐目录：src/components/、src/components/review/、src/domain/、src/state/、src/data/、src/hooks/、src/utils/、src/styles/、src/test/。
5. 排序、筛选、引用、矛盾、摘要、历史和 persistence 必须与 React 组件分离并可测试。
6. 不允许使用真实案件名称，不允许使用 `dangerouslySetInnerHTML`，不允许把完整页面或大段组件写成字符串模板。

## 四、文本选择与结构化标注

1. 用户只能在当前文档单一 paragraph 内选择非空连续文本；trim 后长度为 `1..500`，offset 必须与原文精确对应。
2. 跨 paragraph、只选空白、越界 offset 或与已有自定义标注完全相同的选择必须被拒绝并说明原因。
3. 为避免歧义，同一 paragraph 的自定义标注区间不得重叠；seed span 可与自定义标注重叠但不得被修改或删除。
4. 创建标注时必须选择类型、至少 1 名关联人物、合法开始/结束时间、规范化地点和可信度；备注可选。
5. 保存标注必须原子创建 `Annotation + EvidenceSpan`，使用稳定 sequence id；失败时不得留下半成品。
6. 阅读器以 React 节点切分文本并渲染高亮，不能通过 HTML 字符串注入。点击高亮显示来源、结构字段、备注、可信度和关联事件。
7. 删除仅允许用户标注，必须先显示影响范围；确认后执行第五节定义的级联更新。

## 五、时间线与引用链

1. 时间线按 start、end、稳定 id 排序；支持按人物、证据类型、最低可信度和 `annotated | unreviewed | all` 联合筛选。
2. “作为新事件加入”使用片段的结构化时间、地点、人物、类型和可信度创建一个 annotation-origin event；同一 span 只能生成一次该事件。
3. 用户也可拖拽或选择“链接到现有事件”；链接只新增 `CitationLink` 和必要 annotationId，不覆盖现有事件的时间、地点或人物。
4. 同一 span 在同一 event 中最多出现一次，但可被不同 event 引用。
5. CitationLink 至少包含 id、eventId、documentId、spanId 和 label。点击 event 或摘要引用跳回精确文档片段；点击片段可高亮所有相关 event。
6. 修改 event 可信度或引用后，筛选、矛盾和摘要必须立即从同一 state 重新派生。
7. 删除用户标注时：
   - 删除对应 custom span；
   - 删除完全由该标注生成的 annotation-origin event；
   - 从其他 event 移除该 citation/annotationId；
   - 重新派生矛盾和摘要；
   - seed span 和无关引用保持不变。

## 六、结构化矛盾检测与处置

### 1. 检测规则

自动“同人异地”提示只在以下条件全部满足时生成：

1. 两个不同 event 共享至少一个 personId；
2. `[start, end)` 严格重叠；
3. 两个 event 的 canonical location 不同；
4. 两个 event 均至少保留一个 CitationLink。

地点先 trim、压缩空白、统一大小写/标点，再通过本地 alias 表规范化；不得只做正文字符串包含判断。

### 2. 稳定派生

1. claim id 由 `personId + 排序后的 event ids` 稳定生成，包含交集时间、两个 canonical location、event ids、citation ids 和状态。
2. timeline 变化后重新检测；只有签名仍相同的 claim 才保留人工状态/理由，否则作为新 suggested claim。
3. 状态固定为 `suggested | confirmed | rejected | merged`。

### 3. 人工处置

1. Confirm/Reject 必须填写非空理由；操作进入 undo history，并影响摘要。
2. Merge 只能把 source claim 合并到同一人物且时间区间重叠的 target claim，必须填写理由。
3. merge 不删除 source：source 标记 `merged` 并记录 `mergedIntoId`，target 保留自己的状态和全部引用；摘要只对 target 计一次主要问题。
4. 点击 claim 的任一来源可跳到对应 timeline event，再回跳文档片段。

## 七、Undo/Redo、摘要与导出

1. undo/redo 保存最多 30 个完整 present snapshot。
2. 进入历史的事实动作至少包括：新增/删除标注、新增/链接引用、修改可信度、确认/驳回/合并矛盾。
3. 文档切换、筛选、选中片段、滚动和 timeline density 不进入历史，避免污染撤销栈。
4. undo 后执行新事实动作必须清空 redo；恢复 snapshot 时引用链、矛盾和摘要不能断裂。
5. `ReviewSummary` 必须纯派生：
   - confirmed claim 形成结论并携带处置理由；
   - support chain 列出可点击 event/citation/document/span；
   - suggested claim、uncertain 标注和低可信事件形成待确认问题；
   - rejected 不作为结论，merged 不重复计数。
6. 导出预览显示案件名、非法律结论声明、结论、支持链、待确认问题和统计；只提供本地打印/保存，不请求服务端。

## 八、持久化、坏值与完整闭环

1. localStorage 保存 schema version、seed、present review state、filters、current document 和 timeline view；reload 恢复这些内容。
2. undo/redo past/future 不要求跨 reload 保留，刷新后从恢复的 present 建立空历史；README 必须明确。
3. 持久化校验 document/span/event/claim 引用是否存在、offset 是否越界、时间是否合法、citation 是否重复，并限制日志/标注数量。
4. 无效 JSON、错误版本、悬空引用、越界 offset、重复 id 或字段坏值不能白屏；回退 seed，显示恢复横幅和“重新载入种子”入口。
5. Reset Seed 清除全部用户标注、人工矛盾处置、筛选和视图，恢复固定卷宗。

完整闭环：

```text
Open Document -> Select Text -> Annotate
-> Add/Link Timeline -> Detect Conflict
-> Confirm/Reject/Merge -> Summary
-> Jump Citation -> Undo/Redo -> Reload/Reset
```

## 九、响应式与可访问性

1. 360px 下可选择文档、阅读正文、创建标注、加入时间线、处理矛盾、查看摘要和回跳来源。
2. 高亮类型、可信度、矛盾状态和筛选不能只依赖颜色，提供文字/图标/状态标签。
3. 文档正文、时间线 event、拖拽引用和 claim 均有键盘等价操作。
4. composer、确认删除、合并和导出 dialog 具有可读 label、焦点圈定；Escape 关闭并返回触发元素。
5. 底部导航和选中片段提示不能遮挡正文、表单保存按钮或引用目标。
