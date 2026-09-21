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
