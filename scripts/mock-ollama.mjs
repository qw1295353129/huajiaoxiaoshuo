/**
 * 假的 Ollama 服务，用于测试向量模型的选择与下载。
 *
 * 为什么要它：真实下载一个 1.2GB 的模型不可能进回归测试，
 * 而没有 /api/pull 的流式进度，"下载"这条路就完全测不到。
 * 这里把三个端点都实现成 Ollama 的样子（包括 NDJSON 流式进度）。
 *
 * 用法：node scripts/mock-ollama.mjs [port]   默认 11499
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 11499);
const NL = String.fromCharCode(10);

/** 已"安装"的模型，pull 成功后会加进来 */
const installed = ["nomic-embed-text:latest"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Private-Network": "true",
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** 造一个确定性的假向量：按字符二元组散列，同文本必得同向量 */
function fakeVector(text, dim = 768) {
  const v = new Array(dim).fill(0);
  const s = String(text);
  for (let i = 0; i < s.length - 1; i++) {
    const bigram = s.slice(i, i + 2);
    let h = 0;
    for (const ch of bigram) h = (h * 31 + ch.codePointAt(0)) % 1000003;
    v[h % dim] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1:" + PORT);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (url.pathname === "/api/tags") {
    json(res, 200, { models: installed.map((name) => ({ name, model: name, size: 274_000_000 })) });
    return;
  }

  if (url.pathname === "/api/pull") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let model = "unknown";
    try { model = JSON.parse(Buffer.concat(chunks).toString("utf8")).model ?? model; } catch { /* 用默认值 */ }

    res.writeHead(200, { ...CORS, "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
    // 按 Ollama 的真实格式推进度：先 pulling manifest，再逐层下载
    const total = 40_000_000;
    const steps = 6;
    const send = (obj) => res.write(JSON.stringify(obj) + NL);
    send({ status: "pulling manifest" });
    for (let i = 1; i <= steps; i++) {
      send({ status: "pulling " + model, completed: Math.round((total * i) / steps), total });
      await new Promise((r2) => setTimeout(r2, 250));
    }
    send({ status: "verifying sha256 digest" });
    send({ status: "writing manifest" });
    send({ status: "success" });
    res.end();
    if (!installed.includes(model)) installed.push(model);
    console.log("[" + new Date().toLocaleTimeString("zh-CN") + "] pulled " + model);
    return;
  }

  if (url.pathname === "/api/embeddings" || url.pathname === "/api/embed") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* 空请求 */ }
    const single = body.prompt ?? (Array.isArray(body.input) ? body.input[0] : body.input) ?? "";
    if (url.pathname === "/api/embed") {
      json(res, 200, { embeddings: [fakeVector(single, 1024)], model: body.model });
    } else {
      json(res, 200, { embedding: fakeVector(single, 768) });
    }
    return;
  }

  json(res, 404, { error: "mock-ollama 只实现了 /api/tags /api/pull /api/embeddings /api/embed" });
}).listen(PORT, "127.0.0.1", () => {
  console.log("  假 Ollama 已启动 http://127.0.0.1:" + PORT);
  console.log("  已装模型：" + installed.join(", "));
});
