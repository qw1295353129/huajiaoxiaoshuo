/** 验证本地代理：SSRF/Origin 防护、检测、经代理发起真实请求、错误路径。 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const PROXY = "http://127.0.0.1:8788";

/**
 * SSRF / Origin 防护：不依赖 DEEPSEEK_KEY，必须先跑。
 * 代理未启动时明确失败，而不是静默跳过。
 */
async function checkProxySecurity() {
  let sPass = 0, sFail = 0;
  const check = (n, c, x) => {
    if (c) { sPass++; console.log("  ✓ " + n); }
    else { sFail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); }
  };

  console.log("【代理 SSRF / Origin 防护】");
  let health;
  try {
    const res = await fetch(PROXY + "/health");
    health = res.ok;
  } catch {
    health = false;
  }
  check("代理已在 8788 启动（先 npm run proxy）", health === true, "连接失败");
  if (!health) return false;

  const evil = await fetch(PROXY + "/proxy?url=" + encodeURIComponent("https://api.deepseek.com/v1/models"), {
    headers: { Origin: "https://evil.example" },
  });
  const evilBody = await evil.text().catch(() => "");
  check("拒绝跨站 Origin", evil.status === 403, "status=" + evil.status + " " + evilBody.slice(0, 80));

  const local = await fetch(PROXY + "/proxy?url=" + encodeURIComponent("https://api.deepseek.com/v1/models"), {
    headers: { Origin: "http://127.0.0.1:5178" },
  });
  check("放行本机应用 Origin（非 403）", local.status !== 403, "status=" + local.status);

  for (const [label, target] of [
    ["云元数据", "http://169.254.169.254/latest/meta-data/"],
    ["内网网关", "http://192.168.1.1/"],
    ["RFC1918 十段", "http://10.0.0.1/"],
    ["本机非模型端口", "http://127.0.0.1:22/"],
  ]) {
    const res = await fetch(PROXY + "/proxy?url=" + encodeURIComponent(target), {
      headers: { Origin: "http://127.0.0.1:5178" },
    });
    const body = await res.text().catch(() => "");
    check("拒绝 " + label, res.status === 403, "status=" + res.status + " " + body.slice(0, 80));
  }

  console.log("  安全用例 " + sPass + " 通过 / " + sFail + " 失败");
  return sFail === 0;
}

const securityOk = await checkProxySecurity();

// 真实请求那一段需要 Key；没有就明确跳过，而不是把"空回复"当成失败（曾因此误判 2 项）
const KEY = process.env.DEEPSEEK_KEY;
if (!KEY) {
  console.log("缺少 DEEPSEEK_KEY 环境变量 —— 跳过需要真实模型的用例。");
  console.log("用法：DEEPSEEK_KEY=sk-xxx node scripts/verify-proxy.mjs");
  process.exit(securityOk ? 0 : 1);
}
const context = await launchIsolated(import.meta.url);
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));
await gotoApp(page, "http://127.0.0.1:5178/");
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

console.log("【代理探测】");
const detect = await page.evaluate(async () => {
  const m = await import("/src/ai/proxy.ts");
  const st = await m.detectProxy(true);
  return st;
});
check("探测到本地代理", detect.available === true, JSON.stringify(detect));
check("返回健康检查信息", detect.message === "本地代理已就绪", String(detect.message));

console.log("【经代理发起真实请求】");
const viaProxy = await page.evaluate(async (key) => {
  const { resolveEndpoint } = await import("/src/ai/providers.ts");
  const { getProxyBase, wrapWithProxy } = await import("/src/ai/proxy.ts");
  // 故意把 corsBlocked 设为 true，强制走代理路径
  const provider = { id: "p", name: "DeepSeek", kind: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: key, models: [], enabled: true, corsBlocked: true, createdAt: "", updatedAt: "" };
  const raw = resolveEndpoint(provider, "/chat/completions", {});
  const ep = { url: wrapWithProxy(getProxyBase(), raw.url), headers: raw.headers, viaProxy: true };
  const started = performance.now();
  const res = await fetch(ep.url, {
    method: "POST",
    headers: ep.headers,
    // 注意：deepseek-flash 是推理模型，预算给小了正文会是空的（见 docs/GOTCHAS.md）
    body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "只回复两个字：代理" }], max_tokens: 800 }),
  });
  const body = await res.json().catch(() => ({}));
  const reasoning = body?.choices?.[0]?.message?.reasoning_content ?? "";
  return {
    url: ep.url.slice(0, 60) + "…",
    viaProxy: ep.viaProxy,
    ok: res.ok,
    status: res.status,
    proxyMs: res.headers.get("X-Huajiao-Proxy-Ms"),
    content: body?.choices?.[0]?.message?.content,
    reasoningLen: reasoning.length,
    finish: body?.choices?.[0]?.finish_reason,
    ms: Math.round(performance.now() - started),
  };
}, KEY);
check("请求确实走了代理", viaProxy.viaProxy === true, viaProxy.url);
check("代理转发成功（HTTP 200）", viaProxy.ok === true, "status=" + viaProxy.status);
check("拿到了模型回复", Boolean(viaProxy.content), JSON.stringify(viaProxy));
check("响应头带代理耗时", Boolean(viaProxy.proxyMs), String(viaProxy.proxyMs));
console.log("     回复内容: " + viaProxy.content + "  总耗时 " + viaProxy.ms + "ms  代理内 " + viaProxy.proxyMs + "ms");

console.log("【未启动代理时的行为】");
const noProxy = await page.evaluate(async () => {
  const m = await import("/src/ai/proxy.ts");
  m.setProxyBase("http://127.0.0.1:59999");
  const st = await m.detectProxy(true);
  const provider = { id: "p", name: "X", kind: "zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "k", models: [], enabled: true, corsBlocked: true, createdAt: "", updatedAt: "" };
  const useProxy = await m.shouldUseProxy(provider);
  m.setProxyBase("http://127.0.0.1:8788");
  return { available: st.available, message: st.message, useProxy };
});
check("探测不到代理时报告不可用", noProxy.available === false, JSON.stringify(noProxy));
check("探测不到时代理路径被跳过（改走直连）", noProxy.useProxy === false, JSON.stringify(noProxy));

console.log("【本地模型永不走代理】");
const local = await page.evaluate(async () => {
  const m = await import("/src/ai/proxy.ts");
  const ollama = { id: "o", name: "Ollama", kind: "ollama", baseUrl: "http://127.0.0.1:11434/v1", models: [], enabled: true, corsBlocked: true, createdAt: "", updatedAt: "" };
  return m.shouldUseProxy(ollama);
});
check("Ollama 即使标记 corsBlocked 也直连", local === false, String(local));

console.log("【设置页的代理卡片】");
await gotoApp(page, "http://127.0.0.1:5178/settings?tab=models", { settle: 2200 });
const settingsText = await page.evaluate(() => document.body.innerText);
check("设置页有本地代理卡片", settingsText.includes("本地代理"));
check("显示启动命令", settingsText.includes("npm run proxy"));
check("显示检测按钮", settingsText.includes("检测本地代理"));
check("状态显示为已就绪", settingsText.includes("已就绪"), settingsText.slice(settingsText.indexOf("本地代理"), settingsText.indexOf("本地代理") + 120));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(securityOk && fail === 0 ? 0 : 1);
