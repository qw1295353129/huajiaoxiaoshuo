/*
 * 花椒写作平台 — Service Worker
 *
 * 设计原则：
 *   数据全部在 IndexedDB，SW 不缓存业务数据。SW 的存在只是为了
 *   1) 让应用可以"安装"（PWA 安装性是 navigator.storage.persist()
 *      自动通过的前提）
 *   2) 离线时仍能打开壳（navigate 请求 → /index.html）
 *
 * 显式不缓存：
 *   - 任何业务接口（没有此类接口）
 *   - Vite 产物 hash（每次构建都会变，缓存会脏）
 *   - IndexedDB / Dexie 的存储完全不受 SW 控制
 */

const VERSION = "huajiao-sw-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // 只接管页面导航：网络优先，失败回落 /index.html（保证深链 + 离线启动壳）
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        fetch("/index.html", { headers: { "X-SW-Fallback": "1" } }),
      ),
    );
    return;
  }

  // 其它静态资源：完全透传到网络。SW 不背数据，IndexedDB 才是数据源。
});