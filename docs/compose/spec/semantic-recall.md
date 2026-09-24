---
feature: semantic-recall
status: in-progress
updated: 2026-09-24
branch: feat/semantic-recall
commits: 
---

# 全板块语义重排（向量检索）

## Report

## [S1] Problem

上下文组装（`buildContext`）目前用固定规则挑选各板块内容：人物按本章出场与出场次数、世界条目按地点/重要度、伏笔按状态、时间线按就近、历史片段按 BM25 关键词打分。当作品体量变大、候选条目变多时，规则回答不了「这次生成该带哪些」—— 一条与当前章节毫不相关但重要度高的世界观条目会挤掉真正相关的那条，BM25 关键词召回也捞不出「换了说法的同一事件」。

记忆板块已有语义召回（`recall.ts` + `embedding.ts`，默认关闭、静默降级），但其余板块仍是纯规则。ROADMAP「向量检索」待办要求把 BM25 关键词召回升级为 embedding 检索并覆盖上下文选取。

## [S2] Design

### 总策略：规则选候选 + 语义重排

- 每个**候选型板块**先由现有规则选出候选集（与现在完全相同的逻辑），再在候选集**内部**用向量相似度重排、按板块上限裁剪。
- **固定板块不动**：作品档案、本章任务、写作规则、作者负反馈是固定全文注入；前文脉络摘要与文风样本没有候选集，均不重排。
- 硬信号不被顶掉：必选块（profile、chapter-task）与规则选出的硬成员（本章出场人物、本章地点、计划回收伏笔、置顶记忆）保持原有优先级，语义重排只影响非硬成员的顺序与取舍。
- **开关**：复用现有 `SemanticRecallSettings.enabled`（与记忆召回同一个开关），不新增设置项。
- **降级**：开关关闭、query 为空、向量服务不可达、熔断中、相似度全为非正 —— 任何一种情况都按现有规则顺序原样输出，不抛错、不弹窗，与 `recallMemories` 的降级约定一致。

### 适用板块与候选集（规则候选来源即现状）

| 板块 | 候选集 | 硬成员（重排不改变其必入地位） | 重排影响 |
|---|---|---|---|
| 人物 | 现 `pickRelevantCharacters` 的 primary + supporting | 本章出场、POV | supporting 内部顺序与取舍 |
| 世界 | 现 `pickRelevantWorld` 的 hot + cold 索引池 | 本章地点、summary 命中 | hot 内部排序；cold 索引池按相似度取前 24 |
| 伏笔 | 现有 active threads | 本章计划回收（due） | others 内部顺序与截断 |
| 时间线 | 现有 near + recent 合并集 | 含本章 id 的事件 | 合并集内部排序 |
| 历史片段 retrieval | 过往章节的段落分片 | — | 见下 |
| 写作记忆 | 现 `recallMemories`（已支持） | 置顶 | 不变 |

### 查询文本

复用 `buildRecallQuery(projectId, chapterId)`（最近编辑章节的正文与大纲）；调用方已传 `opts.query`（选中文本/检索词）时优先用它。所有板块共用同一个 query 向量，一次 `embedOne` 缓存复用（`embedOne` 已有会话内缓存）。

### 历史段落检索：段落级向量替换 BM25

- **分片**：章节正文按 `\n+` 切段，保留长度 > 20 字的段；单段超过 600 字时按句截断到 600 字。分片 id = `chapId:序号`，缓存键不依赖序号稳定性而依赖**段落文本本身**。
- **向量缓存**：沿用 `embeddings` 表，新增 `kind: 'passage'`，`refId` = 分片 id（`章节id:序号`，同一章节多行），`text` = 分片文本，`model` = 所用 embedding 模型。缓存命中判据与 `memoryVectors` 一致：`model` 与 `text` 都相等才算命中；章节正文变化后旧分片自然失效（text 不匹配），惰性重算并按同 id 覆盖写、不留垃圾行。
- **检索**：query 向量与所有候选分片算余弦，取 `score > 0` 的前 k（默认 4，沿用 `opts.recall`），输出格式与现有一致：`- （第N章 章名）片段（截断 220 字）`。只检索 `currentIndex` 之前的章节。
- **惰性建索引**：首次用到时对缺失分片批量 `embedTexts`（沿用 `MAX_BATCH`/`OPENAI_BATCH` 上限与熔断），逐条写缓存；写失败不影响本次召回。
- BM25 打分代码保留为降级路径：向量链路任何一步失败时回退到现有 `recallPassages` 关键词实现，保证「开了开关但服务不可用」时行为不劣于现状。

### 实现结构

- `src/ai/embedding.ts`：新增通用惰性缓存函数（内部 `cachedVectors(projectId, kind, items, cfg)`），与 `memoryVectors` 同模式；对外导出 `passageVectors`（kind=passage，历史段落分片）与 `sectionVectors`（kind=section，板块条目，T3 使用）；不引入记忆语义。
- `src/ai/recall.ts`：新增纯函数 `rerankBySimilarity(candidates, vectors, queryVec, opts)` —— 输入候选 id 列表、向量表、query 向量，返回重排后的 id 顺序；硬成员在调用方拼接时置前。纯函数便于离线测试。
- `src/ai/context.ts`：各候选型板块接 `rerankBySimilarity`；retrieval 板块改为「向量优先、BM25 兜底」。降级时签名与现输出逐字节一致。
- `src/db/repo/ai.ts`：`listEmbeddings` 支持按 `kind: 'passage'` 查询（若当前按 kind 过滤已存在则复用）。

### 错误行为

- 所有新增对外函数失败返回原候选顺序 / 空结果，不抛错（与 embedding.ts 三条硬规则一致）。
- 熔断窗口、超时、批量上限全部沿用 `embedding.ts` 现有常量。

### 测试边界

- 纯函数（rerank 合并顺序、分片切分、缓存命中判据、BM25 降级顺序）离线可测（`scripts/verify-recall.mjs`，Vite SSR 加载真实源码）。
- 缓存行为（首算写库、二次零请求、文本失效覆盖、开关关闭零请求、端点不通不抛错）走浏览器验收：Playwright + `mock-ollama`（带 `/__stats` 请求计数，验收脚本自行拉起于 11501）。
- 向量服务交互的单元测试不注入假向量表测重排逻辑（纯函数已覆盖）。
- 开关关闭时 `buildContext` 输出与改动前完全一致（回归对照）。

## [S3] Out of Scope

- 不做后台预建索引、不做索引进度 UI。
- 不新增设置控件、不拆分独立子开关。
- 不改记忆召回（`recallMemories`）的现有行为与合并策略。
- 不按板块定制 query；不做向量索引持久化迁移/清理工具。
- 不升级为向量数据库（继续用 Dexie embeddings 表 + 内存余弦）。
- 不覆盖固定板块（profile/chapter-task/rules/negative）与无候选集板块（history/style）。

## Tasks

- [ ] T1: 新增 `rerankBySimilarity` 纯函数与段落分片纯函数（切段、截断、分片 id） — acceptance: `npm run verify` 新增脚本能离线断言重排顺序（硬成员置前、score<=0 剔除、limit 裁剪）与分片边界（>20 字、600 字截断）(covers: S2 实现结构/测试边界)
- [ ] T2: `embedding.ts` 新增 `passageVectors` 惰性缓存函数 — acceptance: 首次调用对缺失分片算向量并写入 `embeddings` 表（kind=passage），二次调用全命中缓存零网络请求；服务不可用时返回空表不抛错 (covers: S2 向量缓存/惰性建索引/错误行为; depends: T1)
- [ ] T3: 候选型板块接入语义重排（人物/世界/伏笔/时间线/记忆路径确认） — acceptance: 开关开启且向量可用时 supporting/world-hot/threads-others/timeline 内部按相似度排序；开关关闭时 `buildContext` 输出与改动前逐字节一致 (covers: S2 适用板块/总策略; depends: T1)
- [ ] T4: retrieval 板块改为向量优先、BM25 兜底 — acceptance: 向量可用时按余弦取前 k 段、输出格式不变；向量任一步失败时回退现有 BM25 结果 (covers: S2 历史段落检索/降级; depends: T1, T2)
- [ ] T5: 验证脚本 + 类型检查 + 构建 + mock-llm 冒烟 — acceptance: `scripts/verify-recall.mjs` 全部通过；`tsc -b --force` 与 `vite build` 零错误；mock-llm 下关闭开关生成一次无控制台错误 (covers: S2 测试边界; depends: T2, T3, T4)
