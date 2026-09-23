import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Spinner } from "@heroui/react";
import { useAppStore, watchSystemTheme } from "./store";
import { db } from "@/db/database";
import { seedProviders, seedRouting } from "@/db/repo/settings";
import { AppLayout } from "@/components/layout/AppLayout";
import { Notice } from "@/components/common/Notice";
import { GlobalHotkeys } from "@/components/layout/GlobalHotkeys";
import { CommandPalette } from "@/components/common/CommandPalette";
import { Welcome } from "@/features/onboarding/Welcome";
import { NewProject } from "@/features/onboarding/NewProject";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { EditorPage } from "@/features/editor/EditorPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { NotFound } from "@/features/common/NotFound";
import { OutlinePage } from "@/features/outline/OutlinePage";
import { CharactersPage } from "@/features/characters/CharactersPage";
import { WorldPage } from "@/features/world/WorldPage";
import { ThreadsPage } from "@/features/threads/ThreadsPage";
import { TimelinePage } from "@/features/timeline/TimelinePage";
import { GraphPage } from "@/features/graph/GraphPage";
import { InsightsPage } from "@/features/insights/InsightsPage";
import { ConsistencyPage } from "@/features/consistency/ConsistencyPage";
import { AiStudioPage } from "@/features/ai/AiStudioPage";
import { GenesisPage } from "@/features/genesis/GenesisPage";
import { BlueprintPage } from "@/features/blueprint/BlueprintPage";
import { UsagePage } from "@/features/usage/UsagePage";
import { DataPage } from "@/features/data/DataPage";
import { ReviewPage } from "@/features/review/ReviewPage";

function ProjectGuard({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const setProject = useAppStore((s) => s.setProject);
  const project = useAppStore((s) => s.project);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    if (!projectId) return;
    if (project?.id === projectId) return;
    db.projects.get(projectId).then((p) => {
      if (!alive) return;
      if (p) void setProject(p);
      else navigate("/", { replace: true });
    });
    return () => {
      alive = false;
    };
  }, [projectId, project?.id, setProject, navigate]);

  if (!projectId) return <Navigate to="/" replace />;
  if (project?.id !== projectId) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const initError = useAppStore((s) => s.initError);
  const bootstrap = useAppStore((s) => s.bootstrap);

  useEffect(() => {
    void (async () => {
      // seed 失败也必须继续 bootstrap，否则永远停在加载页
      try {
        await seedProviders();
        await seedRouting();
      } catch (e) {
        console.error("seed failed:", e);
      }
      await bootstrap();
    })();
    return watchSystemTheme();
  }, [bootstrap]);

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center gap-3">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm opacity-60">正在打开我的作品…</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="grid min-h-dvh place-items-center gap-3 p-6">
        <div className="w-full max-w-md rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-5">
          <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">我的作品打开失败</p>
          <p className="mt-2 text-xs leading-relaxed opacity-75">{initError}</p>
          <p className="mt-3 text-[11px] opacity-55">
            请刷新页面重试；若持续失败，可能是浏览器存储被禁用或数据损坏。
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <GlobalHotkeys />
      <CommandPalette />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/new" element={<NewProject />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/p/:projectId/*"
          element={
            <ProjectGuard>
              <AppLayout />
            </ProjectGuard>
          }
        >
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<Dashboard />} />
          <Route path="write" element={<EditorPage />} />
          <Route path="write/:chapterId" element={<EditorPage />} />
          <Route path="outline" element={<OutlinePage />} />
          <Route path="characters" element={<CharactersPage />} />
          <Route path="characters/:characterId" element={<CharactersPage />} />
          <Route path="world" element={<WorldPage />} />
          <Route path="threads" element={<ThreadsPage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="consistency" element={<ConsistencyPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="ai" element={<AiStudioPage />} />
          <Route path="genesis" element={<GenesisPage />} />
          <Route path="blueprint" element={<BlueprintPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="data" element={<DataPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Notice />
    </>
  );
}
