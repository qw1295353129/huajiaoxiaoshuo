import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Chip, Tooltip } from "@heroui/react";
import { BookOpen, Plus, Settings, Trash2 } from "lucide-react";
import { useOpenSettings } from "@/app/useOpenSettings";
import { ROUTES } from "@/app/routes";
import { useProjects } from "@/app/hooks";
import { deleteProject } from "@/db/repo/projects";
import { useAppStore } from "@/app/store";
import { formatRelative, formatWords, pct } from "@/utils/format";
import { ProjectOverview } from "./ProjectOverview";
import { PageScaffold } from "@/components/common/PageScaffold";

const STATUS_LABEL: Record<string, string> = {
  planning: "筹备中",
  drafting: "连载中",
  revising: "修订中",
  completed: "已完结",
  archived: "已归档",
};

/** 我的作品首页：项目列表（未进入具体项目时）/ 项目总览（有 projectId 时） */
export function Dashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects = useProjects();
  const navigate = useNavigate();
  const setProject = useAppStore((s) => s.setProject);
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen);
  const openSettings = useOpenSettings();

  if (projectId) return <ProjectOverviewRoute projectId={projectId} />;

  const list = projects ?? [];
  // 外层 LibraryShell 提供侧栏 + overflow-hidden；本层自己滚动
  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">我的作品</h1>
            <p className="mt-1 text-sm opacity-60">{list.length} 部作品 · 全部保存在本机</p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  variant="ghost"
                  aria-label="设置"
                  onPress={() => openSettings()}
                >
                  <Settings className="size-4" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>设置（⌘,）</Tooltip.Content>
            </Tooltip>
            <Button variant="primary" onPress={() => setNewProjectOpen(true)}>
              <Plus className="size-4" />
              新建作品
            </Button>
          </div>
        </div>

        {list.length === 0 ? (
          <Card className="p-10 text-center">
            <BookOpen className="mx-auto mb-4 size-9 opacity-25" />
            <p className="font-medium">还没有作品</p>
            <p className="mx-auto mt-2 max-w-sm text-sm opacity-60">
              创建第一部作品，写一句灵感，让 AI 帮你把人物、世界观和分卷结构搭起来。
            </p>
            <Button className="mx-auto mt-5" variant="primary" onPress={() => setNewProjectOpen(true)}>
              <Plus className="size-4" />
              创建第一部作品
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <Card
                key={p.id}
                role="button"
                tabIndex={0}
                className="group cursor-pointer p-5 transition hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => {
                  void setProject(p);
                  navigate(ROUTES.overview(p.id));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void setProject(p);
                    navigate(ROUTES.overview(p.id));
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 flex-1 truncate font-medium">{p.title}</h2>
                  <button
                    type="button"
                    aria-label="删除作品"
                    className="opacity-0 transition group-hover:opacity-50 hover:!opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`删除《${p.title}》？此操作不可撤销，所有章节与设定都会一起删除。`)) {
                        void deleteProject(p.id);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {p.logline && <p className="mt-2 line-clamp-2 text-xs leading-relaxed opacity-60">{p.logline}</p>}
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.genres.map((g) => (
                    <Chip key={g} size="sm">
                      {g}
                    </Chip>
                  ))}
                  <Chip size="sm" color="default">
                    {STATUS_LABEL[p.status] ?? p.status}
                  </Chip>
                </div>
                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="tabular font-medium">{formatWords(p.stats.words)}</span>
                    <span className="opacity-50">{pct(p.stats.words, p.targetWords).toFixed(1)}%</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-neutral-900 transition-all"
                      style={{ width: `${pct(p.stats.words, p.targetWords)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] opacity-45">
                    {p.stats.chapters} 章 · 更新于 {formatRelative(p.updatedAt)}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectOverviewRoute({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const list = useProjects() ?? [];
  const project = list.find((p) => p.id === projectId);

  if (!project) {
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center">
          <p className="text-sm opacity-60">找不到这本书</p>
          <Button className="mt-3" variant="outline" size="sm" onPress={() => navigate(ROUTES.home)}>
            回到我的作品
          </Button>
        </div>
      </div>
    );
  }
  // 用统一脚手架：它有左侧项目导航与滚动内容区。
  // 之前这里只有一层滚动容器，所以总览页没有侧边栏（只能靠浏览器后退离开）。
  return (
    <PageScaffold
      title={project.title}
      description="全书进度、近期节奏与接下来该做什么"
      withNav
    >
      <ProjectOverview project={project} />
    </PageScaffold>
  );
}
