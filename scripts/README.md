# 验证与辅助脚本

所有脚本都不依赖外部服务，可离线复跑。

| 脚本 | 作用 | 命令 |
|---|---|---|
| `verify-utils.mjs` | 纯函数测试：变体扫描（2/3/4 字名）、中文字数、分章、diff、token 预算、JSON 容错 | `npm run verify` |
| `verify-zip.mjs` | 自研 ZIP 写入器校验：对照 Python `zipfile` 检查 CRC、中央目录、UTF-8 文件名、mimetype 位置 | `npm run verify:zip` |
| `verify-ebook.mjs` | EPUB 3 与 DOCX 格式校验：zip 完整性、XML 良构、OPF spine/manifest 一致、OOXML 必需部件 | `npm run verify:ebook` |
| `proxy.mjs` | **本地代理**：给不支持浏览器跨域（CORS）的模型服务做转发。数据只经本机，Key 不写盘 | `npm run proxy` |
| `mock-llm.mjs` | 本地假模型（OpenAI 兼容），无 API Key 也能跑通 AI 链路 | `npm run mock-llm` |
| `verify-proxy.mjs` | 回归：代理探测、经代理真实请求、未启动时代理路径被跳过、本地模型永不走代理、设置页卡片 | 先起 `npm run proxy`，再 `node scripts/verify-proxy.mjs` |
| `verify-conflict.mjs` | 回归：超时与"用户取消"被正确区分、冲突自检分批与进度、执行前的分批说明、不把超时误报为失败 | 需 Key：`DEEPSEEK_KEY=… node scripts/verify-conflict.mjs` |
| `ai-e2e.mjs` | AI 链路端到端：配置模型 → 续写 → 流式 → 插入正文 → 落库校验 | `npm run e2e:ai` |
| `shot.mjs` | 任意页面截图 + 控制台错误收集（持久 profile，数据跨次保留） | `npm run shot -- <url> <png>` |
| `verify-settings-entry.mjs` | 回归：全部「设置」入口（首页按钮 / 侧栏 / AI 面板模型名 / ⌘, / 命令面板 / 引导按钮）都能真正进入设置 | `node scripts/verify-settings-entry.mjs` |
| `verify-rebrand.mjs` | 回归：图标无「墨」字且为黑底、死设置项已清、默认心流真的生效、库名与存储键已统一为 huajiao | `node scripts/verify-rebrand.mjs` |
| `verify-overview.mjs` | 回归：项目总览页（进度/今日/近 7 天/指标卡/行动项/节奏图/结构分布），且不再出现「建设中」 | `node scripts/verify-overview.mjs` |
| `verify-review.mjs` | 回归：审稿协作 —— 批注锚定与正文标记渲染、修订建议接受/拒绝与快照、**改稿后锚点自动重定位**、审稿台、更新日志 | `node scripts/verify-review.mjs` |

## 真模型验证

需要一次性 Key，脚本内不保存任何凭据：

```bash
DEEPSEEK_KEY=sk-xxx node -e "/* 见 git 历史里的 real-model-e2e 脚本，或直接用界面跑 */"
```

已验证过的真模型行为（DeepSeek V4 系列）：
- 连接自检、流式输出、JSON 结构化输出均正常
- 一句话成书单阶段：6 人物 + 12 世界观条目 + 6 硬规则，81 秒 / 15.6k tokens
- 创作者档案（笔名、写作原则、全局禁用词、长期指令）确实进入 system prompt
- **推理模型会先花 token 思考**：max_tokens 给小了正文会为空，见 `docs/GOTCHAS.md`
