import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Chip, Input, Label, Switch, TextArea, TextField } from "@heroui/react";
import { ArrowLeft, Brain, Check, Eye, EyeOff, Gauge, KeyRound, Palette, Plus, RefreshCw, ShieldCheck, Trash2, UserRound, Zap } from "lucide-react";
import type { AiTaskKind, ProviderConfig, ProviderKind, TaskRouting } from "@/core";
import { useAppStore } from "@/app/store";
import { ROUTES } from "@/app/routes";
import { useAsync } from "@/app/hooks";
import { TASK_LABELS } from "@/db/defaults";
import {
  deleteProvider, getProvider, listProviders, listRouting, markProviderCheck, seedProviders, setProviderKey,
  updateRouting, upsertProvider,
} from "@/db/repo/settings";
import { isLocalProvider, probeProvider } from "@/ai/providers";
import { db } from "@/db/database";
import { databaseStats, isPersisted, requestPersistence, wipeDatabase } from "@/db/database";
import { estimateTokens } from "@/utils/tokens";
import { formatBytes } from "@/utils/format-bytes";
import { EditorPreferences } from "./EditorPreferences";
import { AuthorProfileSettings } from "./AuthorProfileSettings";
import { ChangelogPanel } from "./ChangelogPanel";
import { MemoryPanel } from "./MemoryPanel";
import { ProxyCard } from "./ProxyCard";
import { PricingPanel } from "./PricingPanel";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/app/routes";
import { APP_VERSION } from "@/core";

type Tab = SettingsSection | "memory";

const TABS: { key: Tab; label: string; icon: typeof Zap }[] = [
  { key: "profile", label: "创作者档案", icon: UserRound },
  { key: "memory", label: "写作记忆", icon: Brain },
  { key: "models", label: "模型与 AI", icon: Zap },
  { key: "routing", label: "任务路由", icon: Gauge },
  { key: "editor", label: "写作偏好", icon: Palette },
  { key: "privacy", label: "隐私", icon: ShieldCheck },
  { key: "data", label: "数据", icon: KeyRound },
  { key: "about", label: "关于", icon: Check },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(
    initial === "memory" || (initial && SETTINGS_SECTIONS.includes(initial as SettingsSection))
      ? (initial as Tab)
      : "profile",
  );

  // 支持从别处深链（例如 AI 面板点模型名 → /settings?tab=models）
  useEffect(() => {
    const t = searchParams.get("tab");
    if ((t === "memory" || (t && SETTINGS_SECTIONS.includes(t as SettingsSection))) && t !== tab) setTab(t as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const switchTab = (next: Tab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex h-dvh flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-black/5 px-5 py-3 dark:border-white/5">
        <Button isIconOnly size="sm" variant="ghost" onPress={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-48 shrink-0 flex-col gap-0.5 border-r border-black/5 p-3 md:flex dark:border-white/5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition " +
                (tab === t.key ? "bg-black/[0.06] font-medium dark:bg-white/10" : "opacity-65 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5")
              }
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-5 py-6">
            {tab === "profile" && <AuthorProfileSettings />}
            {tab === "memory" && <MemoryPanel />}
            {tab === "models" && <ModelsTab />}
            {tab === "routing" && <RoutingTab />}
            {tab === "editor" && <EditorPreferences />}
            {tab === "privacy" && <PrivacyTab />}
            {tab === "data" && <DataTab />}
            {tab === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== 模型与 AI ====================

/** 输入 API Key 后等待多久再自动拉取模型（毫秒），避免每敲一个字符就发请求 */
const AUTO_PROBE_DEBOUNCE_MS = 800;
/** 自动拉取要求的最小 Key 长度（本地供应商不需要鉴权，不受此限制） */
const AUTO_PROBE_MIN_KEY_LENGTH = 8;

/** 合并模型列表：去重、保留用户手填的、最多留 60 个；added 为本次新增的数量 */
function mergeModels(existing: string[], incoming: string[]): { models: string[]; added: number } {
  const models = Array.from(new Set([...existing, ...incoming])).slice(0, 60);
  return { models, added: models.filter((m) => !existing.includes(m)).length };
}

function ModelsTab() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const notify = useAppStore((s) => s.notify);
  const providersRes = useAsync(() => listProviders(), [], [] as ProviderConfig[]);
  const providers = providersRes.value;
  const reload = providersRes.reload;
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState<string | null>(null);
  /** 正在自动拉取模型的供应商（卡片上显示「正在获取模型…」） */
  const [autoProbing, setAutoProbing] = useState<Record<string, boolean>>({});
  /** Key 输入框的本地草稿：写库是异步的，先本地回显，避免连续输入/粘贴时丢字符 */
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});

  // ---------- 输入 API Key 后自动拉取模型列表 ----------
  /** 每个供应商的防抖定时器：停止输入 800ms 后才真正发请求 */
  const probeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** 每个供应商「上次成功拉取时用的 Key」，同一个 Key 不重复请求 */
  const probedKeys = useRef<Record<string, string>>({});
  /** 正在请求中的供应商，避免并发重复请求 */
  const probingNow = useRef<Set<string>>(new Set());
  /** 进入页面时已对本地供应商自动探测过的标记 */
  const entryProbed = useRef<Set<string>>(new Set());
  /** 组件是否还在页面上：卸载后不再回写状态、不再弹提示 */
  const aliveRef = useRef(true);

  /** 手动「测试连接」：保留原有行为，只把模型合并抽成公共函数 */
  const check = async (p: ProviderConfig) => {
    setChecking(p.id);
    try {
      const res = await probeProvider(p);
      await markProviderCheck(p.id, res.ok, res.message);
      if (res.ok) probedKeys.current[p.id] = (p.apiKey ?? "").trim();
      if (res.ok && res.models?.length) {
        await upsertProvider({ ...p, models: mergeModels(p.models, res.models).models });
      }
      notify(res.ok ? "success" : "danger", p.name + (res.ok ? " 连接正常" : " 连接失败"), res.message);
      reload();
    } finally {
      setChecking(null);
    }
  };

  /**
   * 自动拉取某个供应商的模型列表。
   * 触发条件：Key 长度 ≥ 8 且与上次成功拉取时用的 Key 不同。
   * 只有「本地供应商进页面自动探测」那一次允许没有 Key（它们不需要鉴权）。
   * 失败不弹提示打断输入，只把卡片状态标成失败，原因由卡片上的小字展示。
   */
  const runAutoProbe = async (providerId: string, opts: { allowShortKey?: boolean } = {}) => {
    if (probingNow.current.has(providerId)) return;
    let fresh: ProviderConfig | undefined;
    try {
      fresh = await getProvider(providerId);
    } catch {
      return;
    }
    if (!fresh || !fresh.baseUrl) return;

    const key = (fresh.apiKey ?? "").trim();
    const local = isLocalProvider(fresh);
    if (key.length < AUTO_PROBE_MIN_KEY_LENGTH && !(opts.allowShortKey && local)) return;
    if (probedKeys.current[providerId] === key) return;

    probingNow.current.add(providerId);
    setAutoProbing((s) => ({ ...s, [providerId]: true }));
    try {
      const res = await probeProvider(fresh);
      if (!aliveRef.current) return;
      if (res.ok) {
        const count = res.models?.length ?? 0;
        const { models, added } = mergeModels(fresh.models, res.models ?? []);
        if (count) await upsertProvider({ ...fresh, models });
        await markProviderCheck(providerId, true, `自动拉取到 ${count} 个模型`);
        probedKeys.current[providerId] = key;
        notify(
          "success",
          fresh.name + " 模型列表已更新",
          `自动拉取到 ${count} 个模型` + (added > 0 ? `，新增 ${added} 个` : "，列表已是最新"),
        );
      } else {
        // 失败：不打扰输入，只在卡片上标记失败并显示原因
        await markProviderCheck(providerId, false, res.message);
      }
    } catch {
      /* 自动拉取失败静默处理，用户仍可手动「测试连接」 */
    } finally {
      probingNow.current.delete(providerId);
      if (aliveRef.current) {
        setAutoProbing((s) => {
          const next = { ...s };
          delete next[providerId];
          return next;
        });
        reload();
      }
    }
  };

  /** 防抖调度：输入过程中只保留最后一个定时器 */
  const scheduleAutoProbe = (providerId: string) => {
    const timer = probeTimers.current[providerId];
    if (timer) clearTimeout(timer);
    probeTimers.current[providerId] = setTimeout(() => {
      delete probeTimers.current[providerId];
      void runAutoProbe(providerId);
    }, AUTO_PROBE_DEBOUNCE_MS);
  };

  // 本地供应商（Ollama / LM Studio / localhost）不需要 Key：进入页面时模型列表为空就自动探测一次
  useEffect(() => {
    for (const p of providers) {
      if (!isLocalProvider(p) || !p.baseUrl || p.models.length > 0) continue;
      if (entryProbed.current.has(p.id)) continue;
      entryProbed.current.add(p.id);
      void runAutoProbe(p.id, { allowShortKey: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  // 草稿已经落库（与数据库一致）时清掉它，保证编辑弹窗等外部修改也能反映到输入框
  useEffect(() => {
    setKeyDraft((draft) => {
      let changed = false;
      const next = { ...draft };
      for (const p of providers) {
        if (next[p.id] !== undefined && next[p.id] === (p.apiKey ?? "")) {
          delete next[p.id];
          changed = true;
        }
      }
      return changed ? next : draft;
    });
  }, [providers]);

  // 卸载：清掉还没触发的防抖定时器，并停止后续回写
  useEffect(() => {
    aliveRef.current = true;
    const timers = probeTimers.current;
    return () => {
      aliveRef.current = false;
      for (const t of Object.values(timers)) clearTimeout(t);
      probeTimers.current = {};
    };
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">当前使用的模型</h2>
            <p className="mt-0.5 text-xs opacity-60">
              所有 AI 功能默认用这个模型。也可以到「任务路由」为不同任务指定不同模型。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-black/8 p-3 dark:border-white/10">
          <select
            value={settings.activeProviderId ?? ""}
            onChange={(e) => {
              const p = providers.find((x) => x.id === e.target.value);
              updateSettings({ activeProviderId: e.target.value || undefined, activeModel: p?.models[0] });
            }}
            className="min-w-40 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
          >
            <option value="">— 选择供应商 —</option>
            {providers
              .filter((p) => p.enabled)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <select
            value={settings.activeModel ?? ""}
            onChange={(e) => updateSettings({ activeModel: e.target.value || undefined })}
            className="min-w-40 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
          >
            <option value="">— 选择模型 —</option>
            {(providers.find((p) => p.id === settings.activeProviderId)?.models ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {settings.activeModel ? (
            <Chip size="sm" color="success">
              已就绪
            </Chip>
          ) : (
            <Chip size="sm" color="warning">
              未选择
            </Chip>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">供应商</h2>
            <p className="mt-0.5 text-xs opacity-60">
              API Key 只保存在本机浏览器里，不会上传到任何服务器。浏览器直连国外服务可能被跨域拦截，此时可改用本地模型或 OpenRouter。
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onPress={async () => {
                await seedProviders();
                reload();
                notify("success", "已恢复预置供应商");
              }}
            >
              <RefreshCw className="size-3.5" />
              恢复预置
            </Button>
            <Button size="sm" variant="outline" onPress={() => setEditing(blankProvider())}>
              <Plus className="size-3.5" />
              自定义
            </Button>
          </div>
        </div>

        <ul className="space-y-2">
          {providers.map((p) => (
            <li key={p.id} className="rounded-xl border border-black/8 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                <Chip size="sm" color={p.kind === "ollama" || p.kind === "lmstudio" ? "success" : "default"}>
                  {p.kind === "ollama" || p.kind === "lmstudio" ? "本地" : "云端"}
                </Chip>
                {p.lastCheckOk !== undefined && (
                  <Chip size="sm" color={p.lastCheckOk ? "success" : "danger"}>
                    {p.lastCheckOk ? "连接正常" : "连接失败"}
                  </Chip>
                )}
                <span className="ml-auto text-[10px] opacity-40">{p.baseUrl}</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div className="flex min-w-60 flex-1 items-center gap-1 rounded-lg border border-black/10 px-2 py-1 dark:border-white/15">
                  <KeyRound className="size-3.5 opacity-40" />
                  <input
                    type={showKey[p.id] ? "text" : "password"}
                    value={keyDraft[p.id] ?? p.apiKey ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setKeyDraft((s) => ({ ...s, [p.id]: value })); // 立即回显，避免异步落库期间丢字符
                      void setProviderKey(p.id, value).then(reload);
                      // 停止输入 800ms 后自动去拉该供应商的模型列表
                      scheduleAutoProbe(p.id);
                    }}
                    placeholder={p.kind === "ollama" || p.kind === "lmstudio" ? "本地模型通常不需要 Key" : "粘贴 API Key"}
                    className="w-full bg-transparent text-xs outline-none placeholder:opacity-40"
                  />
                  <button type="button" onClick={() => setShowKey((s) => ({ ...s, [p.id]: !s[p.id] }))}>
                    {showKey[p.id] ? <EyeOff className="size-3.5 opacity-40" /> : <Eye className="size-3.5 opacity-40" />}
                  </button>
                </div>
                <Button size="sm" variant="outline" isPending={checking === p.id} onPress={() => void check(p)}>
                  测试连接
                </Button>
                {autoProbing[p.id] && <span className="animate-pulse-soft text-[10px] opacity-60">正在获取模型…</span>}
                <Switch
                  isSelected={p.enabled}
                  onChange={(v) => {
                    void upsertProvider({ ...p, enabled: v }).then(reload);
                  }}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    启用
                  </Switch.Content>
                </Switch>
                <Button size="sm" variant="ghost" onPress={() => setEditing(p)}>
                  编辑
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    if (!confirm("删除该供应商配置？")) return;
                    await deleteProvider(p.id);
                    reload();
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              {p.lastCheckOk === false && p.lastCheckMessage && (
                <p
                  className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-rose-600/80 dark:text-rose-400/80"
                  title={p.lastCheckMessage}
                >
                  {p.lastCheckMessage}
                </p>
              )}

              {p.models.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.models.slice(0, 10).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateSettings({ activeProviderId: p.id, activeModel: m })}
                      className={
                        "rounded-md px-1.5 py-0.5 text-[10px] transition " +
                        (settings.activeModel === m
                          ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
                          : "bg-black/[0.04] opacity-60 hover:opacity-100 dark:bg-white/[0.06]")
                      }
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <ProviderEditor
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
            notify("success", "供应商已保存");
          }}
        />
      )}

      <ProxyCard />

      <PricingPanel />

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">生成参数默认值</h2>
        <p className="mt-0.5 text-xs opacity-60">可以在「任务路由」里为每个任务单独覆盖。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs opacity-70">
            上下文预算（tokens）
            <input
              type="number"
              min={2000}
              max={200000}
              step={1000}
              value={settings.contextBudget}
              onChange={(e) => updateSettings({ contextBudget: Number(e.target.value) || 24000 })}
              className="tabular mt-1 w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            />
          </label>
          <label className="text-xs opacity-70">
            默认候选数
            <input
              type="number"
              min={1}
              max={5}
              value={settings.candidateCount}
              onChange={(e) => updateSettings({ candidateCount: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
              className="tabular mt-1 w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            />
          </label>
          <label className="flex items-center gap-2 pt-5 text-xs opacity-70">
            <Switch isSelected={settings.stream} onChange={(v) => updateSettings({ stream: v })}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                流式输出
              </Switch.Content>
            </Switch>
          </label>
        </div>
      </section>
    </div>
  );
}

function blankProvider(): ProviderConfig {
  const now = new Date().toISOString();
  return {
    id: "prov_" + Math.random().toString(36).slice(2, 8),
    name: "",
    kind: "custom" as ProviderKind,
    baseUrl: "",
    models: [],
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function ProviderEditor({
  provider,
  onClose,
  onSaved,
}: {
  provider: ProviderConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ProviderConfig>(provider);
  const [modelsText, setModelsText] = useState(provider.models.join("\n"));

  return (
    <div className="fixed inset-0 z-[300] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">编辑供应商</h3>
        <TextField value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })}>
          <Label>名称</Label>
          <Input placeholder="例如：公司内网 vLLM" />
        </TextField>
        <TextField value={draft.baseUrl} onChange={(v) => setDraft({ ...draft, baseUrl: v })}>
          <Label>接口地址（OpenAI 兼容，到 /v1 为止）</Label>
          <Input placeholder="https://api.example.com/v1" />
        </TextField>
        <div>
          <Label className="mb-1.5 block text-xs">协议类型</Label>
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as ProviderKind })}
            className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
          >
            {(["openai", "deepseek", "moonshot", "zhipu", "qwen", "siliconflow", "openrouter", "ollama", "lmstudio", "custom"] as ProviderKind[]).map(
              (k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ),
            )}
          </select>
        </div>
        <TextField value={draft.apiKey ?? ""} onChange={(v) => setDraft({ ...draft, apiKey: v })}>
          <Label>API Key</Label>
          <Input placeholder="sk-…" />
        </TextField>
        <div>
          <Label className="mb-1.5 block text-xs">模型列表（每行一个）</Label>
          <TextArea rows={4} value={modelsText} onChange={(e) => setModelsText(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-xs opacity-70">
          <input
            type="checkbox"
            checked={Boolean(draft.corsBlocked)}
            onChange={(e) => setDraft({ ...draft, corsBlocked: e.target.checked })}
            className="accent-violet-500"
          />
          该服务不支持浏览器跨域（会尝试通过本地代理转发）
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onPress={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            onPress={async () => {
              await upsertProvider({
                ...draft,
                models: modelsText.split("\n").map((m) => m.trim()).filter(Boolean),
              });
              onSaved();
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

// ==================== 任务路由 ====================

function RoutingTab() {
  const routingRes = useAsync(() => listRouting(), [], [] as TaskRouting[]);
  const routing = routingRes.value;
  const reload = routingRes.reload;
  const providerListRes = useAsync(() => listProviders(), [], [] as ProviderConfig[]);
  const providers = providerListRes.value;
  const notify = useAppStore((s) => s.notify);

  const options = providers
    .filter((p) => p.enabled)
    .flatMap((p) => p.models.map((m) => ({ value: p.id + "::" + m, label: p.name + " / " + m })));

  const groups: { label: string; kinds: AiTaskKind[] }[] = [
    { label: "创作生成", kinds: ["genesis", "outline", "chapter-outline", "continue", "expand", "rewrite", "polish", "describe", "dialogue", "brainstorm"] },
    { label: "质量分析", kinds: ["consistency", "style-check", "voice-check", "pacing", "character-arc", "foreshadow-audit", "reader-sim", "critique"] },
    { label: "信息抽取", kinds: ["extract-entities", "extract-characters", "extract-timeline", "summarize", "state-diff", "chapter-summary"] },
    { label: "对话与其他", kinds: ["chat", "agent"] },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-black/8 p-4 text-xs leading-relaxed opacity-70 dark:border-white/10">
        创作类任务建议高温（0.8~1.0）以保持语言鲜活；分析与抽取类建议低温（0~0.3）以保证稳定。
        留空表示使用「当前使用的模型」。
      </div>

      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="mb-2 text-sm font-semibold">{g.label}</h2>
          <div className="space-y-2">
            {g.kinds.map((kind) => {
              const row = routing.find((r) => r.kind === kind);
              if (!row) return null;
              return (
                <div key={kind} className="rounded-xl border border-black/8 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-24 shrink-0 text-xs font-medium">{TASK_LABELS[kind]}</span>
                    <select
                      value={row.primary ?? ""}
                      onChange={async (e) => {
                        await updateRouting(kind, { primary: e.target.value || undefined });
                        reload();
                      }}
                      className="min-w-44 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
                    >
                      <option value="">— 跟随默认 —</option>
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-[11px] opacity-60">
                      温度
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.05}
                        value={row.params.temperature ?? 0.85}
                        onChange={async (e) => {
                          await updateRouting(kind, { params: { ...row.params, temperature: Number(e.target.value) } });
                          reload();
                        }}
                        className="tabular w-14 rounded border border-black/10 bg-transparent px-1 py-0.5 text-center dark:border-white/15"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[11px] opacity-60">
                      max tokens
                      <input
                        type="number"
                        min={256}
                        max={32000}
                        step={256}
                        value={row.params.maxTokens ?? 4096}
                        onChange={async (e) => {
                          await updateRouting(kind, { params: { ...row.params, maxTokens: Number(e.target.value) } });
                          reload();
                        }}
                        className="tabular w-16 rounded border border-black/10 bg-transparent px-1 py-0.5 text-center dark:border-white/15"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[11px] opacity-60">
                      候选
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={row.candidates ?? 1}
                        onChange={async (e) => {
                          await updateRouting(kind, { candidates: Math.max(1, Math.min(5, Number(e.target.value) || 1)) });
                          reload();
                        }}
                        className="tabular w-10 rounded border border-black/10 bg-transparent px-1 py-0.5 text-center dark:border-white/15"
                      />
                    </label>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] opacity-50">备用模型</span>
                    <select
                      value={row.fallbacks[0] ?? ""}
                      onChange={async (e) => {
                        await updateRouting(kind, { fallbacks: e.target.value ? [e.target.value] : [] });
                        reload();
                      }}
                      className="min-w-40 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-[11px] dark:border-white/15"
                    >
                      <option value="">— 无 —</option>
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <Button
        variant="outline"
        onPress={async () => {
          for (const r of routing) {
            await updateRouting(r.kind, { primary: undefined, fallbacks: [] });
          }
          reload();
          notify("success", "已恢复为全部跟随默认模型");
        }}
      >
        全部重置为默认
      </Button>
    </div>
  );
}

// ==================== 隐私 ====================

function PrivacyTab() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">数据流向</h2>
        <p className="mt-1.5 text-xs leading-relaxed opacity-70">
          花椒本身不上传任何数据。所有作品、人物、设定都存在这台设备的浏览器数据库（IndexedDB）里。
          只有当你主动点击 AI 功能时，系统才会把「必要的上下文」（当前章节、相关人物卡、世界观条目等）发送给你自己配置的模型服务。
        </p>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">允许使用云端模型</h2>
            <p className="mt-1 text-xs leading-relaxed opacity-65">
              关闭后，AI 功能只会调用本机模型（Ollama / LM Studio / localhost）。适合处理不想外传的稿件。
            </p>
          </div>
          <Switch isSelected={settings.allowCloud} onChange={(v) => updateSettings({ allowCloud: v })}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
        {!settings.allowCloud && (
          <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">
            已开启纯本地模式。请确保 Ollama 或 LM Studio 已在运行，否则 AI 功能会报错。
          </div>
        )}
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">发送前预览</h2>
        <p className="mt-1 text-xs leading-relaxed opacity-65">
          每次 AI 生成后，可以在「AI 用量」页看到这次调用实际带了哪些上下文（人物卡、世界观、伏笔、前文摘要），
          以及各自消耗的 token 数。没有任何内容会在你不知情的情况下被发送。
        </p>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">上下文估算器</h2>
        <ContextEstimator />
      </section>
    </div>
  );
}

function ContextEstimator() {
  const [text, setText] = useState("");
  const tokens = estimateTokens(text);
  return (
    <div className="mt-3">
      <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴一段文字，估算它占多少 token" />
      <p className="mt-2 text-xs opacity-65">
        约 <span className="tabular font-medium">{tokens.toLocaleString()}</span> tokens（中文约 1 字 ≈ 1 token）
      </p>
    </div>
  );
}

// ==================== 数据 ====================

function DataTab() {
  const statsRes = useAsync(() => databaseStats(), [], { name: "", verno: 0, stores: [], totalRecords: 0, estimatedBytes: 0 });
  const stats = statsRes.value;
  const reload = statsRes.reload;
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const notify = useAppStore((s) => s.notify);
  const navigate = useNavigate();

  void isPersisted().then(setPersisted);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">本地数据库</h2>
        <p className="mt-1 text-xs opacity-65">
          {stats.name} · schema v{stats.verno} · 共 {stats.totalRecords.toLocaleString()} 条记录 · 约{" "}
          {formatBytes(stats.estimatedBytes)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-3">
          {stats.stores
            .filter((s) => s.count > 0)
            .map((s) => (
              <div key={s.name} className="flex items-center justify-between rounded-md bg-black/[0.03] px-2 py-1 dark:bg-white/[0.05]">
                <span className="opacity-60">{s.name}</span>
                <span className="tabular opacity-80">{s.count}</span>
              </div>
            ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onPress={reload}>
            刷新统计
          </Button>
          {persisted === false && (
            <Button
              size="sm"
              variant="primary"
              onPress={async () => {
                const ok = await requestPersistence();
                setPersisted(ok);
                notify(ok ? "success" : "warning", ok ? "已申请持久化存储" : "浏览器拒绝了持久化请求");
              }}
            >
              申请持久化存储
            </Button>
          )}
          {persisted === true && (
            <Chip size="sm" color="success">
              已启用持久化存储
            </Chip>
          )}
          <Button size="sm" variant="outline" onPress={() => navigate("/")}>
            去导出备份
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-rose-500/30 bg-rose-500/[0.04] p-4">
        <h2 className="text-sm font-semibold text-rose-600 dark:text-rose-400">危险操作</h2>
        <p className="mt-1 text-xs leading-relaxed opacity-75">
          清空数据库会删除本机所有的作品、章节、设定与 AI 记录，且无法撤销。请先导出备份。
        </p>
        <Button
          className="mt-3"
          size="sm"
          variant="danger"
          onPress={async () => {
            const first = confirm("确定要清空全部本地数据吗？此操作无法撤销。");
            if (!first) return;
            const second = prompt("请输入 DELETE 以确认删除全部数据");
            if (second !== "DELETE") {
              notify("info", "已取消");
              return;
            }
            await wipeDatabase();
            location.reload();
          }}
        >
          <Trash2 className="size-3.5" />
          清空本地数据库
        </Button>
      </section>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="font-semibold">花椒写作平台 <span className="ml-1 text-xs font-normal opacity-50">v{APP_VERSION}</span></h2>
        <p className="mt-1.5 text-xs leading-relaxed opacity-70">
          为长篇小说写作而设计的本地优先工作台。结构化的设定库 + 精准的上下文组装 + 多模型可插拔，
          目标只有一个：让 AI 写出来的东西不用大改。
        </p>
      </section>
      <section className="rounded-xl border border-black/8 p-4 text-xs leading-relaxed opacity-70 dark:border-white/10">
        <p>技术栈：React 19 · TypeScript · HeroUI v3 · Tailwind CSS v4 · Vite 8 · Dexie(IndexedDB)</p>
        <p className="mt-1.5">数据存储：浏览器本地 IndexedDB，支持导出为 JSON 备份；桌面版（Tauri）将改为文件系统存储。</p>
        <p className="mt-1.5">键盘：⌘K 命令面板 · ⌘S 保存 · ⌘J AI 续写 · ⌘⇧F 心流模式 · ⌘, 设置</p>
      </section>
      <ChangelogPanel />

      <section className="rounded-xl border border-black/8 p-4 text-xs leading-relaxed opacity-70 dark:border-white/10">
        <p className="font-medium">数据安全提示</p>
        <p className="mt-1.5">
          浏览器数据可能因为「清除浏览数据」而丢失。建议定期到「数据与导出」页面生成完整备份文件，
          保存到本地磁盘或私有云。
        </p>
      </section>
    </div>
  );
}
