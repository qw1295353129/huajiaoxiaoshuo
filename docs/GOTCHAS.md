# 已知陷阱与规避方式

## TypeScript 6 元组解构推断缺陷
```ts
// ✗ 第 4 个元素会被错误推断为 Boolean，报 "This expression is not callable"
const [value, loading, error, reload] = useAsync(fn, deps, initial);

// ✓ 用索引访问
const res = useAsync(fn, deps, initial);
const value = res[0];
const reload = res[3];
```
影响：任何返回元组的自定义 hook。新增此类 hook 时优先返回对象而不是元组。

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
