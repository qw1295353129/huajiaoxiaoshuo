/**
 * 注册 Service Worker。
 *
 * - 仅在浏览器支持 + 安全上下文（https 或 localhost）下注册
 * - 静默失败：SW 是为了满足 PWA 安装性，业务数据全在 IndexedDB
 *   与 SW 无关；SW 注册失败不应阻塞应用
 * - 支持 `?nosw` 关闭，便于排查
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const url = new URL(window.location.href);
  if (url.searchParams.has("nosw")) return;

  // window.isSecureContext 涵盖 https + localhost
  if (!window.isSecureContext) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        // 不抛、不弹：SW 失败不影响主流程
        console.warn("[huajiao] SW register failed:", err);
      });
  });
}