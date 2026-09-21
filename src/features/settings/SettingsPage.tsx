import { useNavigate } from "react-router-dom";
import { Button } from "@heroui/react";
import { ArrowLeft, Construction } from "lucide-react";
import { ROUTES } from "@/app/routes";

/** 设置页占位：真实实现见 features/settings（模型、AI、编辑器、数据） */
export function SettingsPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm opacity-60 transition hover:opacity-100"
      >
        <ArrowLeft className="size-4" />
        返回
      </button>
      <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
        <Construction className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="text-sm leading-relaxed opacity-80">
          设置页正在完善中。稍后会包含：模型供应商与 API Key、任务级模型路由、编辑器偏好、隐私开关、数据备份。
        </p>
      </div>
      <Button className="mt-6" variant="ghost" onPress={() => navigate(ROUTES.home)}>
        回到书库
      </Button>
    </div>
  );
}
