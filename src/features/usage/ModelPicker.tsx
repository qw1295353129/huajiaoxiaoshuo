import { Button, Card, Chip } from "@heroui/react";
import { Check, Settings2 } from "lucide-react";
import type { ProviderConfig } from "@/core";
import { SectionTitle } from "@/components/common/ui";

const LOCAL_KINDS: ProviderConfig["kind"][] = ["ollama", "lmstudio"];

function isLocal(provider: ProviderConfig): boolean {
  return LOCAL_KINDS.includes(provider.kind) || /127\.0\.0\.1|localhost/.test(provider.baseUrl);
}

/** 供应商是否真的能调用 */
function isUsable(provider: ProviderConfig): boolean {
  return provider.enabled && provider.models.length > 0 && (Boolean(provider.apiKey) || isLocal(provider));
}

/** 当前模型选择器：直接写回设置里的 activeProviderId / activeModel */
export function ModelPicker({
  providers,
  activeProviderId,
  activeModel,
  onSelect,
  onOpenSettings,
}: {
  providers: ProviderConfig[];
  activeProviderId?: string;
  activeModel?: string;
  onSelect: (providerId: string, model: string) => void;
  onOpenSettings: () => void;
}) {
  const current = providers.find((p) => p.id === activeProviderId);
  const currentValue = activeProviderId && activeModel ? activeProviderId + "::" + activeModel : "";

  return (
    <Card className="p-4">
      <SectionTitle
        hint="所有 AI 功能默认使用这个模型；单个任务可以在设置里单独指定"
        action={
          <Button size="sm" variant="ghost" onPress={onOpenSettings}>
            <Settings2 className="size-3.5" />
            去设置
          </Button>
        }
      >
        当前使用的模型
      </SectionTitle>

      <div className="flex flex-wrap items-center gap-2">
        {activeModel ? (
          <Chip size="md" color="accent">
            <Check className="mr-1 inline size-3" />
            {(current?.name ?? "未知供应商") + " · " + activeModel}
          </Chip>
        ) : (
          <Chip size="md" color="warning">
            还没有选择模型
          </Chip>
        )}
        {current && !isUsable(current) && (
          <span className="text-[11px] text-amber-500">
            {current.enabled ? "缺少 API Key 或模型列表为空" : "该供应商已停用"}
          </span>
        )}
      </div>

      <div className="mt-3">
        <select
          value={currentValue}
          onChange={(e) => {
            const parts = e.target.value.split("::");
            const providerId = parts[0];
            const model = parts.slice(1).join("::");
            if (providerId && model) onSelect(providerId, model);
          }}
          className="w-full rounded-lg border border-black/8 bg-white/60 px-2.5 py-2 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:bg-white/5"
        >
          <option value="">选择模型…</option>
          {providers.map((provider) => (
            <optgroup
              key={provider.id}
              label={provider.name + (isUsable(provider) ? "" : provider.enabled ? "（未配置 Key）" : "（已停用）")}
            >
              {provider.models.map((model) => (
                <option key={provider.id + "::" + model} value={provider.id + "::" + model} disabled={!isUsable(provider)}>
                  {model}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <ul className="mt-3 space-y-1">
        {providers.length === 0 && <li className="text-xs opacity-50">还没有供应商，去设置里添加一个。</li>}
        {providers.map((provider) => (
          <li key={provider.id} className="flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate opacity-70">{provider.name}</span>
            <span className="tabular opacity-45">{provider.models.length} 个模型</span>
            {isUsable(provider) ? (
              <Chip size="sm" color="success">
                可用
              </Chip>
            ) : provider.enabled ? (
              <Chip size="sm" color="warning">
                缺 Key
              </Chip>
            ) : (
              <Chip size="sm">已停用</Chip>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed opacity-45">
        本地模型（Ollama / LM Studio）无需 API Key。上下文预算、任务级路由与模型单价都在「设置 → 模型与 AI」里调整。
      </p>
    </Card>
  );
}
