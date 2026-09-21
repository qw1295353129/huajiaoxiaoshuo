# 花椒写作平台

本地优先的 AI 长篇小说创作工作台。人物、世界观、伏笔、时间线都是可被 AI 读取的结构化资产，
每次生成都会自动组装正确的上下文 —— 目标是让 AI 写出来的东西不用大改。

- 前端：React 19 · TypeScript · HeroUI v3 · Tailwind CSS v4 · Vite 8
- 存储：浏览器 IndexedDB（Dexie），**数据不出本机**；可导出 JSON 全量备份
- 模型：DeepSeek / OpenAI / Kimi / 智谱 / 通义 / 硅基流动 / OpenRouter / Ollama / LM Studio / 任意 OpenAI 兼容服务

## 快速开始

```bash
npm install
npm run dev            # http://127.0.0.1:5178
```

首次使用：右上角「设置 → 模型与 AI」选一个供应商、填 API Key（本地模型无需 Key）、点「测试连接」，
再在顶部选择模型即可。也可以「设置 → 任务路由」为不同任务指定不同模型。

没有 API Key 也能验证整条 AI 链路：

```bash
node scripts/mock-llm.mjs 8765   # 启动本地假模型
# 然后在设置里新增供应商：名称任意，地址 http://127.0.0.1:8765/v1，模型 mock-story-model
```

## 目录结构

```
src/
  core/        领域模型（无依赖，桌面端可复用）
  db/          Dexie 表结构与仓储层（唯一的数据读写入口）
  ai/          供应商适配、上下文组装、JSON 修复、创作与质量能力、抽取与成书流水线
  utils/       文本/字数/diff/token 预算/文风分析等纯函数
  app/         全局状态、路由、数据订阅 hooks
  components/  共享 UI（脚手架、通知、命令面板）
  features/    各功能页面（editor / outline / characters / world / threads / timeline / graph /
               insights / consistency / ai / genesis / usage / data / settings）
scripts/       mock-llm（假模型）、ai-e2e（AI 链路验证）、shot（截图排查）
docs/          GOTCHAS（陷阱与约定）
```

## 命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 类型检查 + 生产构建 |
| `npx tsc -b --force` | 全量类型检查 |
| `npm run verify` | 纯函数测试（28 项） |
| `npm run verify:zip` | ZIP 写入器校验（对照 Python zipfile） |
| `npm run verify:ebook` | EPUB / DOCX 格式校验 |
| `npm run mock-llm` | 启动本地假模型（无需 API Key） |
| `npm run e2e:ai` | AI 链路端到端 |
| `npm run lint` | oxlint |

## 支持的导出格式

| 格式 | 用途 |
|---|---|
| **EPUB 3** | 阅读器、自出版（规范级：mimetype 首位不压缩、nav + NCX、OPF 元数据） |
| **DOCX** | 投稿给编辑（真 OOXML，A4 页面、中文首行缩进、章节分页） |
| TXT / Markdown / HTML | 通用投稿、Obsidian/Notion、打印成 PDF |
| JSON | 全量结构化备份，可原样恢复 |

ZIP 与 EPUB/DOCX 都是自研实现（`src/features/data/zip.ts`、`ebook.ts`），零第三方依赖，校验方式见 `scripts/verify-zip.mjs` / `verify-ebook.mjs`。

## 数据安全

作品全部存在浏览器 IndexedDB 里。浏览器「清除浏览数据」会连带清掉，
所以请在「数据与导出」页定期生成备份文件（支持 gzip 压缩）另存到磁盘。

AI 调用只发送**必要上下文**，每次生成后可以在「AI 用量」里看到具体带了哪些来源、各花多少 token。
「设置 → 隐私」里关闭云端后，只允许本机模型参与生成。

详见 [ROADMAP.md](ROADMAP.md) 与 [docs/GOTCHAS.md](docs/GOTCHAS.md)。
