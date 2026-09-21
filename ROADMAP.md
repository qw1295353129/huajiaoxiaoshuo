# 墨枢 NovelForge · 开发路线与状态

> 本地优先的 AI 长篇小说创作工作台。前端 React 19 + TypeScript + HeroUI v3 + Tailwind v4，数据全部存在浏览器 IndexedDB。
> 桌面端（Tauri 2）在网页端完善后再打包；当前所有业务逻辑都不依赖浏览器专有 API，可直接复用。

## 已完成

- [x] 工程底座：Vite 8 + React 19.2 + TS 6 + Tailwind 4.3 + HeroUI 3.2.6（v3 无需 Provider）
- [x] 领域模型：Project / Arc / Chapter / Beat / Character / Relationship / WorldEntry / Entity / PlotThread / TimelineEvent / Glossary / Rule / Issue / Metric / StyleFingerprint / AiSession / Suggestion / Generation / Provider / Routing / PromptTemplate
- [x] 本地数据层：Dexie v1 共 30 张表，按 projectId 隔离 + 级联删除 + 项目复制
- [x] AI 引擎
  - [x] 供应商适配（OpenAI 兼容协议）：DeepSeek / OpenAI / Kimi / 智谱 / 通义 / 硅基流动 / OpenRouter / Ollama / LM Studio / 自建
  - [x] 流式输出、并发重试、指数退避、错误归类（CORS / 鉴权 / 限流 / 超长）
  - [x] 隐私闸门：关闭云端后自动降级到本地模型
  - [x] 多模型降级链（任务路由 → 备用模型）
  - [x] JSON 结构化输出 + 自动修复（截断补全、标点纠正、抢救数组）
  - [x] Context Builder：人物/世界观/伏笔/时间线/规则/前文脉络/文风样本 + token 预算裁剪 + 引用清单
  - [x] 创作能力：续写、扩写、改写、润色、描写、对话、头脑风暴、严苛评审
  - [x] 质量能力：一致性检查、口吻校验、文风检查、节奏分析、读者模拟、伏笔审计、场景建议
  - [x] 离线体检：文风指纹、AI 味检测、错别字、标点规范、重复片段、跨章相似度、张力估算
  - [x] 抽取管线：实体/人物/关系/时间线/名词表/伏笔抽取，章节归档，故事圣经生成
  - [x] 一句话成书：五阶段流水线（核心设定 → 人物 → 世界观 → 分卷 → 章节大纲）并可落库
- [x] 应用外壳：路由、书库、新建作品、命令面板（⌘K）、全局提示、导航脚手架

## 进行中

- [ ] 写作台（三栏：章节列表 / TipTap 编辑器 / AI 面板），自动保存、版本快照、心流模式
- [ ] 设定库页面：大纲、人物、世界观、伏笔支线、时间线、关系图谱
- [ ] 分析与 AI 页面：写作分析、一致性报告、AI 工作室、一句话成书向导、用量统计
- [ ] 设置页：供应商与 API Key、任务级模型路由、编辑器偏好、隐私开关

## 待办

- [ ] 导入导出：TXT/Markdown 导入切章、EPUB/DOCX/Markdown/TXT 导出、全量 JSON 备份与恢复
- [ ] 协作与审稿：行内评论、建议模式、审稿清单
- [ ] 本地代理（可选）：绕过浏览器 CORS 的小型转发服务，默认走直连
- [ ] 桌面端：Tauri 2 打包，复用同一套 core/db/ai 层，改为文件系统存储
- [ ] 测试：AI 引擎单测（JSON 修复、预算裁剪、diff）、数据层单测、关键流程 e2e

## 关键约定

- 所有 AI 调用必须走 `src/ai/runner.ts`，以统一降级、计费与日志。
- 所有数据库读写走 `src/db/repo/*`，不要在组件里直接写 Dexie 查询。
- 中文正文换行即分段；编辑区用 `textToDoc / docToText` 转换。
- HeroUI v3 使用 React Aria 语义：`onPress` / `isDisabled` / `isPending`，没有 `asChild`；Tooltip 用 `Tooltip.Trigger + Tooltip.Content`。
