import { useEffect, useState } from "react";
import { Button, Chip, Input, Label, TextField } from "@heroui/react";
import { Cable, RefreshCw, Terminal } from "lucide-react";
import { DEFAULT_PROXY_BASE, detectProxy, getProxyBase, setProxyBase } from "@/ai/proxy";
import { useAppStore } from "@/app/store";

/**
 * 本地代理状态卡。
 *
 * 为什么需要它：智谱、通义、硅基流动等服务不返回 CORS 头，浏览器直连会被拦。
 * 我们提供了一个只跑在本机的转发服务（npm run proxy），这里用来检测它是否在运行、
 * 以及改端口。之前错误提示让用户"开启本地代理"，但既没有开关也没有服务 —— 这张卡补上。
 */
export function ProxyCard({ compact = false }: { compact?: boolean }) {
  const notify = useAppStore((s) => s.notify);
  const [base, setBase] = useState(getProxyBase());
  const [status, setStatus] = useState<{ available: boolean; message?: string; ms?: number } | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async (force = true) => {
    setChecking(true);
    try {
      const res = await detectProxy(force);
      setStatus({ available: res.available, message: res.message, ms: res.ms });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Cable className="size-4 opacity-60" />
            本地代理
          </h2>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed opacity-60">
            有些模型服务不返回跨域响应头，浏览器直连会被拦下。启动本地代理后，这类服务的请求会经由
            <span className="mx-0.5 rounded bg-black/[0.06] px-1 font-mono text-[11px] dark:bg-white/10">127.0.0.1</span>
            转发 —— 数据只经过你自己的机器，API Key 不写盘、不外传。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status?.available ? (
            <Chip size="sm" color="success">
              已就绪{status.ms !== undefined ? " · " + status.ms + "ms" : ""}
            </Chip>
          ) : (
            <Chip size="sm" color={status ? "warning" : "default"}>
              {status ? "未检测到" : "检测中"}
            </Chip>
          )}
          <Button size="sm" variant="outline" isPending={checking} onPress={() => void check(true)}>
            <RefreshCw className="size-3.5" />
            检测本地代理
          </Button>
        </div>
      </div>

      {!compact && (
        <>
          <div className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/[0.05]">
            <p className="flex items-center gap-1.5 text-[11px] font-medium">
              <Terminal className="size-3" />
              怎么启动
            </p>
            <p className="mt-1 text-[11px] leading-relaxed opacity-70">
              在项目目录执行{" "}
              <code className="rounded bg-black/[0.07] px-1 font-mono dark:bg-white/10">npm run proxy</code>
              ，然后回来点「检测本地代理」。启动后所有标记了「需要代理」的服务都会自动走它。
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <TextField
              value={base}
              onChange={(v) => {
                setBase(v);
                setProxyBase(v || DEFAULT_PROXY_BASE);
              }}
            >
              <Label>代理地址</Label>
              <Input placeholder={DEFAULT_PROXY_BASE} />
            </TextField>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                setProxyBase(DEFAULT_PROXY_BASE);
                setBase(DEFAULT_PROXY_BASE);
                void check(true);
                notify("info", "已恢复默认代理地址");
              }}
            >
              恢复默认
            </Button>
          </div>

          {status && !status.available && (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
              {status.message}
              {status.message?.includes("没有检测到")
                ? " —— 如果还没启动，请在终端执行 npm run proxy。不改用代理也可以：DeepSeek、OpenRouter、Ollama、LM Studio 都支持浏览器直连。"
                : ""}
            </p>
          )}
        </>
      )}
    </section>
  );
}
