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
