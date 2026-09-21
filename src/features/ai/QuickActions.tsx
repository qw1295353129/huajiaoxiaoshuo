import type { ComponentType } from "react";
import { Button, Tooltip } from "@heroui/react";
import {
  Compass,
  Feather,
  ListTree,
  MessageCircleQuestion,
  ScanSearch,
  SlidersHorizontal,
  Tags,
} from "lucide-react";

/** 快捷动作：把常用指令固化下来，点一下就能跑 */
export interface QuickAction {
  key: string;
  label: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
  hint: string;
  /** 需要作者补充内容（比如粘贴待改写的段落），永远只填入输入框 */
  needsInput?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: "continue",
    label: "续写本章",
    icon: Feather,
    hint: "顺着当前章节的结尾继续写，保持口吻与节奏",
    prompt:
      "请顺着本章的结尾继续写下去，保持人物口吻、叙事视角与既有节奏，写 600~800 字。只输出正文，不要任何解释。",
  },
  {
    key: "diagnose",
    label: "本章有什么问题",
    icon: ScanSearch,
    hint: "以严苛编辑的视角体检当前章节",
    prompt:
      "请以最严苛的编辑视角体检当前章节：找出最严重的 3~5 个问题（结构、人物动机、节奏、逻辑、语言）。每条给出原文证据、为什么是问题、以及可以直接执行的修改方案。",
  },
  {
    key: "branches",
    label: "给三个剧情走向",
    icon: Compass,
    hint: "三条完全不同的后续路线，附代价与伏笔",
    prompt:
      "基于目前的设定与进度，给出三个走向完全不同的后续剧情方案。每个方案写清：核心冲突、主角必须做的选择、付出的代价、会埋下或回收什么伏笔。最后说明你更推荐哪一个以及理由。",
  },
  {
    key: "voice",
    label: "这个人物说话像不像他",
    icon: MessageCircleQuestion,
    hint: "对照人物卡检查台词口吻",
    prompt:
      "请对照人物卡（语气、口癖、常用词、绝不会说的话），检查当前章节里每个人物的台词是否像他本人。列出不像的地方，指出具体是哪句，并给出改写后的台词。",
  },
  {
    key: "titles",
    label: "帮我起十个章节名",
    icon: Tags,
    hint: "十个不剧透但有余味的章节名",
    prompt:
      "为接下来要写的这一章起十个章节名。要求：长短交错、有画面感、不剧透关键转折。每行一个，后面用括号补一句这个名字想传达什么。",
  },
  {
    key: "restrain",
    label: "把这段改写得更克制",
    icon: SlidersHorizontal,
    hint: "减少形容词与直陈情绪，改完粘回正文",
    needsInput: true,
    prompt:
      "把下面这段文字改写得更克制：减少形容词与情绪直陈，用动作和细节替代抒情，保留原有信息量与节奏。只输出改写后的文字。\n\n【把要改写的段落粘贴在这里】\n",
  },
  {
    key: "consistency",
    label: "检查有没有和前文矛盾",
    icon: ListTree,
    hint: "时间、状态、规则、称呼逐条比对前文",
    prompt:
      "请对照前文脉络与设定，检查我最近的写作有没有前后矛盾：时间线、人物状态、世界规则、物品位置、称呼与称谓。逐条列出：矛盾点、涉及的前文证据、建议的改法。没有发现问题也要明确说没有。",
  },
];

/** 一排快捷动作按钮 */
export function QuickActions({
  onPick,
  direct,
  onToggleDirect,
  disabled,
}: {
  onPick: (action: QuickAction) => void;
  direct: boolean;
  onToggleDirect: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
        {QUICK_ACTIONS.map((action) => (
          <Tooltip key={action.key}>
            <Tooltip.Trigger>
              <Button variant="ghost" size="sm" isDisabled={disabled} onPress={() => onPick(action)}>
                <action.icon className="size-3.5" />
                <span className="whitespace-nowrap">{action.label}</span>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              {action.hint}
              {direct && !action.needsInput ? "（点击直接发送）" : "（点击填入输入框）"}
            </Tooltip.Content>
          </Tooltip>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onToggleDirect(!direct)}
        className={
          "shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition " +
          (direct
            ? "border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-300"
            : "border-black/10 opacity-60 hover:opacity-100 dark:border-white/15")
        }
        title="开启后，点击快捷动作会直接发送给 AI"
      >
        {direct ? "点击即发送" : "点击填入"}
      </button>
    </div>
  );
}
