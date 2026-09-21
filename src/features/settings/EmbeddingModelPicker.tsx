import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Check, Download, HardDriveDownload, RefreshCw, TriangleAlert, X } from "lucide-react";
import {
  EMBEDDING_MODELS, findModel, formatBytes, ollamaOrigin, probeOllama, pullOllamaModel,
  type OllamaStatus, type PullProgress,
} from "@/ai/embedding-models";
import { probeEmbedding } from "@/ai/embedding";
import { useAppStore } from "@/app/store";

/**
 * 向量模型选择与下载。
 *
 * 设计出发点：embedding 对作者是陌生概念，绝不能只给一个"手填模型名"的输入框 ——
 * 那样选错模型的代价（中文效果差、召回不准）会落在完全不知情的人身上。
 * 所以这里是"清单 + 已装状态 + 一键下载 + 实测"。
 */
export function EmbeddingModelPicker({
  endpoint,
  model,
  onPick,
  disabled,
}: {
  endpoint: string;
  model: string;
  onPick: (name: string) => void;
  disabled?: boolean;
}) {
  const notify = useAppStore((s) => s.notify);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [testing, setTesting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const origin = ollamaOrigin(endpoint);

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await probeOllama(endpoint));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  const installedSet = useMemo(() => new Set((status?.installed ?? []).map((n) => n.replace(/:latest$/, ""))), [status]);
  const currentInfo = findModel(model);

  const startPull = async (name: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPulling(name);
    setProgress({ status: "准备中", done: false });
    const res = await pullOllamaModel(endpoint, name, (p) => setProgress(p), ctrl.signal);
    setPulling(null);
    if (res.ok) {
      setProgress(null);
      notify("success", "模型已下载", name + " 现在可以直接用于语义召回");
      await check();
      onPick(name);
    } else {
      setProgress(null);
      notify(res.error === "已取消" ? "info" : "danger", res.error === "已取消" ? "已取消下载" : "下载失败", res.error);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await probeEmbedding();
      if (res.ok) notify("success", "向量服务可用", "维度 " + res.dim + "，语义召回可以正常工作");
      else notify("danger", "向量服务不可用", res.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] opacity-60">向量模型</span>
        {status?.reachable ? (
          <Chip size="sm" color="success">
            Ollama 已连接 · {status.installed.length} 个模型
          </Chip>
        ) : (
          <Chip size="sm" color="warning">
            {status ? "未连接 Ollama" : "检测中"}
          </Chip>
        )}
        <Button size="sm" variant="ghost" isPending={checking} isDisabled={disabled} onPress={() => void check()}>
          <RefreshCw className="size-3.5" />
          重新检测
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isPending={testing}
          isDisabled={disabled || !model.trim()}
          onPress={() => void test()}
        >
          实测这条模型
        </Button>
        {pulling && (
          <Button size="sm" variant="outline" onPress={() => abortRef.current?.abort()}>
            <X className="size-3.5" />
            取消下载
          </Button>
        )}
      </div>

      {status && !status.reachable && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-3" />
            连不上 Ollama
          </p>
          <p className="mt-1 text-[11px] leading-relaxed opacity-75">{status.message}</p>
          <div className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed opacity-70">
            <p>① 安装 Ollama：<span className="rounded bg-black/[0.06] px-1 font-mono dark:bg-white/10">brew install ollama</span>（macOS）</p>
            <p>② 启动：<span className="rounded bg-black/[0.06] px-1 font-mono dark:bg-white/10">ollama serve</span></p>
            <p>
              ③ 允许浏览器访问（**必须做，否则会一直静默降级**）：<br />
              <span className="rounded bg-black/[0.06] px-1 font-mono dark:bg-white/10">
                OLLAMA_ORIGINS=* ollama serve
              </span>
            </p>
          </div>
          <p className="mt-1.5 text-[11px] opacity-60">
            也可以不装 Ollama，改用「OpenAI 兼容的供应商」——只要它有 /embeddings 接口。
          </p>
        </div>
      )}

      {pulling && progress && (
        <div className="rounded-lg border border-black/20 bg-black/[0.04] px-3 py-2">
          <div className="flex items-center gap-2 text-[11px]">
            <HardDriveDownload className="size-3.5" />
            <span className="font-medium">正在下载 {pulling}</span>
            {progress.percent !== undefined && <span className="tabular opacity-70">{progress.percent}%</span>}
            {progress.completed !== undefined && (
              <span className="tabular opacity-55">
                {formatBytes(progress.completed)} / {formatBytes(progress.total)}
              </span>
            )}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/10">
            <div
              className="h-full rounded-full bg-neutral-900 transition-all"
              style={{ width: (progress.percent ?? 15) + "%" }}
            />
          </div>
          <p className="mt-1 truncate text-[11px] opacity-55">{progress.status || "连接中…"}</p>
        </div>
      )}

      <div className="space-y-1">
        {EMBEDDING_MODELS.map((m) => {
          const installed = installedSet.has(m.name) || installedSet.has(m.name.replace(/:latest$/, ""));
          const active = model === m.name;
          return (
            <div
              key={m.name}
              className={
                "flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 " +
                (active ? "border-black/30 bg-black/[0.04]" : "border-black/8 dark:border-white/10")
              }
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(m.name)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium">{m.label}</span>
                  {m.recommended && (
                    <Chip size="sm" color="accent">
                      推荐
                    </Chip>
                  )}
                  <Chip size="sm" color={m.chinese === "优秀" ? "success" : m.chinese === "良好" ? "default" : "warning"}>
                    中文 {m.chinese}
                  </Chip>
                  <span className="text-[10px] opacity-50">
                    {m.params} · {m.size} · {m.dim} 维
                  </span>
                  {installed && (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                      <Check className="size-3" />
                      已安装
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed opacity-60">{m.note}</span>
              </button>

              <div className="flex shrink-0 items-center gap-1.5">
                {active && (
                  <Chip size="sm" color="accent">
                    使用中
                  </Chip>
                )}
                {installed ? (
                  !active && (
                    <Button size="sm" variant="outline" isDisabled={disabled} onPress={() => onPick(m.name)}>
                      用它
                    </Button>
                  )
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    isDisabled={disabled || !status?.reachable || pulling !== null}
                    isPending={pulling === m.name}
                    onPress={() => void startPull(m.name)}
                  >
                    <Download className="size-3.5" />
                    下载
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-[11px] opacity-60">当前使用</span>
        <input
          value={model}
          onChange={(e) => onPick(e.target.value)}
          placeholder="也可以直接填模型名，例如 my-custom-embed"
          className="min-w-56 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 font-mono text-xs dark:border-white/15"
        />
        {currentInfo ? (
          <span className="text-[11px] opacity-55">
            {currentInfo.dim} 维 · 中文 {currentInfo.chinese}
          </span>
        ) : model.trim() ? (
          <span className="text-[11px] opacity-55">清单外的模型，维度未知（不影响使用）</span>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed opacity-50">
        这些都是开源免费的模型，下载后完全离线运行，不需要 API Key，也不会上传你的稿子。
        下载体积较大，建议选好一个就长期用；换模型会让已有向量全部失效并重算。
      </p>
    </div>
  );
}
