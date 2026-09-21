import { useMemo, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Check, Coins, Plus, Trash2, TriangleAlert } from "lucide-react";
import type { ModelPricing } from "@/core";
import { useLiveQuery } from "dexie-react-hooks";
import { deletePricing, listPricing, listProviders, upsertPricing } from "@/db/repo/settings";
import { listGenerations } from "@/db/repo/ai";
import { useAppStore } from "@/app/store";
import { SectionTitle } from "@/components/common/ui";

/**
 * 模型单价。
 *
 * 为什么必须有这个界面：AI 用量页的「估算成本」要靠它，而之前**只有仓储函数没有表单** ——
 * 用量页的「去填写单价」按钮把作者送到设置页，那里根本没有填写的地方（和早期那个
 * "让你去开一个不存在的代理"是同一类问题）。这里补上，并顺便解决两个实际问题：
 *
 * 1) 作者记不住 key 的确切拼法（providerId::model），所以从**真实调用记录**里列出候选，
 *    点一下就填好，不用手打。
 * 2) 单价是"元 / 百万 token"，直接填 0 和"没填"在界面上无法区分，所以显式支持删除。
 */
export function PricingPanel() {
  const project = useAppStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  const projectId = project?.id;

  const pricing = useLiveQuery(() => listPricing(), [], undefined as ModelPricing[] | undefined);
  const providers = useLiveQuery(() => listProviders(), [], undefined);
  // 真实用过的模型：只有这些填了单价才有意义
  const used = useLiveQuery(
    () => (projectId ? listGenerations(projectId, 5000) : Promise.resolve([])),
    [projectId],
    undefined,
  );

  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [inputPerM, setInputPerM] = useState("");
  const [outputPerM, setOutputPerM] = useState("");

  /** 用过的模型 → 调用次数，用来排序与显示"值得先填哪个" */
  const usedModels = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of used ?? []) {
      if (!g.providerId || !g.model) continue;
      const key = g.providerId + "::" + g.model;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [used]);

  const pricedKeys = useMemo(() => new Set((pricing ?? []).map((p) => p.key)), [pricing]);
  const missing = usedModels.filter(([key]) => !pricedKeys.has(key));

  const canSubmit = providerId.trim() && model.trim();

  const submit = async () => {
    if (!canSubmit) return;
    const key = providerId.trim() + "::" + model.trim();
    await upsertPricing({
      key,
      inputPerM: Number(inputPerM) || 0,
      outputPerM: Number(outputPerM) || 0,
    });
    notify("success", "已保存单价", key + " 之后新的调用会自动算成本");
    setModel("");
    setInputPerM("");
    setOutputPerM("");
  };

  /** 从"缺失列表"点一条，把 provider / model 填进表单 */
  const prefill = (key: string) => {
    const [pid, ...rest] = key.split("::");
    setProviderId(pid);
    setModel(rest.join("::"));
  };

  return (
    <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
      <SectionTitle hint="单位：元 / 百万 token。填了之后新的调用会自动记成本；已有记录不会追溯重算">
        模型单价
      </SectionTitle>

      <p className="mt-2 text-xs leading-relaxed opacity-60">
        「AI 用量」页的估算成本依赖这里。只对填过的模型生效，没填的显示为「—」。
        <span className="opacity-80">单价请以供应商官网为准</span>
        （DeepSeek 的定价在 platform.deepseek.com 的「价格」页），填「每百万 token」的数字即可。
        估算结果仅供参考，实际账单以供应商为准。
      </p>

      {/* 还没有任何调用记录时，把供应商已配的模型也列出来 —— 否则新用户不知道该填什么 key */}
      {usedModels.length === 0 && providers && providers.some((p) => p.models.length > 0) && (
        <div className="mt-3 rounded-lg border border-black/8 px-3 py-2 dark:border-white/10">
          <p className="text-[11px] font-medium opacity-70">你配置的供应商有以下模型，点一下填入表单</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {providers
              .filter((p) => p.enabled && p.models.length)
              .flatMap((p) => p.models.slice(0, 6).map((m) => ({ key: p.id + "::" + m, name: p.name })))
              .filter((x) => !pricedKeys.has(x.key))
              .slice(0, 12)
              .map((x) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => prefill(x.key)}
                  className="rounded-md bg-black/[0.06] px-2 py-1 font-mono text-[10px] transition hover:bg-black/[0.1] dark:bg-white/10 dark:hover:bg-white/15"
                  title={"来自 " + x.name}
                >
                  {x.key}
                </button>
              ))}
          </div>
          <p className="mt-1.5 text-[10px] opacity-45">
            还没有调用记录，所以这里显示的是你配置的模型；用过之后会改为按调用次数排序。
          </p>
        </div>
      )}

      {/* 还没有单价的模型：直接列出来，点一下就能填 */}
      {missing.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-3" />
            这些模型用过但还没填单价（按调用次数排序）
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {missing.slice(0, 12).map(([key, n]) => (
              <button
                key={key}
                type="button"
                onClick={() => prefill(key)}
                className="rounded-md bg-black/[0.06] px-2 py-1 font-mono text-[10px] transition hover:bg-black/[0.1] dark:bg-white/10 dark:hover:bg-white/15"
                title="点一下填入下方表单"
              >
                {key} · {n} 次
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 新增 / 修改 */}
      <div className="mt-3 space-y-2 rounded-lg bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.04]">
        <p className="text-[11px] font-medium opacity-70">填写单价</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="min-w-40 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
          >
            <option value="">— 选供应商 —</option>
            {(providers ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {/* 供应商被删掉但历史记录里还有时，仍然允许手填 id */}
            {providerId && !(providers ?? []).some((p) => p.id === providerId) && (
              <option value={providerId}>{providerId}</option>
            )}
          </select>
          <span className="opacity-40">::</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="模型名，例如 deepseek-flash"
            className="min-w-52 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 font-mono text-xs dark:border-white/15"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] opacity-70">
            输入 ¥
            <input
              type="number"
              min={0}
              step="0.1"
              value={inputPerM}
              onChange={(e) => setInputPerM(e.target.value)}
              placeholder="0"
              className="tabular w-20 rounded border border-black/10 bg-transparent px-1.5 py-0.5 text-center dark:border-white/15"
            />
            /百万
          </label>
          <label className="flex items-center gap-1.5 text-[11px] opacity-70">
            输出 ¥
            <input
              type="number"
              min={0}
              step="0.1"
              value={outputPerM}
              onChange={(e) => setOutputPerM(e.target.value)}
              placeholder="0"
              className="tabular w-20 rounded border border-black/10 bg-transparent px-1.5 py-0.5 text-center dark:border-white/15"
            />
            /百万
          </label>
          <Button size="sm" variant="primary" isDisabled={!canSubmit} onPress={() => void submit()}>
            <Plus className="size-3.5" />
            保存这条
          </Button>
        </div>
        {canSubmit && (
          <p className="font-mono text-[10px] opacity-45">将保存为：{providerId.trim()}::{model.trim()}</p>
        )}
      </div>

      {/* 已有单价 */}
      {pricing === undefined ? null : pricing.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs opacity-50">
          <Coins className="size-3.5" />
          还没有填写任何单价，所以用量页的成本一直是「—」。
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {pricing
            .slice()
            .sort((a, b) => a.key.localeCompare(b.key))
            .map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-black/8 px-2.5 py-1.5 dark:border-white/10"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{row.key}</span>
                <span className="tabular text-[11px] opacity-70">
                  输入 ¥{row.inputPerM} · 输出 ¥{row.outputPerM} /百万
                </span>
                {row.inputPerM === 0 && row.outputPerM === 0 && (
                  <Chip size="sm" color="warning">
                    全为 0，等于没填
                  </Chip>
                )}
                <button
                  type="button"
                  title="删除这条单价"
                  onClick={async () => {
                    await deletePricing(row.key);
                    notify("info", "已删除单价", row.key);
                  }}
                  className="rounded p-1 opacity-40 transition hover:text-rose-500 hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
        </ul>
      )}

      {pricing && pricing.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] opacity-45">
          <Check className="size-3" />
          已填 {pricing.length} 条。成本按用量 × 单价估算，实际账单以供应商为准。
        </p>
      )}
    </section>
  );
}
