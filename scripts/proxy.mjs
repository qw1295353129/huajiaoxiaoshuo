/**
 * 本地代理：给不支持浏览器跨域（CORS）的模型服务做转发。
 *
 * 为什么需要它：有些模型服务（智谱、通义、硅基流动等）不返回 Access-Control-Allow-Origin，
 * 浏览器会直接拦掉请求。这个代理跑在你自己的机器上，只做一件事：把请求原样转发出去，
 * 再把带 CORS 头的响应返回给页面。
 *
 * 数据流向：浏览器 → 本机 127.0.0.1 → 模型服务。API Key 只在本机内存里过一遍，不写盘、不外传。
 *
 * 用法：npm run proxy        （默认 8788 端口）
 *      npm run proxy -- 9000
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? process.env.HUAJIAO_PROXY_PORT ?? 8788);
const HOST = "127.0.0.1";
const MAX_BODY = 32 * 1024 * 1024; // 32MB，够长上下文请求

/** 只允许转发到这些协议与主机，避免被当成通用 SSRF 跳板 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
/** 本地模型的地址也允许（Ollama / LM Studio 有时也需要转发） */
function isAllowedTarget(url) {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
  // 禁止把内网管理端口当跳板；本机模型服务允许
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    // 只放行常见的模型服务端口，避免误用到其它本地服务
    return [11434, 1234, 8000, 8080, 5000, PORT].includes(port);
  }
  return true;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
  // 自定义响应头默认不对 JS 暴露，必须显式声明，否则前端读不到转发耗时
  "Access-Control-Expose-Headers": "X-Huajiao-Proxy-Ms, Content-Type",
};

function send(res, status, body, extra = {}) {
  res.writeHead(status, { ...CORS_HEADERS, ...extra });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  // 预检请求：直接放行，不再往上游发
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  const reqUrl = new URL(req.url ?? "/", "http://" + HOST + ":" + PORT);

  // 健康检查，供应用自动探测
  if (reqUrl.pathname === "/health") {
    send(res, 200, JSON.stringify({ ok: true, service: "huajiao-proxy", version: 1 }), { "Content-Type": "application/json" });
    return;
  }

  if (reqUrl.pathname !== "/proxy") {
    send(res, 404, JSON.stringify({ error: "只支持 /proxy?url=<encoded> 与 /health" }), { "Content-Type": "application/json" });
    return;
  }

  const target = reqUrl.searchParams.get("url");
  if (!target) {
    send(res, 400, JSON.stringify({ error: "缺少 url 参数" }), { "Content-Type": "application/json" });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    send(res, 400, JSON.stringify({ error: "url 参数不是合法地址" }), { "Content-Type": "application/json" });
    return;
  }
  if (!isAllowedTarget(targetUrl)) {
    send(res, 403, JSON.stringify({ error: "该目标地址不被允许转发" }), { "Content-Type": "application/json" });
    return;
  }

  const started = Date.now();
  try {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (["host", "origin", "referer", "connection", "content-length", "accept-encoding"].includes(k)) continue;
      if (typeof v === "string") headers[k] = v;
    }

    const upstream = await fetch(targetUrl, { method: req.method, headers, body });
    const text = await upstream.text();
    const ms = Date.now() - started;

    // 在响应头里回传耗时，方便前端显示
    send(res, upstream.status, text, {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "X-Huajiao-Proxy-Ms": String(ms),
    });

    const label = req.method + " " + targetUrl.host + targetUrl.pathname;
    const flag = upstream.ok ? "OK " : "ERR";
    console.log("[" + new Date().toLocaleTimeString("zh-CN") + "] " + flag + " " + upstream.status + "  " + ms + "ms  " + label);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[" + new Date().toLocaleTimeString("zh-CN") + "] FAIL  " + req.method + " " + targetUrl.host + "  " + msg);
    send(res, 502, JSON.stringify({ error: "代理转发失败：" + msg }), { "Content-Type": "application/json" });
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  花椒本地代理已启动");
  console.log("  地址：http://" + HOST + ":" + PORT);
  console.log("  健康检查：http://" + HOST + ":" + PORT + "/health");
  console.log("");
  console.log("  用途：给不支持浏览器跨域（CORS）的模型服务做转发。");
  console.log("  数据只经过本机，API Key 不写盘、不外传。");
  console.log("");
  console.log("  在「设置 → 模型与 AI」里点「检测本地代理」即可让应用开始使用它。");
  console.log("  按 Ctrl+C 停止。");
  console.log("");
});

process.on("SIGINT", () => {
  console.log("");
  console.log("  代理已停止。");
  process.exit(0);
});