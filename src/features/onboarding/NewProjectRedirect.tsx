import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/app/store";

/**
 * 旧路由 /new：打开新建弹窗后回首页。
 * 兼容仍指向 /new 的书签与验证脚本 —— 真正的表单在全局 NewProjectDialog 里。
 */
export function NewProjectRedirect() {
  const navigate = useNavigate();
  const setOpen = useAppStore((s) => s.setNewProjectOpen);

  useEffect(() => {
    setOpen(true);
    navigate("/", { replace: true });
  }, [setOpen, navigate]);

  return null;
}
