# 已知陷阱与规避方式

## 元组解构：错的不是编译器，是解构的元素个数

> 这一条曾经被误诊为「TypeScript 6.0.3 编译器的缺陷」并写进了文档与提交信息。
> 后经复核，**结论是错的**，TS 的行为完全正确。原始记录保留在 git 历史里，此处更正。

**真实原因**：`AsyncResult<T>` 曾经是 4 元组 `[value, loading: boolean, error, reload]`，
用**两元素**解构时，第二个变量落在索引 1，也就是 `loading: boolean` 的槽位：

```ts
// ✗ 错在解构个数：reload 实际拿到的是 loading（boolean）
const [providers, reload] = useAsync(fn, deps, initial);
reload();   // TS2349: This expression is not callable. Type 'Boolean' has no call signatures.
```

编译器是对的。两条反证：
- `const flag: boolean = res[3]` → TS2322，说明第 4 位确实是 `() => void`，不是 Boolean。
- 正确的四元素解构 `const [value, loading, error, reload] = useAsync(...)` 编译零错误。

**当前约定（属于风格选择，不是缺陷规避）**：本项目自定义 hook 一律返回**对象**而非元组。
好处是按名解构，不可能再出现"数错位置"这类错误，新增字段也不会破坏调用方。

```ts
export interface AsyncResult<T> { value: T; loading: boolean; error: Error | undefined; reload: () => void }

const res = useAsync(() => listProviders(), [], [] as ProviderConfig[]);
const providers = res.value;
res.reload();
```

教训：这类"编译器有 bug"的结论必须用**最小反证**验证——先确认自己的调用写法是否真的符合类型。

## Dexie 4 的类型约束
- `table.modify((row) => { Object.assign(row, patch); })`：回调**不能有返回值**；
  写成 `(row) => Object.assign(row, patch)` 会报 "not assignable to boolean | void"。
- `db.transaction('rw', t1, t2, cb)` 必须传数组：`db.transaction('rw', [t1, t2], cb)`。
- 复合主键表（CharacterAppearance）的实体类型要显式声明 `id` 并在写入时构造。

## HeroUI v3
- 没有 `asChild`（v3-beta.3 起移除）；用 `onPress` + `useNavigate()`。
- 没有 `onClick`，一律 `onPress`；禁用 `isDisabled`；加载 `isPending`。
- Tooltip 没有 `content` 属性，用 `<Tooltip.Trigger> + <Tooltip.Content>`。
- 不需要 Provider；样式靠 `@import "@heroui/styles"`，必须在 `@import "tailwindcss"` 之后。
- 主色通过覆盖 CSS 变量 `--accent` / `--accent-foreground` 定制（见 globals.css）。
- **不要用 `<Tabs.Indicator/>`**：它会抛 `SharedElement must be rendered inside a SharedElementTransition`
  并导致整页白屏，而 `@heroui/react` 内部没有任何组件提供该 context。
  Tabs 只用 `Tabs.List + Tabs.Tab + Tabs.Panel` 即可（本项目所有 Tabs 都遵循此约定）。
- 复杂表单可以直接用原生 `<input>` / `<select>` / `<textarea>` 配 Tailwind，不必强行套 HeroUI 组件。
- **`Card` 自带卡片布局样式**：把 `flex` / `grid` 之类的布局类直接写在 `<Card>` 上往往不生效，
  正确做法是 `<Card><div className="flex ...">…</div></Card>`。Card 只当容器用。
- 分段切换（视图/tab 之类的切换器）本项目统一用**原生 button + Tailwind** 实现，
  不用 `Tabs`：一是 `Tabs.Indicator` 会崩（见上），二是 HeroUI Tabs 的默认样式会把少量 Tab 拉满整行，观感差。
  需要真 Tabs 语义时用 `Tabs.List + Tabs.Tab + Tabs.Panel`。

## Tailwind v4
- 重要修饰符后置：`bg-red-500!`（不是 `!bg-red-500`）。
- 透明度用斜杠：`bg-black/5`（不是 `bg-opacity-5`）。
- `rounded` / `shadow` 整体下移一档，旧写法视觉会变。
- 自定义变体用 `@custom-variant`，自定义工具类用 `@utility`。

## 中文正文处理
- 中文写作里换行即分段，**不要**依赖 Markdown 的双换行分段。
- 入库用 `textToDoc`（文本 → HTML），出库用 `docToText`（HTML → 文本）。
- 段首缩进交给 CSS `text-indent`，正文里不要写全角空格，否则会叠加。

## 推理模型会"吃掉"全部 token 预算（真实踩坑）

DeepSeek V4 系列（`deepseek-flash` / `deepseek-v4-pro`）是**推理模型**：先输出 `reasoning_content`，
思考完才写正文。如果 `max_tokens` 给小了，思考就把预算吃光，`content` 会是**空字符串**，
而 `finish_reason` 是 `length` —— 调用方看起来"成功"，实际什么都没生成。

实测：`max_tokens=400` 时 100% 返回空正文；`max_tokens=1200` 时正常输出。

项目里的三层防护（缺一不可）：
1. `runner.ts`：检测到「正文为空 + 有 reasoning_content」时，把 max_tokens 提升到 2.5 倍自动重试
   （最多 2 次）；仍为空则**明确报错**提示用户调大预算或换非推理模型，绝不把空结果当成功。
2. `defaults.ts`：结构化大任务（genesis / outline）默认 16000 tokens，而不是 4096。
3. UI：流式生成时把 reasoning 与正文分开显示，用户能看到"它在想"而不是"它卡住了"。

## 全局浮层与快捷键必须挂在应用根部（真实用户 bug）

**症状**：点「设置」没任何反应。

**根因**：设置原本是全局弹层，各处调用 `setSettingsOpen(true)`；后来设置改成了独立页面 `/settings`，
但这 9 处调用没跟着改，而且**没有任何组件渲染那个弹层** —— 于是 `settingsOpen` 变成了只写不读的死状态，
点击静默失效。同类问题还有：

- 命令面板（⌘K）与全局快捷键原本渲染在 `AppLayout` 里，而 `AppLayout` 只在 `/p/:projectId/*` 下挂载，
  所以**在书库首页、新建页、设置页里 ⌘K 和 ⌘, 全部失效**。

**规则**：
1. 全局性的东西（快捷键、命令面板、全局提示）放在 `<App />` 根部，不要放在路由布局组件里。
   本项目现在由 `src/components/layout/GlobalHotkeys.tsx` + `<CommandPalette />` 承担。
2. 状态要么有消费者，要么不要留。改架构（弹层 → 独立页面）时，必须全局搜索旧的 setter 并清理。
3. 设置类跳转统一用 `useOpenSettings()`，支持深链到分区：`/settings?tab=models`。

**教训**：`tsc` 与构建都不会报"这个状态没人用"，只有**真实点击测试**才能发现这类静默失效。
所以每个入口都要有 e2e 断言（见 `scripts/verify-settings-entry.mjs`，12 项覆盖全部入口）。

## 跨域（CORS）：错误文案曾经指向一个不存在的东西

**用户看到的**：「浏览器直连被跨域策略拦截。请在「设置 → 模型与 AI」中开启本地代理……」

**真实情况**：
1. 项目给大多数云端供应商预设了 `corsBlocked: true`，于是 `resolveEndpoint` 会把请求发到
   `http://127.0.0.1:8788/proxy?url=…` —— 但**那个代理服务从来没写过**，也没有任何开关。
2. 请求必然打到空气上，失败后回退直连，再失败就被归类成 `cors`，弹出上面那句提示。
3. 用户按提示去设置里找开关，找不到；就算找到了也没有服务可开。

**修复**（三个都要有，缺一个都会再次误导用户）：
- `scripts/proxy.mjs`：真正的本地转发服务（`npm run proxy`），
  提供 `/health` 供探测、`/proxy?url=` 供转发，并返回 CORS 头。
- `src/ai/proxy.ts`：启动时探测代理是否在运行；**在运行才走代理，没运行就直接连**，
  不做"先失败再回退"（那会让每次生成都白等一轮）。地址可在设置里改。
- 错误文案：改成可执行的两条路（启动本地代理 / 换支持直连的服务），并列出实测支持直连的供应商。

**另外一个容易踩的点**：代理返回的自定义响应头默认对 JS 不可见，必须显式声明
`Access-Control-Expose-Headers`，否则前端读不到耗时之类的信息。

**实测结论**：DeepSeek 支持浏览器直连（GET 与 POST 都返回 `Access-Control-Allow-Origin`），
所以它的预设是 `corsBlocked: false`，根本不需要代理。真正需要代理的是智谱、通义、硅基流动这类。

## 工具链
- ego-browser 运行时是 Linux 构建，在 macOS 上会报 `no X display`；本项目的浏览器验证统一用
  `node scripts/shot.mjs <url> <png>`（Playwright + 系统 Edge 通道）。
- 不要用 `bash` 里的 `cat > file <<'EOF'` 写含反引号的 TS 文件：多层级转义容易静默损坏源码。
  需要写长文件时用 write 工具，或先写 `.mjs` 生成脚本再执行。

## HeroUI v3 的 TextArea 默认不是全宽的

**现象**：侧栏里的输入框只有 161px 宽，文字挤成三行还被裁掉。项目里 19 处 TextArea 全是这样。

**真因**：HeroUI 的基础类 .textarea 是 display: inline-block 且**没有 width**，
宽度由浏览器按 textarea 默认的 cols≈20 算出固有宽度。全宽是**单独的修饰类**
.textarea--full-width { @apply w-full }，基础类不含它。

**修法**：在 globals.css 里用 :where(.textarea) 统一补 display:block; width:100%。
用 :where() 把特异性压到 0，保证修饰类仍能覆盖。**不要逐个加 className="w-full"** ——
19 处将来还会新增，改基础类才是一次修好。

**教训**：这类问题不报错、类型也对、构建也过，只能靠**量尺寸**发现。
所以专门加了 verify-textarea.mjs：遍历各页面的 textarea，比较它与父容器内容宽度，
填充率不足 90% 就失败。断言里**不要写"display 必须是 block"** —— 项目里有自写的原生
textarea（带 w-full），它们本来就是 inline-block 且宽度 100%，那是正常的。

## 测试用例的四个假失败来源

**① waitUntil: "networkidle" 早于 React 挂载**。Vite 返回 HTML 后它就可能触发，
此时 #root 还是空的。批量跑回归时机器负载高、挂载慢几百毫秒，后续断言就全部落空 ——
表现为"**单跑全过、批量失败**"的偶发失败，非常难查。
修法：scripts/lib/browser.mjs 提供 gotoApp(page, url)，它等 #root 里出现元素
并再静默一小段等 Dexie 异步查询落定。**所有浏览器测试都该用它，不要用裸 page.goto。**

**② 两个脚本共用同一个 profile 目录**。verify-review 和 verify-memory 早期都指向
/tmp/nf-memory-profile，批量跑时后一个会看到前一个留下的项目数据。
修法：launchIsolated(import.meta.url) 按脚本名隔离并在启动前清空。

**③ page.evaluate 无法序列化 DOM 元素**。返回元素会得到一个**空对象**，
于是量出来的宽高全是 0（我看到假的 0 vs 0 白查了一轮）。
evaluate 里必须返回纯数据（数字/字符串/普通对象）。

**④ 验证滚动不要直接改 scrollTop**。那样绕过了事件和 CSS，即使布局坏了也能"通过"。
要用 page.mouse.wheel() 发真实滚轮事件。

## Vite 开发服务器把模块当作 `xxx.ts?t=时间戳` 加载，evaluate 里的 import 是**第二个实例**

**症状**：回归脚本里 `import("/src/ai/embedding.ts")` 拿到模块，调它的 `resetEmbeddingBreaker()`
清熔断器与查询向量缓存，紧接着调 `import("/src/ai/recall.ts")` 的 `recallMemories()` ——
后者**完全没有重新请求向量服务**，用旧缓存就返回了结果。于是"降级回退"用例显示 `semantic: true`，
看起来像降级逻辑坏了，实际是测试根本没走到失败路径。

**根因**：文件被编辑过之后，Vite 的 import 分析会把模块内对 `./embedding` 的引用重写成
`/src/ai/embedding.ts?t=1790024515694` 以绕开浏览器缓存。页面初始加载走的是带 `?t=` 的那份；
而 `page.evaluate` 里写死路径的 `import("/src/ai/embedding.ts")` 拿到**不带查询串的另一份实例**。
模块级状态（缓存、熔断器、`setMemoryBlock` 的 memoryBlock 变量）**不共享**。
用 `page.on("request")` 打印请求就能看到同一个文件被拉取了两次。

**规则**：
1. 要观测/重置模块级状态时，不要用"另一个入口 import 同一个文件"的办法。要么全程只走一条
   import 链（例如只用 `recall.ts`，靠**请求次数 + IndexedDB 行 + DOM 文本**做行为断言），
   要么直接 `gotoApp(page, url)` 重新加载页面拿全新模块态 ——
   `scripts/verify-memory-plus.mjs` 的降级/熔断用例就是这么做的。
2. 断言必须基于可观测行为，而不是"我调了重置函数"。

**教训**：一个"通过了"的降级测试可能是空跑的（同样的坑也出现在假 embedding 上，见下条）。
所以那个用例现在先断言 `degraded.attempts > 0`：**证明真的尝试过并失败**，降级才有意义。

## 假 embedding 不给维度 → 向量退化成 `[0]`，召回测试静默空跑

**症状**：召回用例断言"相关记忆被召回"，pickedIds 是空的，但没有任何报错。

**根因**：假向量函数写成 `(text, dim) => new Array(dim).fill(0)`，调用时只传了 `text` →
`new Array(undefined)` 是**长度 1** 的数组，`v[h % undefined]` 全是 `NaN` 下标
（不报错，只是加到了数组对象上）→ 最终返回 `[0]`：一个长度 1 的零向量。
余弦相似度全是 0，"取相似度为正的 top K"自然一条都取不到。

**规则**：
- 假向量必须显式给维度（本脚本用 8192）。维度太小（比如 64）哈希冲突会让**无关文本**也拿到
  正相似度，召回排序测不准 —— 那不是被测代码的问题，是假服务太糙。
- 断言里带上 `vector.length` 与"内容变了才重算"的请求次数，才可能发现"向量其实是垃圾"。

## Dexie：`delete()` 之后实例不会自动重开；升级回归要补 `open()`

写"老库升级"回归时先 `await db.delete()` 删掉 v4 库，再用 Dexie 基类造一个只声明到 v3 的库、
写入老数据、`close()`，然后想让应用的 `db` 重新打开触发升级 —— 直接读 `db.projects` 会抛
`DatabaseClosedError`：**`delete()` 会把实例标记成已关闭，且不会自动重开**，
必须显式 `await db.open()`（`src/db/database.ts` 的 `wipeDatabase()` 也是 `delete()` 后补 `open()`）。

顺带记一条**必须遵守**的约定：`src/db/v1-stores.ts` 里每个版本都要冻结一份**当时的完整结构**
（`V1_STORES` / `V2_STORES` / `V3_STORES`），`database.ts` 逐版本 `stores()`。
不要图省事让旧版本复用最新的 `DB_STORES`：Dexie 是按"版本声明之间的差异"升级的，
少一份快照就会算错增删。`scripts/verify-memory-plus.mjs` 第六节会真的造一个 v3 老库
（含作品与记忆）再打开，断言 `verno === 4`、老数据还在、新表可查。

## 记忆冲突：相似 ≠ 冲突（相似度只能当必要条件）

第一版按"同类 kind + 文本高相似"直接当冲突信号，结果「对话不要用解释性台词」与
「对话不要用说明性台词」被报成冲突 —— 它们是**同一个意思**，作者会立刻学会无视这个提示条。
正确分工：相似度负责**筛掉风马牛不相及的两条**；冲突信号必须是"取向相反"
（一条禁止一条要求，或命中同一写作维度上的相反两极，如冷硬 ↔ 温暖细腻）。

另外两个必须挡住的误报（都进了单测）：两条针对**不同话题面**（对话 vs 描写）时一冷一暖并不矛盾；
轴词被否定时要翻到对面（「文风要冷硬，**不要**抒情」与「文风要冷硬」是一致而非矛盾）。

**实测数字**：中文短句的编辑距离相似度，"解释性/说明性"只差一个字也只有 **0.8**，
所以"重复"的阈值定在 0.75，而不是拍脑袋的 0.82；而"无关文本"只有 0.09，
两者之间有很大的安全区。

## 效果追踪：差评率的分母必须是"被评价过的生成"

`usedCount` 只能回答"注入过几次"，回答不了"注入之后变好还是变坏"。做这件事时两个坑：

1. **分母**：差评率 = 差评生成数 / **被评价过的**生成数。若用注入次数当分母，
   一条从没被评价过的记忆差评率永远是 0，看起来"很安全"，实际是"没人用过"。
   所以分母为 0 时差评率显示 0 而不是"差"，界面上另外标出"（N 次评价）"。
2. **链接**：memoryUsage 的 `generationId` 直接复用 `AiGeneration.id`，因为
   `AiFeedback.generationId` 本来就指向它 —— 不引入任何新 id，
   "用了哪些记忆 → 这次生成 → 作者给了什么评价"这条链就自动成立。
   代价是注入发生在 system prompt 组装时（那时还没有 generationId），
   得先用模块级变量把 fact id 记下来、在生成落库时补上（见 `runner.ts` 的 pendingInjections）。

## 页签（Tabs）的活动态要靠自己补

**现象**：「写作分析」页那排页签看不出自己在哪一个（用户原话："不是很醒目"）。

**真因**：HeroUI 的样式只写了 `.tabs__tab[data-selected="true"] { @apply text-segment-foreground }` ——
**只改文字颜色，没有背景**。在浅灰底上几乎无差别。

**修法**：`globals.css` 里给 `[data-selected="true"]` 加实心药丸（品牌色填充 + 反色文字 + 字重 600）。
`tabs__list` 本身是浅灰底 + p-1，所以药丸是"嵌在里面"的效果。别改圆角与高度，只强化对比。

**测量陷阱（我因此白查一轮）**：`page.goto` 之后**立刻**读 `[role="tab"]`，
会拿到"5 个全部未选中"，看起来像"活动态完全没生效"。
实际是选中属性晚一拍才落到 DOM。必须用 waitForFunction 等
`querySelectorAll('[role="tab"][data-selected="true"]').length === 1` 出现再断言。
**不要靠固定 sleep，也不要凭一次早期读数下结论。**

## 拆书仿写：算法上一个真实的坑（空白可绕过查重）

原创性自检最初的实现是「逐起点扩展 + 比较原始字符」，比对前把空白删掉。
它错在：**空白一旦被剔除，原本连续的匹配会被切成几段**。

实测数据：一段 20 字的雷同，中间插 3 个空格后，被切成 15 字 + 19 字两段，
而判定门槛是 12 字 —— 也就是说**在当中插几个空格就能绕过查重**。

改成 n-gram 滚动哈希（n = 判定门槛）：给两段文本算逐位置的 n-gram 哈希，
用哈希表找出「哈希连续相等」的最长游程，再回原文切片，最后逐字核对以排除碰撞。
空白插入不再打断匹配；复杂度也从 O(n·m) 降到接近 O(n+m)。

**教训**：写"防抄袭"这类对抗性判断时，要先想"怎么绕过它"。
我第一版只验证了正例（相同文本能抓到），漏掉了最简单的规避手段。

## 版本号不要写死在测试里

`verify-memory-plus` 里有一条断言写的是「打开后自动升到 v4」。
后来加了 blueprints 表、版本变成 v5，这条就假失败了。
改成从 `schema.DB_VERSION` 读当前声明值再比对 —— 断言"升到了当前版本"，而不是某个具体数字。

## heredoc 会吃掉反斜杠转义（本会话踩了六次）

用 `cat > file <<'EOF'` 写含正则或转义的代码时，`\s` `\d` `\r\n` 这类会被写成字面量或被拆行，
导致语法错误或（更糟）**语义悄悄变了却不报错** —— 例如 `/[\s\u3000]/` 变成了 `/[s　]/`。

可靠做法：**用文件写入工具直接写**，或者用 `String.fromCharCode(92)` 拼反斜杠，
或者干脆避免在源码里写转义序列（例如用 `split(CR).join(NL)` 代替 `replace(/\r\n/g, NL)`）。
写完一定要 `node --check` / `tsc` 验证。

## 页签选中态：我绕了一大圈，最后发现要用 Tabs.ListContainer

事情经过（每一步都值得记下来）：

1. HeroUI 的 `.tabs__tab[data-selected="true"]` **只改文字颜色**，浅灰底上几乎看不出差别。
2. 我第一版自己画了个**品牌色实心药丸**。结果两头不讨好：紫色太跳，标签栏成了整页最抢眼的东西；
   同时色块压住了文字对比度，反而更难看清选中了哪个。
3. 官方文档的示例是**分段控件**（白药丸嵌在浅灰底上），靠 `Tabs.Indicator` 实现。
   项目里原来留着一句"需要 SharedElementTransition，会崩"，我一开始不信。
   **那句注释是对的**：不包裹就抛 `SharedElement must be rendered inside a SharedElementTransition`。
4. 补上包裹层后不崩了，但指示器**在本项目里根本不渲染**（DOM 里查不到节点），原因没能定位。
5. 最终做法：用**它所用的同一套原料**直接画在选中的 tab 上 ——
   `background: var(--segment)`（纯白）+ `box-shadow: var(--surface-shadow)`（官方三层细阴影）。
   代价是**没有滑动动画**。

**关键的一个坑**：浅灰底（`bg-default`）挂在 `.tabs__list-container` 上，
不是 `.tabs__list`。少了 `Tabs.ListContainer` 这一层，白药丸就没有底色托着，选中态看起来还是弱。
正确结构是：

```jsx
<Tabs.ListContainer>
  <Tabs.List>
    <Tabs.Tab id="a">A</Tabs.Tab>
  </Tabs.List>
</Tabs.ListContainer>
```

**教训**：遇到"官方组件不能用"时，先怀疑自己**用法不全**（少了容器/包裹层），
而不是立刻自己写 CSS 覆盖 —— 自己造的外观很难同时满足"不跳"和"看得清"。

## 品牌色换掉之后，次级按钮的文字也变紫了

**用户反馈**："很多按钮都变成紫色的了"。

**真因不是"按钮变紫"，而是紫的用量失衡。** HeroUI 把次级按钮的文字色算成
`--accent-soft-foreground = 70% accent + 30% 前景`。
用默认蓝时这个混合色几乎看不出颜色，但换成饱和度高的花椒紫之后，
**所有 outline / ghost 按钮的文字都成了紫的**：概览页的「去写 / 去建立 / 去分卷 / 查看」、
世界观的「AI 生成条目」…… 一屏十几个紫字，真正的主按钮反而不突出。

**修法**：在 globals.css 覆盖 `--accent-soft-foreground: var(--foreground)`，
次级动作走中性前景色，**只有 primary 用品牌色**。

**教训**：换主题色不能只改 `--accent`。要顺着它派生出去的所有变量检查一遍 ——
尤其是"accent 与前景混合"出来的柔和色，它们在低饱和的默认色下看不出问题，
换成一个有个性的品牌色之后才会暴露。

回归在 `scripts/verify-button-hierarchy.mjs`：守住"次级按钮不带品牌色"
与"一屏内实心品牌色按钮不超过 3 个"这两条主次规则。

## 左侧导航只长在 PageScaffold 上，于是有页面漏了

**用户反馈**："打开总览和写作，侧边栏消失了"。

**真因**：项目导航原先**写死在 `PageScaffold` 里**，所以只有用了脚手架的页面才有导航。
总览页（`Dashboard` → `ProjectOverview`）和写作页（全宽三栏，套不进脚手架）都没用它 ——
进去之后就没法切到别的页面，只能靠浏览器后退。

**修法**：把导航抽成 `components/layout/ProjectNav.tsx`，两处共用。
总览页改用 `PageScaffold`（它本来就该有统一的标题栏）；写作页把 `ProjectNav` 放在三栏最左边。

**教训**：把"跨页面共用的东西"写进某个页面模板里，就注定会有页面漏掉它。
这类问题的特点是**不报错**，只是用起来很别扭（少了导航），所以必须有回归守着。

`scripts/verify-project-nav.mjs` 遍历全部项目页确认导航在，并防住"某页漏项"。

**顺带记一个测试上的坑**：章节目录的根元素是 `div`（展开 `w-72` / 折叠 `w-14` 的图标条），
不是 `nav`。我第一版按 `nav` 找，把"明明在"误判成"没有"。判断布局元素要用宽度/结构特征，
别假设标签名。

## 保存丢最后一个字：读渲染状态，永远晚一拍

**用户报告**："写作编辑器不保存内容，写好的内容，一切换就没了"。

**复现后的真实症状**（比"不保存"更精确）：

```
正文里：起点甲乙丙丁
库里：  起点甲乙丙      ← 永远少最后一个字
```

而且**再等多久都不会补上** —— 因为后面没有新的输入，就不会再触发保存。

**真因**：保存时用的是渲染闭包里的 `draftHtml`。最后一次输入的链路是

```
onChange → setDraftHtml（排队）→ 重新渲染 → 新的 doSave（闭包里有新值）
                                            ↑ 这条链断在这里
```

新的 `doSave` 确实建好了，但**已经没有下一次输入来触发它**。
于是最后一次编辑永远丢在 `setDraftHtml` 与 `doSave` 之间的那道缝里。

**修法**：保存前直接从编辑器读当前内容（`handle.getContent()`），不经过 React 状态。
React 状态适合渲染，不适合当作"数据的真相" —— 尤其是保存这种要求精确的时刻。

**教训**：任何"把内容写出去"的动作，都应当从**权威来源**读取，
而不是从渲染层的副本读。反例就是这里：`draftHtml` 是渲染用的副本，
它的更新时机由 React 调度决定，跟"用户最后一次输入"并不同步。

回归在 `scripts/verify-editor-save.mjs`：逐字输入后断言
**落库内容与正文完全一致**（而不是只断言"包含刚输的内容"—— 那样丢字照样能过）。

## 换主题色要顺着 accent 的派生变量一起改

把整套界面的主色从"花椒紫"改成中性（白/黑/浅灰）时，**不要逐个把按钮改成白色**。

正确做法是**把 accent 本身改成中性**：

```css
:root { --accent: oklch(0.21 0 0); }        /* 近黑 */
.dark { --accent: oklch(0.93 0 0); }        /* 近白 */
```

HeroUI 的选中态、焦点环、滑块、主按钮**全都跟随 accent**，改一处就全变中性。
逐个覆盖 className 会漏，而且以后新加的控件又会带出旧色。

**两个必须同时处理的坑**（这次都踩到了）：

1. **硬编码的 Tailwind 色类**：项目里有 145 处 `violet-*`（`text-` / `bg-` / `border-` / `ring-`），
   它们不跟随 accent，必须一起换。其中 131 处是 `violet-500`。
2. **`--accent-soft-foreground`**：HeroUI 把它算成「70% accent + 30% 前景」，
   换色后会连带影响次级按钮的文字色（见上一节）。也要一起覆盖。

**保留语义色**：危险(红) / 成功(绿) / 警告(黄) 是信息，不是装饰。
把它们也改成灰会让"出错了"和"成功了"无法区分。回归里只禁装饰性彩色。

回归在 `scripts/verify-neutral-theme.mjs`：源码层禁 violet/purple/indigo/fuchsia，
渲染层断言主按钮是中性色（深浅两种模式都验）。

**功能性用色的取舍**：人物头像原本用 8 种色相区分不同人。
改成灰阶后风格统一了，但辨识度下降 —— 这是有意的取舍，
要换回来只需改 `src/features/characters/meta.ts` 里的 `AVATAR_CLASSES` 一个数组。

## "列表 + 常驻编辑面板"这种布局，怎么调比例都别扭

世界观页原来是两栏：左边条目列表（320px），右边常驻编辑面板（吃掉剩余宽度）。

我第一轮的处理是**调比例**：列表 380px、编辑区上限 680px、分栏推迟到 xl。
数据上好看多了（编辑区从 1152 变成 680），但用户仍然觉得不对，并提出改成弹窗。

**用户是对的，我只解决了症状。** 根因是：**编辑区一旦常驻，列表就永远要让出一大块横向空间**，
而作者在浏览条目时根本不需要编辑区。比例怎么调都是在两件事之间妥协。

改成弹窗后，浏览与编辑彻底分开：列表 1232px 占满，编辑按需浮出。

**迁移时的两个坑**：

1. **复用旧状态会带来旧行为**：弹窗的开关我一开始用的是 `activeId`，
   而它有个"没有选中就回退到 entries[0]"的逻辑（那是为常驻面板设计的"默认显示第一条"）。
   结果**一进页面弹窗就自动打开**。驱动新交互要用新状态（`selectedId`），别复用为旧交互设计的状态。
2. **变体模式要覆盖全部子块**：给 EntryEditor 加了 `flat`（弹窗内不画 Card 外框），
   但漏掉了"引用关系"那一块 —— 弹窗里就出现了"框里套框"。
   测试里专门断言"弹窗内没有多余 Card"，就是为了防这种漏。

**同时删掉了过时的测试**：`verify-world-layout.mjs` 测的是被取代的两栏尺寸，
留着它会永远失败。测试测的是"当前设计"，设计换了就该换测试，而不是留着红。

## 在字符串里嵌引号，tsc 和 build 都可能不报错

我在更新日志里写了这么一句话：

```ts
"…两个"对本章的操作"聚在行尾…"
```

**这在 TypeScript 里居然是合法的** —— 它被解析成相邻字符串字面量的拼接，
所以 `tsc --noEmit` 和 `vite build` **都不报错**。
但模块实际导出的是 `undefined`，Vite 的 dev server 在单独编译该文件时返回 **500**，
表现就是**整个应用白屏**。用户一刷新就撞上。

**发现过程**：跑回归时所有脚本都报 `页面没有挂载：{"rootChildren":0,"bodyLen":0}`。
我先怀疑是 dev server 挂了，但 `curl` 返回 200。
抓浏览器控制台才看到真相：`/src/core/changelog.ts` 返回 **500**。

**教训**：类型检查与构建通过，**不等于应用能跑起来**。
中文文案里嵌引号要用「」而不是 `"`。

**加了一条冒烟回归** `verify-app-boots.mjs`：打开首页断言 `#root` 真的渲染出内容，
并且全程没有 5xx 响应 —— 专门堵这个口子。

**顺带一个测试上的坑**：首页有异步加载（读 IndexedDB），会先显示"正在打开本地书库…"。
断言要看**加载完成之后**的内容，否则测的是加载态（我第一版就误判成"正文为空"）。
