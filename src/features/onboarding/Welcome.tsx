import { useNavigate } from "react-router-dom";
import { Button, Card } from "@heroui/react";
import { BookOpenCheck, HardDrive, Plus, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { ROUTES } from "@/app/routes";
import { useProjects } from "@/app/hooks";
import { useAppStore } from "@/app/store";

/** 首次进入的落地页：强调本地私有 + 两个入口 */
export function Welcome() {
  const navigate = useNavigate();
  const projects = useProjects();
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen);
  const hasProjects = (projects?.length ?? 0) > 0;

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16">
        <div className="mb-10">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-1 text-xs opacity-70 dark:bg-white/10">
            <ShieldCheck className="size-3.5" />
            全部数据存放在你自己的浏览器里
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">花椒写作平台</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed opacity-70">
            为长篇小说而做的 AI 创作工作台。人物、世界观、伏笔、时间线都是可被 AI 读取的结构化资产，
            每次生成都会带上正确的上下文，因此它不会写崩你的设定。
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-black/[0.06] text-neutral-700">
              <Wand2 className="size-4.5" />
            </div>
            <h2 className="font-medium">一句话成书</h2>
            <p className="mt-1.5 text-sm leading-relaxed opacity-65">
              给一句灵感，自动产出书名、高概念、人物、世界观、分卷结构与章节大纲，并写成你的项目。
            </p>
            <Button className="mt-4" variant="primary" fullWidth onPress={() => setNewProjectOpen(true)}>
              <Plus className="size-4" />
              创建新作品
            </Button>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <BookOpenCheck className="size-4.5" />
            </div>
            <h2 className="font-medium">{hasProjects ? "继续写作" : "导入已有稿件"}</h2>
            <p className="mt-1.5 text-sm leading-relaxed opacity-65">
              {hasProjects
                ? "打开最近的书继续写。所有改动都会即时保存到本地。"
                : "已有作品？先建一个项目，再把稿件整篇粘进来，系统会自动切分章节并建立设定库。"}
            </p>
            <Button
              className="mt-4"
              variant="outline"
              fullWidth
              onPress={() => {
                if (hasProjects) navigate(ROUTES.home);
                else setNewProjectOpen(true);
              }}
            >
              {hasProjects ? "查看我的作品" : "开始创建"}
            </Button>
          </Card>
        </div>

        <div className="mt-8 grid gap-3 text-xs opacity-60 sm:grid-cols-3">
          <div className="flex items-start gap-2">
            <HardDrive className="mt-0.5 size-3.5 shrink-0" />
            <span>数据存在 IndexedDB，可随时导出为 JSON 备份</span>
          </div>
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
            <span>支持 DeepSeek / OpenAI / Kimi / 智谱 / 本地 Ollama</span>
          </div>
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            <span>可一键禁止云端模型，只用本地模型写作</span>
          </div>
        </div>
      </div>
    </div>
  );
}
