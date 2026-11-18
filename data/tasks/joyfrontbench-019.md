一级分类：演示 / 概念可视化
二级分类：3D交互演示

请你扮演一名资深科学可视化前端工程师，擅长 Three.js、3D 选择交互、clipping 裁剪、数据驱动几何、教学模型与 WebGL 生命周期管理。请实现一个「固态电解质晶格与离子迁移 3D 教学/设计工作台」：系统展示一个固态电解质晶格的简化 3D 结构（不同元素位点、掺杂原子、空位、离子迁移路径），用户可旋转视角、拾取原子、真实切片剖开晶格、交互式构建并比较离子迁移路径、播放迁移动画并联动能垒曲线。本题的难度不在美术，而在真实的 3D 交互与 WebGL 生命周期——很多实现会用"静态彩球 + 过滤原子 + 硬编码能垒"蒙混，本题要求这些行为真实、数据驱动、可复现、可测试。

交付形式必须是一个可运行的多文件前端工程，而不是单个 HTML 文件。请使用 Vite + React + TypeScript 实现；Three.js、React Three Fiber、Canvas/SVG 图表、Vitest 与 Playwright 均可通过 npm 依赖引入。禁止依赖远程 glTF、外部模型、远程图片、真实科研数据库或 API；所有晶格结构、掺杂配置、路径与能垒数据必须由本地 seed 生成或由本地几何确定性派生。科学准确性可以是教学简化模型，但必须自洽、可解释、可测试。

## 视觉与场景风格

1. 采用科研级深色实验室视觉：深色背景、克制的高光与景深感，突出晶格结构本身。
2. 原子、掺杂位点、空位、键、配位多面体、迁移路径必须有清晰的视觉层级与图例，一眼可区分元素类型与特殊位点。
3. 达到教科书插图级的可读性：结构清晰、标注明确、不杂乱，但不是静态插画而是可实时交互的 3D 场景。

## 工程结构要求

1. 必须包含 package.json、index.html、src/main.tsx、src/App.tsx、README.md。
2. package.json 至少提供 npm run dev、npm run build、npm run test、npm run lint 或 npm run typecheck。
3. 至少拆分出以下职责模块：
   - 晶格、元素、掺杂、空位、迁移路径与能垒数据
   - 晶格生成、邻接计算、掺杂替换、切片过滤、路径相邻性校验与能垒派生
   - Three.js 场景、primitive geometry、raycast selection、clipping 裁剪与资源 dispose
   - 视角控制、切片控制、路径构建/动画、图例与能垒曲线组件
   - 配置持久化、WebGL fallback、resize 与 reduced-motion 降级
5. 至少定义 AtomSite、ElementType、LatticeCell、DopantConfig、VacancySite、MigrationPath、EnergyProfile、ViewMode、SceneController 等 TypeScript 类型。
6. 晶格生成、邻接关系、路径相邻性校验、能垒派生、瓶颈能量、切片过滤与 selection invalidation 必须与 Three.js render component 分离并可单元测试。
7. Three.js 模块必须清理 geometry、material、texture、animation frame、事件监听与 renderer 资源。
8. 不允许使用 dangerouslySetInnerHTML，不允许把完整页面或大段组件写成字符串模板。

## 核心体验要求

1. 页面必须包含真实 WebGL/Three.js 3D 晶格场景，不得降级成静态科学插图或普通球体堆叠。
2. 准备至少 80 个原子位点、3 类元素、2 组掺杂配置。
3. 用户可以 orbit、pan、zoom，并能一键重置视角。
4. 原子按元素类型显示不同颜色、大小与图例；掺杂位点与空位有独立视觉标记。
5. 支持显示/隐藏晶胞边界、键、空位、掺杂标记与迁移路径。
6. 切换 Cl-rich、Br-doped 等配置；切换后如果当前选择的原子或路径节点不存在，应清空对应 selection 并提示。
7. reload 后恢复最近配置、view mode、切片轴/位置与路径显示偏好。
8. WebGL 不可用时显示明确 fallback，不要白屏。

## 重点难点要求

以下机制是 3D 科学可视化的高频失分点，请确保在画面与数据上都真实：

1. **真实切片裁剪，而非仅过滤原子**：切片模式下必须用裁剪（clipping planes 或等价方式）真正把晶胞盒与键剖开，呈现横截面；切片面可沿 X/Y/Z 拖动移动。切片是纯视图操作，不得改变底层晶格数据（退出切片后结构完好）。高频失败反例：切片只是隐藏一部分原子、键不被切开、切片改写了数据。
2. **精确 3D 拾取与局部环境可视化**：点击时用 raycast 选中光标下**最前面**的原子（正确处理遮挡），显示其元素、坐标、邻居、局部环境与是否参与迁移路径，并在 3D 中高亮其邻接键与配位多面体。高频失败反例：选中被遮挡的原子、点击命中错误、只弹信息不在 3D 中高亮。
3. **交互式迁移路径构建与相邻性校验**：需包含两条内置路径A和B。除内置路径外，用户可在 3D 中依次点击位点构建一条自定义迁移路径；只允许在相邻位点（或经空位）之间连接，非法跳跃要被拒绝并给出反馈；构建过程中路径在 3D 中实时连线。
4. **能垒由局部环境确定性派生，而非硬编码**：每条路径（含自定义路径）的能垒 profile 必须由沿途位点的本地环境（如到最近空位/掺杂的距离、配位数等）确定性派生；切换配置或改变路径后能垒随之变化。相同 seed 与相同路径必须得到相同 profile。高频失败反例：能垒写死为常量数组、切配置不变。
5. **能垒曲线与 3D 路径联动**：显示能垒曲线，hover 曲线某步时 3D 中对应路径节点高亮，反之亦然；支持比较两条路径的瓶颈能量与平均能垒（叠加曲线 + 3D 双路径高亮）。
6. **迁移动画与 WebGL 生命周期**：播放离子沿路径移动的动画，支持 pause/resume/reset；快速切换配置、切片、路径或卸载组件时不得产生 orphan Three.js object、console warning 或未清理的 RAF，geometry/material/texture 必须 dispose。

## 3D 与稳定性要求

1. 原子、键、配位多面体与路径必须使用本地 primitive geometry 绘制，不得依赖外部模型。
2. 能垒曲线与路径节点必须来自同一 MigrationPath 数据。
3. resize 后场景比例与交互（拾取、拖动切片面）区域必须正确。
4. 360px viewport 下提供简化控制面板，不遮挡主 3D 场景，仍可拾取、切片与查看能垒。
5. prefers-reduced-motion 下减少连续动画，但选择、切片、路径高亮与能垒联动仍可用。
6. 控制台不能出现运行时报错、资源 404、React key 警告或未处理 Promise rejection。
