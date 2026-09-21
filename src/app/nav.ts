import {
  BookOpen, Boxes, Compass, Gauge, GitBranch, Layers, LayoutDashboard, Network,
  ScrollText, Sparkles, Settings, Upload, Users, Wand2, Clock, ScanEye, BookMarked,
} from "lucide-react";
import { ROUTES } from "./routes";

export interface NavItem {
  key: string;
  label: string;
  icon: typeof BookOpen;
  to: (projectId: string) => string;
  group: "writing" | "world" | "ai" | "system";
  shortcut?: string;
}

export const ROUTE_PAGES: NavItem[] = [
  { key: "overview", label: "总览", icon: LayoutDashboard, to: ROUTES.overview, group: "writing", shortcut: "G O" },
  { key: "write", label: "写作", icon: BookOpen, to: (id) => ROUTES.write(id), group: "writing", shortcut: "G W" },
  { key: "outline", label: "大纲", icon: Layers, to: ROUTES.outline, group: "writing", shortcut: "G L" },
  { key: "characters", label: "人物", icon: Users, to: ROUTES.characters, group: "world", shortcut: "G C" },
  { key: "world", label: "世界观", icon: Compass, to: ROUTES.world, group: "world", shortcut: "G B" },
  { key: "threads", label: "伏笔支线", icon: GitBranch, to: ROUTES.threads, group: "world" },
  { key: "timeline", label: "时间线", icon: Clock, to: ROUTES.timeline, group: "world" },
  { key: "graph", label: "关系图谱", icon: Network, to: ROUTES.graph, group: "world" },
  { key: "insights", label: "写作分析", icon: Gauge, to: ROUTES.insights, group: "ai" },
  { key: "consistency", label: "一致性检查", icon: ScrollText, to: ROUTES.consistency, group: "ai" },
  { key: "review", label: "审稿台", icon: ScanEye, to: ROUTES.review, group: "ai", shortcut: "G R" },
  { key: "ai", label: "AI 工作室", icon: Sparkles, to: ROUTES.ai, group: "ai", shortcut: "G A" },
  { key: "genesis", label: "一句话成书", icon: Wand2, to: ROUTES.genesis, group: "ai" },
  { key: "blueprint", label: "拆书仿写", icon: BookMarked, to: ROUTES.blueprint, group: "ai" },
  { key: "usage", label: "AI 用量", icon: Boxes, to: ROUTES.usage, group: "system" },
  { key: "data", label: "数据与导出", icon: Upload, to: ROUTES.data, group: "system" },
];

export const NAV_GROUPS: { key: NavItem["group"]; label: string }[] = [
  { key: "writing", label: "创作" },
  { key: "world", label: "设定库" },
  { key: "ai", label: "AI 能力" },
  { key: "system", label: "数据" },
];

export { Settings };
