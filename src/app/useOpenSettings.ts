import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES, type SettingsSection } from "./routes";

/**
 * 统一的「打开设置」入口。
 *
 * 背景：早期版本把设置做成全局弹层，各处调用 `setSettingsOpen(true)`；
 * 后来设置改成独立页面（`/settings`），但这些调用点没跟着改，导致点击无反应。
 * 现在统一走导航，并支持直接跳到某个分区。
 */
export function useOpenSettings() {
  const navigate = useNavigate();
  return useCallback(
    (section?: SettingsSection) => {
      navigate(section ? ROUTES.settingsSection(section) : ROUTES.settings);
    },
    [navigate],
  );
}
