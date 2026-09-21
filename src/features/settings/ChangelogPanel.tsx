import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { APP_VERSION, CHANGELOG, CHANGE_KIND_COLOR, CHANGE_KIND_LABEL, type ChangeKind, type Release } from "@/core";

/** 三类变更的固定展示顺序 */
const KIND_ORDER: ChangeKind[] = ["added", "improved", "fixed"];

/**
 * 更新日志。
 * 只展示用户能感知的变化，并按 新增 / 优化 / 修复 分类。
 */
export function ChangelogPanel() {
  // 默认只展开最新一个版本，其余折叠，避免设置页被日志淹没
  const [open, setOpen] = useState<Record<string, boolean>>({ [CHANGELOG[0]?.version ?? ""]: true });

  return (
    <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4 opacity-60" />
            更新日志
          </h2>
          <p className="mt-0.5 text-xs opacity-60">当前版本 v{APP_VERSION} · 共 {CHANGELOG.length} 个版本</p>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setOpen(Object.fromEntries(CHANGELOG.map((r) => [r.version, true])))}
          >
            全部展开
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setOpen(Object.fromEntries(CHANGELOG.map((r) => [r.version, false])))}
          >
            全部折叠
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {CHANGELOG.map((release, i) => (
          <ReleaseRow
            key={release.version}
            release={release}
            latest={i === 0}
            open={open[release.version] ?? false}
            onToggle={() => setOpen((s) => ({ ...s, [release.version]: !s[release.version] }))}
          />
        ))}
      </div>
    </section>
  );
}

function ReleaseRow({
  release,
  latest,
  open,
  onToggle,
}: {
  release: Release;
  latest: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const counts = KIND_ORDER.map((k) => ({
    kind: k,
    n: release.changes.find((c) => c.kind === k)?.items.length ?? 0,
  })).filter((c) => c.n > 0);

  return (
    <div className={"rounded-lg border " + (latest ? "border-black/25 bg-black/[0.03]" : "border-black/8 dark:border-white/10")}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 px-3 py-2.5 text-left">
        {open ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 opacity-50" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 opacity-50" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tabular text-sm font-semibold">v{release.version}</span>
            {latest && (
              <Chip size="sm" color="accent">
                当前版本
              </Chip>
            )}
            <span className="text-[11px] opacity-45">{release.date}</span>
            <span className="ml-auto flex gap-1">
              {counts.map((c) => (
                <Chip key={c.kind} size="sm" color={CHANGE_KIND_COLOR[c.kind]}>
                  {CHANGE_KIND_LABEL[c.kind]} {c.n}
                </Chip>
              ))}
            </span>
          </div>
          {release.headline && <p className="mt-1 text-xs leading-relaxed opacity-70">{release.headline}</p>}
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 py-3 dark:border-white/5">
          {KIND_ORDER.map((kind) => {
            const entry = release.changes.find((c) => c.kind === kind);
            if (!entry?.items.length) return null;
            return (
              <div key={kind}>
                <p className="mb-1.5 flex items-center gap-1.5">
                  <Chip size="sm" color={CHANGE_KIND_COLOR[kind]}>
                    {CHANGE_KIND_LABEL[kind]}
                  </Chip>
                  <span className="text-[11px] opacity-45">{entry.items.length} 项</span>
                </p>
                <ul className="space-y-1">
                  {entry.items.map((item, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-30" />
                      <span className="opacity-85">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
