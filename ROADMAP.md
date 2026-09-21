# 花椒写作平台 · 开发路线与状态

> 本地优先的 AI 长篇小说创作工作台。
> 前端 React 19 · TypeScript · HeroUI **v3.2.6** · Tailwind CSS **v4** · Vite 8 · Dexie(IndexedDB)。
> 所有数据存在浏览器本地，桌面端（Tauri 2）在网页端完善后再打包 —— 业务逻辑全部在 `src/core`、`src/db`、`src/ai`、`src/utils`，不依赖浏览器专有 API，可直接复用。

## 一、已完成（网页端第一阶段）

### 工程底座
- [x] Vite 8 + React 19.2 + TS + Tailwind 4.3 + HeroUI 3.2.6（v3 无需 Provider，`@import "@heroui/styles"`）
- [x] 品牌主题（`--accent` 紫）、深色模式、中文排版样式、心流模式样式
- [x] 149 个源文件 / 约 3.2 万行，`tsc -b --force` 与 `vite build` 均零错误

### 领域模型与本地数据层
- [x] 完整实体模型：Project / Arc / Chapter / Beat / ChapterContent / Snapshot / Character / Relationship /
      WorldEntry / WorldRule / Entity / EntityMention / Faction / PlotThread / TimelineEvent / Glossary /
      ContinuityRule / Issue / ChapterMetric / StyleFingerprint / WritingGoal / WritingSession / Pomodoro /
      AiSession / AiSuggestion / AiGeneration / ProviderConfig / TaskRouting / PromptTemplate / GenesisRun
- [x] Dexie v1，30 张表，按 projectId 隔离，级联删除、项目复制、统计重算
- [x] 打包导出/恢复：全量 JSON、gzip 压缩、合并/覆盖恢复、纯文本导入自动分章、故事圣经导出

### AI 引擎（`src/ai/`）
- [x] 供应商适配层：OpenAI 兼容协议，预置 DeepSeek / OpenAI / Kimi / 智谱 / 通义 / 硅基流动 / OpenRouter /
      Ollama / LM Studio / 自建；连接自检（`/models`）
- [x] 流式输出、并发重试、指数退避、错误归类（CORS / 鉴权 / 限流 / 超长 / 中断）、可选本地代理转发
- [x] 隐私闸门：关闭云端后自动降级到本地模型
- [x] 多模型降级链：任务路由 → 备用模型
- [x] JSON 结构化输出 + 自动修复（剥代码块、截断补全、标点纠正、抢救数组），截断时自动加大 max_tokens 重试
- [x] **Context Builder**：作品档案 / 本章任务 / 人物（核心+配角）/ 世界观（相关+索引）/ 伏笔 / 时间线 /
      规则 / 前文脉络 / 文风样本 / 检索召回 / 作者负反馈，按 token 预算优先级裁剪，输出引用清单
- [x] 创作能力：续写、扩写、改写、润色、描写、对话、头脑风暴、严苛评审（多候选 + 温度扰动）
- [x] 质量能力：一致性检查、口吻校验、文风检查、节奏分析、读者模拟、伏笔审计、场景建议
- [x] 离线体检（零 token）：文风指纹、AI 味检测、错别字、标点规范、重复片段、跨章相似度、张力估算
- [x] 抽取管线：实体/人物/关系/时间线/名词表/伏笔抽取（提案 → 人工勾选 → 入库），章节归档，故事圣经汇总
- [x] 一句话成书：五阶段流水线（核心设定 → 人物 → 世界观 → 分卷 → 章节大纲）+ 选择性落库

### 界面
- [x] 应用外壳：路由、书库、新建作品、命令面板（⌘K）、全局提示、导航脚手架、空/加载态
- [x] **写作台**：三栏（目录 / TipTap 编辑器 / AI 面板）；自动保存、写作会话与速度、番茄钟、版本快照
      （手动 + 定时 + 恢复前自动备份）、心流模式、打字机滚动、章节属性面板、快捷键
- [x] 大纲页：卷章树 + 拖拽排序 + 张力曲线 + 章节细纲编辑 + AI 细纲/场景建议/整卷大纲生成
- [x] 人物页：卡片库 + 详情（含**口吻卡**）+ 里程碑 + 出场统计 + 关系编辑 + AI 补全
- [x] 世界观页：分类导航 + 条目编辑 + `[[双向链接]]` + 硬规则 + 规则冲突自检 + 名词表
- [x] 伏笔页：健康度看板 + 热力图 + CRUD + AI 审计
- [x] 时间线页：剧情内时间轴 / 章节轴双视图 + 本地冲突检测 + AI 抽取
- [x] 关系图谱：纯 SVG 力导向 + 拖拽/缩放 + 边编辑
- [x] 写作分析：热力图、字数趋势、章节指标曲线、文风指纹、AI 味体检、宏观审计
- [x] 一致性报告：问题看板 + 单章/整本检查 + 一键全流程
- [x] AI 工作室：会话管理 + 流式对话 + 快捷动作 + 上下文可视化
- [x] 一句话成书向导、AI 用量统计（token/成本/按任务/按天）
- [x] 设置：供应商与 API Key、任务路由（逐任务选模型/温度/候选/备用）、写作偏好、隐私、数据、关于
- [x] 数据与导出：TXT / Markdown / HTML / JSON、章节选择、导入切章、备份恢复、故事圣经

## 二、验证方式（可复跑）

```bash
npm run dev                      # 开发服务器（默认 5178）
npx tsc -b --force               # 类型检查（含 30 张表与全部 AI 模块）
npx vite build                   # 生产构建

node scripts/mock-llm.mjs 8765   # 本地假模型（OpenAI 兼容，无需 API Key）
node scripts/ai-e2e.mjs          # AI 链路端到端：配置→续写→流式→插入→落库校验
node scripts/shot.mjs <url> <png>  # 任意页面截图 + 控制台错误收集
```

已实测通过：建作品 → 写作 → 自动保存 → 刷新正文仍在；AI 续写出 3 个候选（token 与上下文来源可见）→
插入正文 → 字数/状态自动更新；全部 13 个功能页在有真实数据的情况下零控制台错误。

## 三、待办

### 网页端补完
- [ ] 协作与审稿：行内评论、建议模式、审稿清单
- [ ] EPUB / DOCX 导出（当前为 TXT / MD / HTML / JSON）
- [ ] 自动保存的冲突处理 UI（`saveChapterContent` 已支持 `expectedRev`）
- [ ] 向量检索（当前为 BM25 风格关键词召回，已够用；量大时接 embedding）
- [ ] 单元测试与 e2e 测试固化（JSON 修复、预算裁剪、diff、导出）

### 桌面端（后期）
- [ ] Tauri 2 打包；把 Dexie 存储换成 SQLite/文件系统适配层（`src/db/repo/*` 是唯一改动面）
- [ ] 本地模型内置引导、系统级快捷键、多窗口

## 四、关键约定与陷阱

见 [docs/GOTCHAS.md](docs/GOTCHAS.md)。要点：
- 自定义 hook 返回**对象**而非元组（避免"数错解构位置"）。
- Dexie：`modify` 回调不能返回值；`transaction` 必须传表数组。
- HeroUI v3：没有 `asChild` / `onClick`，用 `onPress` / `isDisabled` / `isPending`。
- 中文正文换行即分段，缩进交给 CSS，正文里不写全角空格。
