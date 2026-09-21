import type { AiTaskKind, PovStyle, Project } from "@/core";

/** 创作者档案（来自全局设置），会拼进所有任务的 system prompt */
export interface AuthorProfile {
  penName?: string;
  defaultGenres?: string[];
  defaultPov?: string;
  writingPrinciples?: string[];
  globalForbidden?: string[];
  globalInstructions?: string;
}

let authorProfile: AuthorProfile = {};

/** 由 app 启动时注入，避免 ai 层反向依赖 UI store */
export function setAuthorProfile(profile: AuthorProfile): void {
  authorProfile = profile ?? {};
}

export function getAuthorProfile(): AuthorProfile {
  return authorProfile;
}

function authorBlock(): string {
  const p = authorProfile;
  const lines: string[] = [];
  if (p.penName) lines.push(`作者笔名：${p.penName}`);
  if (p.writingPrinciples?.length) {
    lines.push("作者写作原则（必须遵守）：");
    for (const r of p.writingPrinciples) lines.push("- " + r);
  }
  if (p.globalForbidden?.length) lines.push(`全局禁用表达：${p.globalForbidden.join("、")}`);
  if (p.globalInstructions) lines.push(`长期要求：${p.globalInstructions}`);
  return lines.length ? "【创作者档案】\n" + lines.join("\n") : "";
}

/**
 * 写作记忆（从记忆库注入的那部分）。
 * 与 AuthorProfile 的区别：档案是作者手填的长期设定；记忆是系统从使用痕迹里
 * 积累出来的、带证据的偏好与教训。前者稳定，后者会随写作演化。
 */
export interface MemoryBlockInput {
  /** 会作为硬约束遵守的偏好与教训（已按可信度排序） */
  constraints: { text: string; kind: string }[];
}

let memoryBlock: MemoryBlockInput = { constraints: [] };

/** 由 runner 在每次生成前注入（按项目过滤后的结果） */
export function setMemoryBlock(input: MemoryBlockInput): void {
  memoryBlock = input ?? { constraints: [] };
}

export function getMemoryBlock(): MemoryBlockInput {
  return memoryBlock;
}

function memoryLines(): string {
  if (!memoryBlock.constraints.length) return "";
  const lines = ["【写作记忆（从你以往的选择中积累，请遵守）】"];
  for (const c of memoryBlock.constraints) lines.push("- " + c.text);
  return lines.join("\n");
}

/** 全任务共享的"作者人设 + 铁律"，是所有生成质量的底座 */
export function baseSystem(project?: Project): string {
  const lines: string[] = [
    "你是一位顶尖的中文小说创作助手，同时具备资深编辑的审美与责编的严谨。",
    "你服务于一位职业作者，你的产出必须直接可用，不能是示例、框架或待补充。",
    "",
    "【铁律】",
    "1. 严格遵守给定的世界观、人物设定、时间线。与设定冲突的内容一律不得写入。",
    "2. 不得凭空创造已有设定之外的关键名词（人名/地名/功法/组织）。确需新元素时，必须沿用已给出的命名习惯。",
    "3. 不使用总而言之、值得注意的是、在这个世界里这类 AI 腔与总结腔。",
    "4. 不解释你在做什么，不写以下是。直接输出成品。",
    "5. 中文标点使用全角；对话引号风格与原文保持一致。",
    "6. 不重复用户已经写过的句子，不把上文复述一遍当作新内容。",
  ];
  if (project) {
    lines.push("", "【作品信息】", `书名：${project.title}`);
    if (project.genres.length) lines.push(`体裁：${project.genres.join("、")}`);
    lines.push(`叙事视角：${POV_LABEL[project.pov]}`);
    lines.push(`时态：${project.tense === "past" ? "过去时叙述" : "现在时叙述"}`);
    if (project.themes.length) lines.push(`主题：${project.themes.join("、")}`);
    if (project.styleGuide) lines.push(`文风要求：${project.styleGuide}`);
    if (project.forbidden.length) lines.push(`禁止出现：${project.forbidden.join("、")}`);
    if (project.customInstructions) lines.push(`作者补充要求：${project.customInstructions}`);
  }
  const author = authorBlock();
  if (author) lines.push("", author);
  const memory = memoryLines();
  if (memory) lines.push("", memory);
  return lines.join("\n");
}

export const POV_LABEL: Record<PovStyle, string> = {
  first: "第一人称",
  "third-limited": "第三人称限知",
  "third-omniscient": "第三人称全知",
  second: "第二人称",
  mixed: "多视角切换",
};

/** 每种任务的正文写作要求 */
export const WRITING_RULES: Record<string, string> = {
  continue: [
    "【续写要求】",
    "- 紧接上文最后一句话的情绪与节奏，不重述上文。",
    "- 保持人物口吻一致：每个人说话的方式必须能从人设卡推出。",
    "- 用动作、细节、对话推进，避免大段心理独白堆砌。",
    "- 结尾留一个让读者想继续读的钩子。",
    "- 只输出正文，不要标题，不要任何说明。",
  ].join("\n"),
  expand: [
    "【扩写要求】",
    "- 保留原意与关键信息，通过感官细节、动作分解、对话展开来加厚。",
    "- 扩写后的篇幅约为原文的 1.8~2.5 倍。",
    "- 不添加改变剧情走向的新事件。",
    "- 只输出扩写后的正文。",
  ].join("\n"),
  rewrite: [
    "【改写要求】",
    "- 保留剧情事实不变，重写表达方式。",
    "- 提升具体度：抽象转具体，概述转场景。",
    "- 只输出改写后的正文。",
  ].join("\n"),
  polish: [
    "【润色要求】",
    "- 只做语言层面的优化：删冗词、换更准的动词、调整句式长短节奏。",
    "- 不改动任何剧情、人物、对白含义。",
    "- 输出润色后的完整正文。",
  ].join("\n"),
  describe: [
    "【描写要求】",
    "- 调动至少三种感官（视觉之外还要有听觉/触觉/嗅觉/体感）。",
    "- 用具体名词而非形容词堆砌。",
    "- 描写要服务于情绪与人物处境，不做纯风景展示。",
  ].join("\n"),
  dialogue: [
    "【对话要求】",
    "- 每句台词都要能体现说话人的身份、目的与当下情绪。",
    "- 台词之间要有潜台词和博弈，不要一问一答的信息交换。",
    "- 适度穿插动作与停顿，避免他说她说重复。",
  ].join("\n"),
};

/** 结构化输出要求模板 */
export function jsonInstruction(schemaHint: string): string {
  return [
    "【输出格式】",
    "只输出一个合法 JSON 对象，不要输出 Markdown 代码块标记，不要输出任何解释文字。",
    "JSON 结构必须严格符合以下说明：",
    schemaHint,
  ].join("\n");
}

/** 把上下文块拼成最终 user 消息 */
export function composeUserMessage(parts: { title?: string; body: string }[]): string {
  return parts
    .filter((p) => p.body.trim())
    .map((p) => (p.title ? "### " + p.title + "\n" + p.body.trim() : p.body.trim()))
    .join("\n\n");
}

/** 常见题材的写作要点，用于 genesis / outline 的质量提升 */
export const GENRE_CRAFT: Record<string, string> = {
  玄幻: "力量体系要有代价与边界；升级要有明确的资源换算；越级战斗必须有合理解释。",
  仙侠: "道心与情劫的张力；境界与资源的层级感；仙凡之别的价值观冲突。",
  武侠: "招式与内力的具象化；江湖规矩与人情；恩义与立场的两难。",
  都市: "现实质感的细节（职业、收入、通勤）；权力与资源的真实运作逻辑。",
  悬疑: "线索必须公平给出；每个疑点都要有回收；误导要建立在真实信息之上。",
  推理: "诡计可验证；凶手动机充分；侦探的推理链每一步都能被读者复核。",
  科幻: "设定自洽且有唯一核心假设；技术对社会结构的连锁影响。",
  言情: "情感推进要有事件驱动；误会不能靠不沟通维持；每次靠近都要付出代价。",
  历史: "制度与生活细节考据；不出现超越时代的技术与观念。",
  无限流: "规则必须明确且可被利用；副本难度曲线；队伍博弈与信任成本。",
  末世: "资源稀缺的具体化；秩序崩塌后的组织形态；生存决策的道德重量。",
};

export function craftFor(genres: string[]): string {
  const picked = genres.map((g) => GENRE_CRAFT[g]).filter(Boolean);
  if (!picked.length) return "";
  return "【题材要点】\n" + picked.map((p) => "- " + p).join("\n");
}

/** 各结构化任务的 schema 说明（作为提示词的一部分，比 JSON Schema 更省 token） */
export const ZHI_JIAN_SCHEMA = [
  "{",
  '  "issues": [',
  '    { "kind": "continuity|character-voice|timeline|world-rule|name-variant|pov|logic|foreshadow",',
  '      "severity": "blocker|error|warn|info",',
  '      "title": "一句话概括问题",',
  '      "detail": "具体说明为什么不一致",',
  '      "evidence": { "quote": "本章原文片段（必须逐字摘录）" },',
  '      "conflictsWith": { "label": "与什么冲突（章节名或设定条目名）", "quote": "对方原文或设定（可省略）" },',
  '      "suggestion": "可执行的修改建议",',
  '      "fixPrompt": "如果需要重写，给出给 AI 的指令（一句话）" }',
  "  ]",
  "}",
].join("\n");

export const OUTLINE_SCHEMA = [
  "{",
  '  "title": "书名",',
  '  "logline": "一句话故事",',
  '  "themes": ["主题1", "主题2"],',
  '  "hooks": ["核心卖点1", "核心卖点2"],',
  '  "arcs": [',
  '    { "title": "卷名", "kind": "volume", "summary": "本卷梗概（150字内）", "goal": "主角在本卷想要什么", "conflict": "主要阻碍", "outcome": "本卷结局状态",',
  '      "chapters": [ { "title": "章节名", "summary": "本章梗概80字内", "goals": ["推进点1"], "tension": 3, "hook": "本章悬念" } ] }',
  "  ]",
  "}",
].join("\n");

export const CHAPTER_BEATS_SCHEMA = [
  "{",
  '  "title": "章节名", "summary": "本章梗概", "goals": ["本章要完成的事"],',
  '  "pov": "视角人物名", "characters": ["出场人物名"], "location": "地点名",',
  '  "storyTime": "剧情内时间", "tension": 3, "hook": "开篇钩子", "cliffhanger": "结尾钩子",',
  '  "conflictType": "man-vs-self|man-vs-man|man-vs-nature|man-vs-society|man-vs-fate|man-vs-technology|none",',
  '  "beats": [ { "summary": "节拍内容", "kind": "hook|setup|rising|complication|crisis|climax|resolution|breather|reveal", "tension": 2 } ],',
  '  "plants": ["本章埋下的伏笔"], "pays": ["本章回收的伏笔"]',
  "}",
].join("\n");

export const GENESIS_SCHEMA = [
  "{",
  '  "title": "书名", "subtitle": "副标题（可空）",',
  '  "logline": "一句话故事（25字内，要有钩子）",',
  '  "premise": "核心高概念（150字内）",',
  '  "themes": ["主题"], "tone": "整体基调",',
  '  "characters": [ { "name": "姓名", "role": "protagonist|antagonist|deuteragonist|mentor|foil|love-interest|sidekick|minor",',
  '      "tagline": "一句话定位", "age": "年龄", "gender": "性别", "appearance": "外貌", "personality": "性格（要有矛盾面）",',
  '      "want": "表层欲望", "need": "深层需要", "fear": "恐惧", "flaw": "致命缺陷", "arc": "人物弧光", "secrets": "秘密",',
  '      "voice": { "tone": "语气", "tone2": "", "verbalTics": ["口癖"], "favoriteWords": ["常用词"], "neverSays": ["绝不会说的话"], "register": "语域", "sampleLines": ["示例台词1"] } } ],',
  '  "world": [ { "title": "条目名", "category": "geography|history|politics|magic|technology|religion|economy|species|culture|organization|item|language|custom", "body": "条目内容（具体、可被引用）", "importance": 1 } ],',
  '  "rules": [ { "title": "规则名", "statement": "不可违反的硬规则", "severity": "error|warn|info" } ],',
  '  "structure": [ { "title": "卷名", "summary": "本卷写什么", "goal": "主角目标", "conflict": "核心冲突", "outcome": "结束状态", "chapterCount": 12 } ],',
  '  "openingScene": "开篇 300 字正文，必须直接进入场景，不要背景介绍"',
  "}",
].join("\n");

export const VOICE_CHECK_SCHEMA = [
  "{",
  '  "deviations": [ { "character": "人物名", "quote": "不符合其口吻的台词原文", "why": "为什么不像这个人（对照人设卡）", "suggested": "改写后的台词" } ]',
  "}",
].join("\n");

export const STYLE_CHECK_SCHEMA = [
  "{",
  '  "score": 0,',
  '  "dimensions": { "sentenceRhythm": { "score": 0, "comment": "" }, "diction": { "score": 0, "comment": "" }, "imagery": { "score": 0, "comment": "" }, "dialogueNaturalness": { "score": 0, "comment": "" }, "pacing": { "score": 0, "comment": "" } },',
  '  "aiSmell": [ { "quote": "有 AI 味的句子", "why": "为什么像 AI 写的", "rewrite": "改写建议" } ],',
  '  "topFixes": ["最该改的三件事"]',
  "}",
].join("\n");

export const CRITIQUE_SCHEMA = [
  "{",
  '  "verdict": "一句话总评（犀利但不刻薄）", "score": 0,',
  '  "strengths": ["真正写得好的地方，要具体"],',
  '  "weaknesses": [ { "point": "问题", "evidence": "原文佐证", "fix": "具体怎么改" } ],',
  '  "readerExperience": "读者读到这里的真实感受曲线",',
  '  "priorityFixes": ["按优先级排序的三件事"]',
  "}",
].join("\n");

export const ENTITY_SCHEMA = [
  "{",
  '  "characters": [ { "name": "姓名", "aliases": ["别名"], "role": "protagonist|antagonist|deuteragonist|mentor|foil|love-interest|sidekick|minor", "tagline": "一句话定位", "appearance": "外貌", "personality": "性格", "evidence": "原文依据片段" } ],',
  '  "entities": [ { "name": "名词", "kind": "world|item|faction|location|event|concept|creature|skill|term", "summary": "一句话说明" } ],',
  '  "relationships": [ { "from": "甲", "to": "乙", "kind": "family|lover|spouse|friend|ally|rival|enemy|mentor|student|colleague|subordinate|superior|acquaintance|other", "affinity": 0, "description": "关系说明" } ],',
  '  "timeline": [ { "title": "事件", "inWorldTime": "剧情内时间", "participants": ["人物"], "location": "地点", "importance": 3 } ],',
  '  "glossary": [ { "canonical": "标准写法", "variants": ["错误写法或别称"] } ],',
  '  "foreshadows": [ { "title": "伏笔", "description": "埋的是什么", "quote": "原文片段", "plannedPayoff": "计划何时回收（可空）" } ]',
  "}",
].join("\n");

export const SUMMARIZE_SCHEMA = [
  "{",
  '  "summary": "本章梗概（150字内，客观陈述发生了什么）",',
  '  "events": ["关键事件"], "charactersPresent": ["出场人物"],',
  '  "stateChanges": [ { "who": "人物", "change": "发生了什么改变（受伤/获得/失去/关系变化/认知更新）" } ],',
  '  "openQuestions": ["本章留下未解的问题"],',
  '  "foreshadowsPlanted": ["本章埋的伏笔"], "foreshadowsPaid": ["本章回收的伏笔"]',
  "}",
].join("\n");

export const BRAINSTORM_SCHEMA = [
  "{",
  '  "directions": [ { "title": "方向名", "premise": "这个方向的核心想法", "why": "为什么它对这个故事有吸引力", "risk": "风险或代价", "examples": ["具体桥段1", "具体桥段2"] } ]',
  "}",
].join("\n");

export const READER_SIM_SCHEMA = [
  "{",
  '  "engagement": 0,',
  '  "curve": [ { "at": "章节位置", "interest": 0, "emotion": "读者此刻的情绪" } ],',
  '  "dropoutRisks": [ { "at": "位置", "reason": "为什么这里会弃书", "fix": "怎么救" } ],',
  '  "highlights": ["读者会记住的点"], "prediction": "读者读完最可能的反应"',
  "}",
].join("\n");

export const PACING_SCHEMA = [
  "{",
  '  "pacingScore": 0,',
  '  "segments": [ { "from": "起始位置概述", "to": "结束位置概述", "pace": "fast|medium|slow", "comment": "节奏评价" } ],',
  '  "sagging": [ { "where": "拖沓位置", "why": "为什么拖", "cut": "建议删减或合并的内容" } ],',
  '  "rushed": [ { "where": "过快位置", "why": "为什么赶", "expand": "建议补写的内容" } ]',
  "}",
].join("\n");

/** 内置提示词模板：任务 → 可编辑模板 */
export interface BuiltinTemplate {
  taskKind: AiTaskKind;
  name: string;
  system: string;
  user: string;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    taskKind: "continue",
    name: "续写正文（默认）",
    system: "{{baseSystem}}\n\n{{writingRules}}",
    user: "{{context}}\n\n### 续写指令\n从下面的断点继续写，约 {{targetWords}} 字。\n\n【上文结尾】\n{{tail}}",
  },
  {
    taskKind: "rewrite",
    name: "改写选中段落（默认）",
    system: "{{baseSystem}}\n\n{{writingRules}}",
    user: "{{context}}\n\n### 改写指令\n要求：{{instruction}}\n\n【选中段落】\n{{selection}}",
  },
  {
    taskKind: "polish",
    name: "润色（默认）",
    system: "{{baseSystem}}\n\n{{writingRules}}",
    user: "{{context}}\n\n【待润色段落】\n{{selection}}",
  },
  {
    taskKind: "consistency",
    name: "一致性检查（默认）",
    system: "你是长篇小说的责任编辑，专门负责抓前后矛盾。你只报告有原文证据的问题，绝不做无根据的猜测。",
    user: "{{context}}\n\n### 任务\n检查【待检章节】是否与【设定资料】及【前文脉络】存在矛盾。\n专注以下类型：人物设定矛盾、时间线冲突、世界观规则违反、称呼或名词不一致、已死角色再次行动、物品位置矛盾、能力越界。\n\n{{jsonSchema}}",
  },
];
