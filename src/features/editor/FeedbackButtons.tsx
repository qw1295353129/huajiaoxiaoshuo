import { useState } from "react";
import { Button, Chip, TextArea, Tooltip } from "@heroui/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { AiTaskKind, ID } from "@/core";
import { logFeedback } from "@/db/repo/ai";
import { extractRuleBasedMemory } from "@/ai/memory-extract";
import { useAppStore } from "@/app/store";

/**
 * 对一次生成结果给评价。
 *
 * 这不是"点赞功能"，而是**写作记忆最主要的信息来源**：
 * 作者说清楚"这次哪里不对"，就会变成一条带证据的教训，之后每次生成都会遵守。
 * 所以差评时鼓励写一句理由，并明确告诉作者这句话去了哪里。
 */
export function FeedbackButtons({
  projectId,
  taskKind,
  content,
  generationId,
}: {
  projectId: ID;
  taskKind: string;
  content: string;
  generationId?: ID;
}) {
  const notify = useAppStore((s) => s.notify);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (value: 1 | -1, withNote?: string) => {
    setBusy(true);
    try {
      await logFeedback({
        projectId,
        taskKind: taskKind as AiTaskKind,
        generationId,
        rating: value,
        note: withNote?.trim() || undefined,
        promptDigest: content.slice(0, 120),
      });
      setRating(value);
      if (value === -1 && withNote?.trim()) {
        // 差评理由立刻变成记忆：这是最直接的"你希望我怎么改"
        const res = await extractRuleBasedMemory({ projectId });
        notify(
          "success",
          "已记下这条意见",
          res.created.length
            ? "它已经成为一条写作记忆，之后每次生成都会遵守"
            : "已记录，之后每次生成都会参考",
        );
      } else if (value === -1) {
        notify("info", "已记下");
      } else {
        notify("success", "已标记为满意");
      }
      setNote("");
    } catch (e) {
      notify("danger", "记录失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (rating === 1) {
    return (
      <Chip size="sm" color="success">
        <ThumbsUp className="mr-0.5 inline size-2.5" />
        满意
      </Chip>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-1">
        <Tooltip>
          <Tooltip.Trigger>
            <Button size="sm" variant="ghost" isIconOnly isPending={busy} onPress={() => void submit(1)}>
              <ThumbsUp className="size-3.5" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>这次写得不错</Tooltip.Content>
        </Tooltip>
        <Tooltip>
          <Tooltip.Trigger>
            <Button size="sm" variant="ghost" isIconOnly onPress={() => setRating(rating === -1 ? null : -1)}>
              <ThumbsDown className="size-3.5" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>这次不行，说一句哪里不行 —— 它会变成写作记忆</Tooltip.Content>
        </Tooltip>
        {rating === -1 && <span className="text-[10px] opacity-55">写一句哪里不对，之后就不会再犯</span>}
      </div>
      {rating === -1 && (
        <div className="mt-1.5 space-y-1.5">
          <TextArea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：不要用「空气仿佛凝固」这类套话；对话太解释性了"
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="primary" isDisabled={!note.trim()} onPress={() => void submit(-1, note)}>
              记下这条意见
            </Button>
            <Button size="sm" variant="ghost" onPress={() => void submit(-1)}>
              跳过，只标记
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed opacity-45">
            这句话会成为一条「经验教训」，进入之后每一次生成的 system prompt。
          </p>
        </div>
      )}
    </div>
  );
}
