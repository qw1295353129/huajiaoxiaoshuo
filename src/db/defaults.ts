import type { AiTaskKind, ModelParams, ProviderConfig, TaskRouting } from '@/core';

export const DEFAULT_PARAMS: ModelParams = {
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 4096,
  frequencyPenalty: 0.3,
  presencePenalty: 0.2,
};

/** 各任务默认参数：创作类高温、分析类低温 */
const TASK_PARAMS: Record<AiTaskKind, Partial<ModelParams>> = {
  // 注意：DeepSeek V4 等推理模型会先花 token 思考，预算给小了正文会是空的。
  // 这里给结构化大任务预留充足额度（runner 里还有"思考吃光预算就自动加倍重试"的护栏）。
  genesis: { temperature: 0.95, maxTokens: 16000 },
  outline: { temperature: 0.85, maxTokens: 16000 },
  'chapter-outline': { temperature: 0.8, maxTokens: 4000 },
  continue: { temperature: 0.92, maxTokens: 3000, frequencyPenalty: 0.45 },
  expand: { temperature: 0.88, maxTokens: 2500 },
  rewrite: { temperature: 0.8, maxTokens: 3000 },
  polish: { temperature: 0.5, maxTokens: 3000 },
  describe: { temperature: 0.9, maxTokens: 1200 },
  dialogue: { temperature: 0.9, maxTokens: 2000 },
  brainstorm: { temperature: 1.0, maxTokens: 3000 },
  consistency: { temperature: 0.1, maxTokens: 4000 },
  'style-check': { temperature: 0.1, maxTokens: 3000 },
  'voice-check': { temperature: 0.15, maxTokens: 3000 },
  pacing: { temperature: 0.2, maxTokens: 3000 },
  'character-arc': { temperature: 0.3, maxTokens: 3000 },
  'foreshadow-audit': { temperature: 0.2, maxTokens: 3000 },
  'reader-sim': { temperature: 0.7, maxTokens: 3000 },
  critique: { temperature: 0.3, maxTokens: 4000 },
  'extract-entities': { temperature: 0.0, maxTokens: 4000 },
  'extract-characters': { temperature: 0.0, maxTokens: 4000 },
  'extract-timeline': { temperature: 0.0, maxTokens: 3000 },
  summarize: { temperature: 0.2, maxTokens: 1500 },
  'state-diff': { temperature: 0.1, maxTokens: 2500 },
  'chapter-summary': { temperature: 0.2, maxTokens: 1200 },
  chat: { temperature: 0.8, maxTokens: 4000 },
  agent: { temperature: 0.4, maxTokens: 6000 },
};

export function defaultRouting(): TaskRouting[] {
  return (Object.keys(TASK_PARAMS) as AiTaskKind[]).map((kind) => ({
    kind,
    fallbacks: [],
    params: TASK_PARAMS[kind],
    deep: kind === 'critique' || kind === 'consistency',
    candidates: kind === 'continue' ? 3 : kind === 'rewrite' ? 3 : 1,
  }));
}

/** 预置供应商：只填 baseUrl，key 由用户填 */
export const PROVIDER_PRESETS: Omit<ProviderConfig, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'preset-deepseek',
    name: 'DeepSeek 深度求索',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    // DeepSeek V4 系列是推理模型：会先思考再输出，max tokens 要给足
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    corsBlocked: true,
    enabled: false,
  },
  {
    id: 'preset-openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
    corsBlocked: true,
    enabled: false,
  },
  {
    id: 'preset-moonshot',
    name: 'Moonshot 月之暗面 (Kimi)',
    kind: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0905-preview'],
    corsBlocked: true,
    enabled: false,
  },
  {
    id: 'preset-zhipu',
    name: '智谱 GLM',
    kind: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    corsBlocked: true,
    enabled: false,
  },
  {
    id: 'preset-qwen',
    name: '阿里通义千问',
    kind: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    corsBlocked: true,
    enabled: false,
  },
  {
    id: 'preset-siliconflow',
    name: '硅基流动 SiliconFlow',
    kind: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'THUDM/glm-4-9b-chat'],
    corsBlocked: true,
    enabled: false,
  },
  {
    id: 'preset-openrouter',
    name: 'OpenRouter',
    kind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat'],
    corsBlocked: false,
    enabled: false,
  },
  {
    id: 'preset-ollama',
    name: 'Ollama（本地，完全离线）',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:14b', 'qwen2.5:32b', 'llama3.1:8b'],
    corsBlocked: false,
    enabled: false,
  },
  {
    id: 'preset-lmstudio',
    name: 'LM Studio（本地，完全离线）',
    kind: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: ['local-model'],
    corsBlocked: false,
    enabled: false,
  },
];

/** 中文网文常见体裁 */
export const GENRES = [
  '玄幻', '奇幻', '武侠', '仙侠', '都市', '现实', '历史', '军事', '科幻', '末世',
  '悬疑', '推理', '惊悚', '恐怖', '言情', '古言', '现言', '校园', '青春', '职场',
  '宫斗', '宅斗', '穿越', '重生', '系统', '无限流', '游戏', '体育', '轻小说', '短篇',
] as const;

export const WORLD_CATEGORY_LABELS: Record<string, string> = {
  geography: '地理', history: '历史', politics: '政治', magic: '力量体系', technology: '科技',
  religion: '宗教', economy: '经济', species: '种族', culture: '文化', organization: '组织',
  item: '物品', language: '语言', custom: '自定义',
};

export const TASK_LABELS: Record<AiTaskKind, string> = {
  genesis: '一句话成书', outline: '生成大纲', 'chapter-outline': '章节细纲', continue: '续写正文',
  expand: '扩写', rewrite: '改写', polish: '润色', describe: '描写生成', dialogue: '对话生成',
  brainstorm: '头脑风暴', consistency: '一致性检查', 'style-check': '文风检查', 'voice-check': '人物口吻检查',
  pacing: '节奏分析', 'character-arc': '人物弧光分析', 'foreshadow-audit': '伏笔审计', 'reader-sim': '读者模拟',
  critique: '毒舌评审', 'extract-entities': '实体抽取', 'extract-characters': '人物抽取',
  'extract-timeline': '时间线抽取', summarize: '摘要', 'state-diff': '状态变更提取',
  'chapter-summary': '章节摘要', chat: '对话', agent: '智能体',
};
