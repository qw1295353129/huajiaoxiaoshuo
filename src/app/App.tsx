import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Spinner } from "@heroui/react";
import { useAppStore, watchSystemTheme } from "./store";
import { db } from "@/db/database";
import { seedProviders, seedRouting } from "@/db/repo/settings";
import { AppLayout } from "@/components/layout/AppLayout";
import { Notice } from "@/components/common/Notice";
import { Welcome } from "@/features/onboarding/Welcome";
import { NewProject } from "@/features/onboarding/NewProject";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { EditorPage } from "@/features/editor/EditorPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { NotFound } from "@/features/common/NotFound";

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
  const bootstrap = useAppStore((s) => s.bootstrap);

  useEffect(() => {
    void (async () => {
      await seedProviders();
      await seedRouting();
      await bootstrap();
    })();
    return watchSystemTheme();
  }, [bootstrap]);

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center gap-3">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm opacity-60">正在打开本地书库…</p>
        </div>
      </div>
    );
  }

  return (
    <>
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
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Notice />
    </>
  );
}
