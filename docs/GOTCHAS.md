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

## Tailwind v4
- 重要修饰符后置：`bg-red-500!`（不是 `!bg-red-500`）。
- 透明度用斜杠：`bg-black/5`（不是 `bg-opacity-5`）。
- `rounded` / `shadow` 整体下移一档，旧写法视觉会变。
- 自定义变体用 `@custom-variant`，自定义工具类用 `@utility`。

## 中文正文处理
- 中文写作里换行即分段，**不要**依赖 Markdown 的双换行分段。
- 入库用 `textToDoc`（文本 → HTML），出库用 `docToText`（HTML → 文本）。
- 段首缩进交给 CSS `text-indent`，正文里不要写全角空格，否则会叠加。

## 工具链
- ego-browser 运行时是 Linux 构建，在 macOS 上会报 `no X display`；本项目的浏览器验证统一用
  `node scripts/shot.mjs <url> <png>`（Playwright + 系统 Edge 通道）。
- 不要用 `bash` 里的 `cat > file <<'EOF'` 写含反引号的 TS 文件：多层级转义容易静默损坏源码。
  需要写长文件时用 write 工具，或先写 `.mjs` 生成脚本再执行。
