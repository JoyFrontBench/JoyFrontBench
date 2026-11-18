一级分类：数据可视化
二级分类：数据转换工作台

请你扮演一名资深数据产品前端工程师，设计并实现一个完全本地运行的《JSON 数据转换与校验工作台》。

该工具面向需要检查、编辑和转换复杂嵌套 JSON 数据的用户。用户能够导入 JSON，在 Tree、Table 与 Raw 三种视图中浏览和编辑数据，通过 JSONPath 查询数据，执行 flatten、filter、group、rename、delete 等转换操作，对数据进行 JSON Schema 校验，并最终导出处理后的 JSON 或 CSV。

最终页面必须是一个真正可操作的数据工作台，而不是静态 JSON Viewer、代码高亮页面或只展示预设转换结果的 Demo。

页面默认采用明亮、高对比度的桌面数据工具界面。Tree、Table、Raw Editor、转换面板和校验面板中的正文与辅助信息必须具有足够字号，不能通过大量 `7px`、`8px`、`9px` 微型文字强行压缩信息。顶栏必须提供可随时打开的“使用说明”，帮助用户理解从导入、查询、编辑、转换到校验与导出的完整流程。

交付形式必须是一个可运行的多文件前端工程，而不是单个 HTML 文件，且必须使用 **Vite + React + TypeScript** 实现，允许通过 npm 安装必要依赖。

禁止：真实外部 API、云端数据库、远程文件处理服务、API Key、将上传数据发送到任何远程服务器。所有数据处理必须在浏览器本地完成。

应用必须处理用户导入的任意合法 JSON，不能把核心逻辑写死为只认识 `$.users`、`profile.tier`、`orders` 或内置示例字段。内置示例只用于首次启动和恢复工作区；导入具有不同根字段、不同数组名称或多个候选数组的 JSON 后，Tree、Table、查询、转换、校验和导出仍须基于实际数据工作。

必须至少提供 `package.json`、`index.html`、`src/main.tsx`、`src/App.tsx`、`README.md`，并提供 `npm run dev`、`npm run build`、`npm run typecheck`、`npm run test`。

---

## 一、初始示例数据

应用首次打开时自动加载一份非平凡的嵌套 JSON 示例，至少包含：

* 5 个 users
* 每个 user 包含 profile
* 每个 user 包含 orders 数组
* 每个 order 包含 items 数组
* 部分字段缺失
* 部分字段为 null
* 至少包含 string / number / boolean / null / array / object
* 至少存在一个重复值字段
* 至少存在一个可用于 group 的分类字段

结构可以类似：

```json
{
  "users": [
    {
      "id": 101,
      "name": "Alice Chen",
      "active": true,
      "profile": {
        "country": "SG",
        "tier": "gold"
      },
      "orders": [
        {
          "id": "ORD-001",
          "status": "paid",
          "total": 129.9,
          "items": [
            {
              "sku": "SKU-A",
              "name": "Keyboard",
              "quantity": 1,
              "price": 89.9
            },
            {
              "sku": "SKU-B",
              "name": "Cable",
              "quantity": 2,
              "price": 20
            }
          ]
        }
      ]
    }
  ]
}
```

实际 seed 必须比上述示例更丰富。

提供 **Reset to Example Data** 用于恢复初始数据。后文的 Clear Workspace 也必须清除本地持久化、当前导入、Pipeline、Undo/Redo、查询、排序、筛选和 Schema 状态，并回到同一份干净示例数据，而不是留下空白或半初始化工作区。

---

## 二、JSON 文件导入

提供明显的 **Import JSON** 功能，支持：

1. 点击选择 `.json`
2. 拖拽 JSON 文件进入上传区域

导入后：

* 解析 JSON
* 更新当前数据集
* 更新 Tree View
* 更新 Table View
* 更新数据统计
* 清空不再适用的查询结果
* 清空旧 Pipeline、Undo/Redo 历史、旧排序、旧筛选和不再适用的查询结果
* 将新导入内容同时设为新的 Original 和初始 Result，数据版本递增
* 自动发现实际存在的 array path，而不是继续假定存在 `$.users`

如果导入数据包含多个可浏览数组，Table View 必须让用户明确选择当前数组。如果导入数据没有数组，Tree 与 Raw 仍须正常工作，Table 应显示可理解的空状态而不是报错或伪造 `$.users`。

非法 JSON 必须：阻止导入、显示明确错误位置或解析错误、保留当前有效数据、不得导致页面崩溃。

不得依赖评测者另行提供数据或 Schema 文件；交付物必须自行生成并包含可供自动化测试上传的确定性 fixtures，至少包括合法嵌套 JSON、多数组 JSON、非法 JSON、合法 Schema 和非法 Schema。

---

## 三、原始 JSON 编辑器

提供 Raw JSON Editor，用户可以直接编辑当前 JSON 文本。至少提供：

* **Format**：格式化 JSON。
* **Minify**：压缩为单行。
* **Apply Changes**：解析编辑后的 JSON 并替换当前 Result，作为 `Raw Apply Changes` 数据步骤进入 Pipeline；Original 只在 Import JSON、Reset to Example Data 或 Clear Workspace 时改变，普通 Raw Apply 不得覆盖 Original。
* **Revert**。

如果存在语法错误：不允许 Apply、显示错误提示、原有有效数据不得被破坏。

---

## 四、Tree View

必须提供可交互的嵌套 Tree View，需要支持：

* object 展开/折叠
* array 展开/折叠
* 显示 key
* 显示 value
* 显示 value type
* 显示 array length
* 显示 object field count

不同类型应具有清晰视觉区别：string、number、boolean、null、array、object。

至少提供 **Expand All** 和 **Collapse All**。对于较深的数据结构，不得默认把整个 JSON 全部展开造成页面不可用。

---

## 五、Tree View 字段编辑

Tree View 中的 primitive value 必须支持编辑，至少支持编辑 string、number、boolean、null。

修改后：

* 只修改当前 Result，不修改 Original
* 作为 value edit step 进入 Pipeline
* Tree View 更新
* Raw JSON 更新
* Table View 更新
* Validation 状态重新计算

必须正确保持数据类型。例如数字 `29.9` 不得因为编辑自动变成字符串 `"29.9"`；boolean 必须可以在 true / false 之间切换。

---

## 六、字段删除

用户可以在 Tree View 中删除字段，例如删除 `users[0].profile.country`。

删除后：

* 当前 Result 中字段消失，Original 保持不变
* 删除操作进入 Pipeline，Undo 可恢复
* Raw JSON 更新
* Table View 更新

删除 array item 时：数组长度正确更新、不允许产生异常 sparse array。

---

## 七、字段重命名

对于 object key，提供 Rename Key。例如把 `profile.country` 重命名为 `profile.region`。

要求：

* value 保持不变
* 数据类型保持不变
* 原 key 消失
* 新 key 出现
* Rename 操作进入 Pipeline，Original 保持不变
* Raw JSON 和其他 View 同步

如果目标 key 已存在，必须阻止覆盖，或明确要求用户确认，不得静默丢失已有字段。

---

## 八、Table View

提供 Tree View / Table View / Raw Editor 切换。Table View 主要用于浏览数组结构。

当用户选择某个 array path（例如 `$.users`）时，Table View 将其转换为表格。基础字段（例如 `id`、`name`、`active`、`profile.country`、`profile.tier`）应显示为列。

嵌套 object 可以使用 dot notation 展开一层（例如 `profile.country`）。复杂数组字段可以显示为 `orders [3]` 并允许点击查看详情。

当前 Table array path 是表格排序、过滤、统计和 CSV 导出的共同数据上下文。导入数据包含多个顶层数组时，切换到第二个数组后，后续过滤、计数和导出都必须作用于第二个数组，不能继续使用另一个面板中残留的旧 path。

Table array path、Transform source path 和当前数据版本必须在 UI 中明确显示。允许不同面板暂时选择不同 path，但执行 Commit Filter、Flatten、Explode、Group By 或 CSV 导出时，必须以该操作界面中用户当前明确选择并可见的 path 为准，不得回退到默认 path，也不得复用其他面板过期的选择。

---

## 九、Table View 排序

Table View 至少支持 string 排序、number 排序、boolean 排序。

点击列标题：第一次 ascending，第二次 descending，第三次 clear sorting。

必须保证 number 使用数值排序，而不是字符串排序。例如 `2 / 10 / 100` 不能排序成 `10 / 100 / 2`。

---

## 十、字段过滤

提供 Filter Builder，允许用户选择 Field、Operator、Value。至少支持：

* **string**：equals、contains、starts with、ends with
* **number**：=、>、>=、<、<=
* **boolean**：is true、is false
* **generic**：exists、missing、is null、is not null

允许同时添加多个 filter，至少支持 AND 组合。

应用 filter 后：Table View 只显示匹配数据、显示 filtered count / total count、不修改原始数据。必须提供 **Clear Filters**。

Table Filter 默认只是当前 Table View 的显示状态，不修改 Result。同时必须提供明确的 `Commit Filters to Result` 或等效操作，执行后：

* 将当前 Table array path 与当前全部 AND filter 作为一个不可变 Pipeline step；
* 过滤后的记录数组成为新的 Result 根数组；
* Original 保持不变；
* step 必须记录提交瞬间的 path 和规则，之后修改 Table 控件不能静默改写历史 step；
* 如果导入数据有多个数组，必须提交用户当前正在查看的数组，不能误用 Transform 面板自己的 array path。

---

## 十一、JSONPath 查询

提供独立的 JSONPath Query 输入框。例如用户可以输入 `$.users[*].orders[*]` 或 `$.users[?(@.active == true)]`。

执行后显示：Match Count、Matched Path、Matched Value。

查询结果不得覆盖原始数据。非法 JSONPath：显示错误、不清空当前数据、页面不得崩溃。

提供若干可点击示例 Query。内置示例 Query 必须与当前内置示例数据一致；导入其他结构后，示例按钮可以标注为“示例数据适用”，但执行用户输入时必须始终基于当前 Result。

以下 Flatten、Explode、Group By 以及显式提交的 Table Filter 统一视为**记录集结构转换**：

* 操作输入是当前 Result 中用户明确选择且 UI 可见的 array path；
* 该 path 不存在或指向非数组时，操作失败、进入 error 状态并保留上一个有效 Result；
* Transform 面板必须区分绝对 source array path（如 `$.users` 或 `$`）与相对字段 path（如 `orders`、`profile.tier`），不能把不同面板的旧 path 混用；
* 操作输出是一个记录数组，并成为新的 Result 根值；
* 原文档包裹字段不会自动保留到新 Result，除非其值已经作为记录字段被转换逻辑复制；
* 转换完成后 Table 的当前数组应切换为根路径 `$`；
* 后续结构转换基于这个新的根数组继续执行；
* Original 始终保持导入时的完整文档。

必须在 UI、README 或操作说明中让用户能够理解这一输出语义，不能让同一个操作在不同实现中有时替换原 path、有时输出根数组。

---

## 十二、Flatten

提供 Flatten 操作。用户选择目标数组 path（例如 `$.users`），执行 Flatten 后将嵌套 object 展平。例如：

```json
{
  "id": 101,
  "profile": {
    "country": "SG",
    "tier": "gold"
  }
}
```

转换为：

```json
{
  "id": 101,
  "profile.country": "SG",
  "profile.tier": "gold"
}
```

必须允许用户配置 Separator，默认 `.`（例如 `profile.country`），也可以设置 `_`（得到 `profile_country`）。

Flatten 后必须作为新的 transformation result，而不是只改变显示方式。对 `$.users` 执行后，输出的扁平 records 数组成为 Result 根数组；不得只在 Table 中临时显示扁平列，也不得静默把 metadata、settings 等原包裹字段混入每条记录。

---

## 十三、Array Explode

对于 nested array 提供 Explode 操作。例如 `users[].orders[]` 将 `user × orders` 转换为多行记录：一个 user 有 3 个 orders 时，Explode 后产生 3 条记录。父级字段（例如 `user.id`、`user.name`）必须正确复制到每一行。

这个操作必须与普通 Flatten 区分。

Nested array field 以每条 source record 为相对起点。例如 source 为 `$`、nested field 为 `orders` 时，每个输出 record 保留该 user 的其他父级字段，并把 `orders` 从数组替换为当前单个 order object。

对于 nested field：

* 缺失、`null` 或空数组：该 source record 产生 0 行；
* 非空数组：每个 item 产生 1 行；
* 存在但不是 array：阻止本次操作、显示明确错误且保留上一个有效 Result。

---

## 十四、Group By

提供 Group By 操作。用户可以选择一个字段（例如 `profile.tier`），然后选择 Count、Sum、Average、Min、Max。

例如 Group By `profile.tier`、Aggregate `Count users`，得到：

```text
gold     2
silver   2
basic    1
```

对于 Sum / Average / Min / Max 只能选择 numeric field，不得允许 string 字段执行无意义的 Sum。Group 字段缺失或为 null 时必须以明确分组标签展示，不能把缺失记录静默丢弃；numeric 聚合字段缺失或非数字时必须跳过并在统计中说明，或阻止本次操作并显示原因。

---

## 十五、Transformation Pipeline

所有改变数据的 transformation 必须记录在一个独立 Pipeline 面板，至少包括 Tree primitive value edit、Rename Key、Delete field/item、Raw Apply Changes、Committed Filter、Flatten、Explode 和 Group By。纯浏览状态（例如切换视图、展开节点、临时 Table filter、sort、Table path 选择和 JSONPath query）不进入 Pipeline，但这些浏览状态应按持久化章节保存以便刷新恢复。

例如：

```text
1. Rename profile.country → profile.region
2. Delete internalNote
3. Flatten $.users
4. Filter active = true
```

每一步显示：

* operation type
* stable step id
* parameters（包含提交瞬间的数据版本、source path、字段 path、filter 规则或聚合配置）
* status

至少支持 Undo last step、Redo、Remove step、Reset pipeline。修改 pipeline 后应重新计算结果，不得仅通过不可追踪的直接 mutation 修改数据。

Pipeline 重放语义必须确定且可恢复：

* 每个 step 都从前一个成功 step 的输出继续计算；
* Undo、Redo、Remove Step 和 Reset Pipeline 都必须从 Original 重新重放，而不是依赖残留 mutation；
* 某一步失败时，Result 保留在失败前的最后有效输出，该 step 标记为 error 并展示原因；
* 失败 step 之后的 step 必须标记为 blocked / skipped，不能绕过失败步骤后继续作用于错误的数据形状；
* 删除或撤销失败 step 后，后续 step 应重新尝试并更新状态；
* 执行新的数据操作后，旧 Redo history 必须清空；
* 任何失败都不得把 Result 写成 `undefined`、空白页面或不可序列化状态。

---

## 十六、Original / Result 对比

页面必须明确区分 Original Data 和 Transformed Result。用户应能切换 Original / Result，或者使用 side-by-side 对比。

转换操作不得覆盖用户最初上传的数据。Reset Pipeline 后应恢复到 original data。

---

## 十七、JSON Schema 校验

提供 Schema Validation 面板。用户可以输入 JSON Schema、导入 `.json` schema 文件、使用内置示例 schema。

点击 Validate 后对当前 Result 进行校验，显示 Valid / Invalid、Error Count。

如果 Invalid，每条错误至少显示 data path、schema rule、message。例如：

```text
/users/2/id
must be integer
```

或：

```text
/users/3/profile/country
must match required pattern
```

不得只显示 `Validation Failed` 而没有具体原因。

---

## 十八、数据统计

页面提供 Overview，至少显示：Root Type、Object Count、Array Count、Primitive Value Count、Max Depth、Current Result Size、Validation Errors。

对于当前选择的 array，显示 Rows、Columns、Missing Values。

数据发生变化后必须同步更新。

---

## 十九、导出 JSON

提供 **Export JSON**，导出当前 Transformed Result。要求：

* JSON 格式合法
* 使用 UTF-8
* 数据内容与当前 Result 完全一致，不能导出 Original 或过期缓存 Result
* number / boolean / null 类型不得被错误转成 string

允许选择 Pretty JSON 或 Minified JSON。

---

## 二十、导出 CSV

对于能够转换成 tabular records 的 Result，提供 **Export CSV**。要求：

* 数据源必须与点击导出时 Table View 明确展示的数据版本和当前 array path 一致；如果当前 Result 已是根数组，path 应为 `$`
* 应导出应用当前全部 Table filter 后、再按当前 sort 排列的完整记录集
* 不得只导出分页中的当前页、虚拟列表中已渲染的行或当前视口可见行
* 没有排序时保持该记录集的原始顺序；清除排序后不得继续沿用旧排序
* 正确生成 header
* 正确处理数字
* 正确处理 boolean
* 正确处理 null
* 字段包含逗号或引号时正确 escaping
* UTF-8 内容正确

对于仍然存在无法直接表示的 nested object / array，不得静默输出 `[object Object]`，应该自动 JSON stringify，或提示用户先 Flatten / Explode。

---

## 二十一、Undo / Redo

至少支持 value edit、rename key、delete field、transformation operation 的 Undo / Redo。

按钮状态必须正确：没有历史记录时 Undo disabled；没有 redo history 时 Redo disabled；执行新操作后旧 redo history 应正确清空。

---

## 二十二、本地持久化

使用 localStorage 或 IndexedDB 保存最近工作状态。刷新页面后至少恢复：

* 当前 Original
* 由 Original 与 Pipeline 重放得到的 Result
* transformation pipeline
* active view
* 当前 Original / Result 数据版本
* 当前 Table array path 与排序状态
* JSONPath query
* filters
* 当前 Schema 文本与最近一次 validation 状态

提供 **Clear Workspace** 用于恢复初始状态。

如果持久化数据损坏：

* 不得导致应用无法启动
* 不能只依赖 `JSON.parse` 成功就信任快照，必须校验 workspace、data、filters、sort、schema 和 pipeline step 的嵌套结构
* 未知 operation type、缺失必要参数、非法参数类型或不符合版本结构的 pipeline step 均视为损坏
* 应清除或隔离损坏快照，fallback 到示例数据，并向用户显示可理解的恢复提示
* 不得在渲染 Pipeline label、重放 operation 或读取嵌套字段时产生空白页
* 对有效持久化状态，Result 应由 Original 和 Pipeline 重新确定性计算，不应无条件信任可能过期的缓存 Result
* 如果 Pipeline 重放得到 error/blocked 状态，页面仍应展示最后有效 Result、失败原因和可移除步骤，不得把失败快照当成损坏工作区直接丢弃

---

## 二十三、错误处理

需要处理至少以下错误：invalid JSON、invalid JSONPath、invalid JSON Schema、schema validation failure、invalid numeric filter、rename key conflict、unsupported CSV export structure、empty dataset、missing field、null field、malformed persisted state。

错误必须在 UI 中明确展示，不得主要依赖 `console.error()` 告诉用户发生了什么。

---

## 二十四、性能要求

准备一个额外大型 seed 数据集，至少包含约 1000 users、每个 user 至少 2–5 orders。提供 **Load Large Dataset** 用于测试。

应用必须能够完成 Tree browsing、Table scrolling、filtering、JSONPath、transformation，而不出现明显长时间界面冻结。允许使用 virtualization、memoization、Web Worker，但不是强制。

不得每次键盘输入都无条件重新 stringify 和渲染整棵巨大 JSON Tree。Raw Editor 可以维护草稿文本，只有 Format、Minify、Apply Changes 或显式同步时才重新解析/重建主数据视图。

---

## 二十五、工程结构

不得把 mock 数据、Tree View、Table View、所有 transformation 和 validation 全部写在 App.tsx。

---

## 二十六、视觉与交互要求

最终页面应呈现为专业、明亮、可长时间使用的数据开发工具，而不是普通后台表格、暗色代码展示页或依靠微型文字堆叠信息的高密度 Demo。

### 1. 主题与视觉语言

默认使用亮色主题：

* 页面背景使用浅冷灰或接近白色；
* 主要工作区、Tree、Table、编辑器和面板使用白色或轻微分层的浅色表面；
* 边框、分隔线和悬停状态必须清楚，但不能形成沉重的深色网格；
* 主操作色建议使用绿色或青绿色；
* string、number、boolean、null、object、array 应继续保留可辨识的类型颜色；
* 错误、警告、成功和选中状态不能只依赖文字说明，需同时有颜色、图标、边框或背景反馈。

禁止：

* 默认使用大面积黑色、深蓝黑或炭黑背景；
* 使用低对比度浅灰文字；
* 使用大面积渐变、发光、玻璃拟态或营销式装饰干扰数据阅读；
* 为追求“专业感”而把全部信息压缩成难以辨认的小字。

### 2. 桌面工作台布局

采用稳定的三栏桌面工作台布局：

```text
┌──────────────────────────────────────────────────────────┐
│ Toolbar                                                  │
├──────────────┬─────────────────────────┬─────────────────┤
│ Data / Tree  │ Main Data Workspace     │ Transform /     │
│ Navigation   │                         │ Validation      │
│              │                         │                 │
├──────────────┴─────────────────────────┴─────────────────┤
│ Status / Statistics                                      │
└──────────────────────────────────────────────────────────┘
```

左栏负责数据导入、Original / Result、JSONPath 和导出；中间为 Tree / Table / Raw 主工作区与数据统计；右栏负责转换 Pipeline 和 Schema Validation。

本题以桌面工具为主要使用场景，重点验证 `1440 × 900` 与 `1536 × 960` 视口，不要求实现 `360px` 移动端重排。在宽度不低于 `1280px` 时：

* 页面不得出现全局横向滚动；
* 应用外壳应闭合在当前视口高度内，正常工作时不得依赖 document 级纵向滚动才能看到顶栏、状态栏或主要操作；
* 左、右工具栏不得挤压到文字逐字换行；
* Table 列较多时应在表格内部横向滚动，而不是缩小全部文字；
* 三栏与主数据区应在各自边界内独立纵向滚动，滚动长 Tree、Pipeline 或 Schema 时不能带走整页顶栏和状态栏；
* 顶栏、状态栏和主要操作按钮必须始终位于视口内，不得遮挡工作区。

### 3. 字号与可读性

高频数据内容和交互控件应以 `13px–14px` 或更大字号呈现，包括：Tree key / value；Table 单元格与列标题；JSONPath 输入框；表单标签、下拉框与主要按钮；Pipeline 步骤；Schema 编辑器。

辅助说明、统计标签、状态栏、类型提示和次级按钮原则上不得小于 `11px`。Raw JSON Editor 建议使用至少 `14px` 的等宽字体和舒适行高。页面主标题建议不小于 `18px`。

字号放大后必须同步调整：行高；控件高度；Tree 节点高度；Table 表头与单元格高度；左右侧栏宽度；文本截断、换行和内部滚动。

不得通过 CSS transform 或整体浏览器缩放伪造大字号。

### 4. 通用交互质量

要求：

* 信息层级清晰
* 大数据区域拥有充足空间
* Tree 和 Table 可滚动
* Toolbar 不遮挡内容
* 错误状态明显
* transformation pipeline 易于理解
* 选中状态明确
* 长字段不会破坏布局
* 所有按钮具有 hover、focus-visible 和 disabled 状态
* 模态对话框打开后层级正确，关闭后不会残留遮罩或阻断页面
* 正常桌面屏幕亮度下无需放大浏览器即可阅读主要内容

不得简单堆叠大量卡片形成纵向 Dashboard。

---

## 二十七、使用说明

顶栏必须提供带问号或帮助图标的 `使用说明` 入口。点击后打开模态对话框，说明至少覆盖以下四步：

1. 导入 JSON：点击选择或拖拽本地 `.json` 文件；
2. 查看和定位：使用 Tree / Table / Raw 与 JSONPath；
3. 编辑和转换：在 Result 中编辑，并使用 Flatten / Explode / Group 与 Pipeline；
4. 校验和导出：执行 JSON Schema 校验，导出 JSON 或 CSV。

说明中必须明确：

* 数据只在当前浏览器本地处理；
* Original 保留导入时的原始数据；
* 修改和 transformation 写入 Result；
* 原始数据不会被转换流程静默覆盖。

对话框必须支持：顶部关闭按钮；点击遮罩关闭；Escape 键关闭；明确的“开始处理”或等效确认按钮。

打开对话框时背景工作区应被遮罩但仍能辨认；关闭后页面交互必须恢复，不得残留焦点陷阱，不得刷新或重置当前工作状态。

---
