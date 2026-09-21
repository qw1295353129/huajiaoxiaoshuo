/** 主题相关的常量与小工具，避免组件里散落魔法值。 */

export const PROJECT_COLORS = [
  "#7c5cff", "#2dd4bf", "#f59e0b", "#f43f5e", "#38bdf8",
  "#a3e635", "#c084fc", "#fb7185", "#22d3ee", "#facc15",
];

export function pickProjectColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

export const EDITOR_FONT_STACK = [
  { label: "宋体系（默认）", value: '"Songti SC", "Source Han Serif SC", "SimSun", Georgia, serif' },
  { label: "黑体系", value: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif' },
  { label: "楷体系", value: '"Kaiti SC", "STKaiti", "KaiTi", serif' },
  { label: "等宽", value: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
];

export const CHINESE_FONT_SIZES = [15, 16, 17, 18, 19, 20, 22, 24];

export const CHAPTER_STATUS_LABEL: Record<string, string> = {
  idea: "构思",
  outlined: "已细纲",
  drafting: "写作中",
  drafted: "初稿",
  revising: "修订中",
  done: "完成",
  cut: "废弃",
};

export const CHAPTER_STATUS_COLOR: Record<string, string> = {
  idea: "default",
  outlined: "accent",
  drafting: "warning",
  drafted: "success",
  revising: "accent",
  done: "success",
  cut: "danger",
};
