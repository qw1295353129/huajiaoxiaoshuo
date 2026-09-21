import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card, Chip, Modal } from "@heroui/react";
import { Plus, Search, Trash2, Users } from "lucide-react";
import type { CharacterRole, ID } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading } from "@/components/common/ui";
import { useChapters, useDebounced } from "@/app/hooks";
import { createCharacter, deleteCharacter, listCharacters } from "@/db/repo/cast";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { formatRelative } from "@/utils/format";
import { CharacterDetail } from "./CharacterDetail";
import { CharacterAvatar, ConfirmDialog, Labeled, inputClass, selectClass } from "./parts";
import { ROLE_COLOR, ROLE_LABEL, ROLE_ORDER, STATUS_LABEL, roleLabel, roleWeight, searchableText } from "./meta";

/** 每页展示的卡片数：角色可能有几百个，先渲染一批，剩下的"显示更多" */
const PAGE_SIZE = 24;

type SortKey = "role" | "name" | "updated";

const SORT_LABEL: Record<SortKey, string> = {
  role: "出场优先级",
  name: "姓名",
  updated: "最近更新",
};

const SORT_ORDER: SortKey[] = ["role", "name", "updated"];

/**
 * 人物页：URL 带 characterId 时渲染详情，否则渲染列表。
 * 两条路由都指向这里，详情视图复用同一个组件。
 */
export function CharactersPage() {
  const { projectId = "", characterId } = useParams<{ projectId: string; characterId?: string }>();
  if (characterId) return <CharacterDetail />;
  return <CharacterList projectId={projectId} />;
}

function CharacterList({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  // 需要区分「还在读库」和「确实一个角色都没有」，所以直接把 repo 函数交给 useLiveQuery（读写仍然只走 repo）
  const rows = useLiveQuery(() => listCharacters(projectId), [projectId], undefined);
  const chapters = useChapters(projectId);

  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | CharacterRole>("all");
  const [sort, setSort] = useState<SortKey>("role");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: ID; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const search = useDebounced(query, 220).trim().toLowerCase();

  // 出场章节数：一次遍历所有章节建表，避免每个角色各扫一遍章节数组
  const appearanceCount = useMemo(() => {
    const map = new Map<ID, number>();
    for (const ch of chapters) {
      for (const id of ch.characterIds) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [chapters]);

  const roleCount = useMemo(() => {
    const map = new Map<CharacterRole, number>();
    for (const c of rows ?? []) map.set(c.role, (map.get(c.role) ?? 0) + 1);
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const list = (rows ?? []).filter((c) => {
      if (role !== "all" && c.role !== role) return false;
      if (!search) return true;
      return searchableText(c).includes(search);
    });
    if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    } else if (sort === "updated") {
      list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    } else {
      list.sort(
        (a, b) =>
          roleWeight(a.role) - roleWeight(b.role) ||
          (appearanceCount.get(b.id) ?? 0) - (appearanceCount.get(a.id) ?? 0) ||
          a.name.localeCompare(b.name, "zh"),
      );
    }
    return list;
  }, [rows, role, search, sort, appearanceCount]);

  // 筛选条件变化后回到第一批，避免看到"空白的第 3 页"
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [search, role, sort]);

  const visible = filtered.slice(0, limit);
  const total = rows?.length ?? 0;

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteCharacter(pendingDelete.id);
      notify("success", "已删除人物", pendingDelete.name + " 的关系与出场记录也一并清理");
      setPendingDelete(null);
    } catch (e) {
      notify("danger", "删除失败", e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const description =
    rows === undefined
      ? "正在读取人物档案…"
      : total === 0
        ? "还没有角色，先建一个主角吧"
        : filtered.length === total
          ? "共 " + total + " 位角色"
          : "共 " + total + " 位角色 · 筛选出 " + filtered.length + " 位";

  return (
    <PageScaffold
      title="人物"
      description={description}
      actions={
        <Button variant="primary" size="sm" onPress={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          新建人物
        </Button>
      }
    >
      {rows === undefined ? (
        <Loading label="正在读取人物档案…" />
      ) : total === 0 ? (
        <EmptyHint
          icon={<Users className="size-9" />}
          title="还没有人物"
          description="创建角色后可以在这里维护外貌、性格、欲望与口吻卡；AI 生成对话和续写时会自动带上这些设定。"
          action={
            <Button variant="primary" size="sm" onPress={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              新建第一个人物
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-40" />
              <input
                className={inputClass + " pl-9"}
                value={query}
                placeholder="搜索姓名 / 别名 / 定位 / 标签…"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className={selectClass + " w-auto min-w-32"}
              value={role}
              aria-label="按角色类型筛选"
              onChange={(e) => setRole(e.target.value as "all" | CharacterRole)}
            >
              <option value="all">全部类型（{total}）</option>
              {ROLE_ORDER.filter((r) => (roleCount.get(r) ?? 0) > 0 || role === r).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}（{roleCount.get(r) ?? 0}）
                </option>
              ))}
            </select>
            <select
              className={selectClass + " w-auto min-w-28"}
              value={sort}
              aria-label="排序方式"
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORT_ORDER.map((k) => (
                <option key={k} value={k}>
                  排序：{SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <EmptyHint
              title="没有匹配的角色"
              description="换个关键词，或者把类型筛选改回「全部类型」。"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    setQuery("");
                    setRole("all");
                  }}
                >
                  清除筛选
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visible.map((c) => (
                  <Card
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    className="group cursor-pointer p-4 transition hover:-translate-y-0.5 hover:shadow-md"
                    onClick={() => navigate(ROUTES.character(projectId, c.id))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(ROUTES.character(projectId, c.id));
                      }
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <CharacterAvatar character={c} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-medium">{c.name}</h3>
                          <Chip size="sm" color={ROLE_COLOR[c.role]}>
                            {roleLabel(c.role)}
                          </Chip>
                        </div>
                        {c.aliases.length > 0 && (
                          <p className="mt-0.5 truncate text-[11px] opacity-50">又名 {c.aliases.join("、")}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={"删除 " + c.name}
                        className="-mt-1 -mr-1 rounded p-1 opacity-0 transition group-hover:opacity-50 hover:!opacity-100 hover:text-rose-500 focus:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete({ id: c.id, name: c.name });
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>

                    {c.tagline ? (
                      <p className="mt-3 line-clamp-2 text-xs leading-relaxed opacity-65">{c.tagline}</p>
                    ) : (
                      <p className="mt-3 text-xs leading-relaxed opacity-35">还没有写定位</p>
                    )}

                    {c.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {c.tags.slice(0, 4).map((t) => (
                          <Chip key={t} size="sm">
                            {t}
                          </Chip>
                        ))}
                        {c.tags.length > 4 && <span className="self-center text-[11px] opacity-45">+{c.tags.length - 4}</span>}
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-2.5 text-[11px] opacity-55 dark:border-white/5">
                      <span className="tabular">出场 {appearanceCount.get(c.id) ?? 0} 章</span>
                      <span>
                        {STATUS_LABEL[c.status] ?? "未知"} · {formatRelative(c.updatedAt)}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>

              {filtered.length > visible.length && (
                <div className="mt-5 flex justify-center">
                  <Button variant="outline" size="sm" onPress={() => setLimit((n) => n + PAGE_SIZE)}>
                    显示更多（还有 {filtered.length - visible.length} 位）
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      <CreateCharacterDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        onCreated={(id) => navigate(ROUTES.character(projectId, id))}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="删除人物"
        description={
          <>
            确定删除「{pendingDelete?.name}」吗？该角色的关系、出场统计与里程碑会一起删除，此操作不可撤销。
          </>
        }
        isPending={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </PageScaffold>
  );
}

/** 新建人物：只收最关键的几个字段，其余留到详情页补 */
function CreateCharacterDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: ID;
  onCreated: (id: ID) => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [name, setName] = useState("");
  const [role, setRole] = useState<CharacterRole>("protagonist");
  const [tagline, setTagline] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);

  // 每次打开都重置，避免上次输入残留
  useEffect(() => {
    if (!open) return;
    setName("");
    setRole("protagonist");
    setTagline("");
    setAge("");
    setGender("");
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      notify("warning", "请先填写姓名");
      return;
    }
    setSaving(true);
    try {
      const created = await createCharacter(projectId, {
        name,
        role,
        tagline: tagline.trim() || undefined,
        age: age.trim() || undefined,
        gender: gender.trim() || undefined,
      });
      notify("success", "已创建人物", created.name);
      onOpenChange(false);
      onCreated(created.id);
    } catch (e) {
      notify("danger", "创建失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog aria-label="新建人物">
            <Modal.Header>
              <Modal.Heading>新建人物</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="姓名" className="sm:col-span-2">
                  <input
                    className={inputClass}
                    value={name}
                    placeholder="如：沈砚之"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit();
                    }}
                  />
                </Labeled>
                <Labeled label="角色类型">
                  <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value as CharacterRole)}>
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="年龄" hint="可以写模糊值，如「四十上下」">
                  <input className={inputClass} value={age} placeholder="28 / 四十上下" onChange={(e) => setAge(e.target.value)} />
                </Labeled>
                <Labeled label="性别" className="sm:col-span-2">
                  <input className={inputClass} value={gender} placeholder="女 / 男 / 其他" onChange={(e) => setGender(e.target.value)} />
                </Labeled>
                <Labeled label="定位" hint="一句话说清他是谁、在故事里要干什么" className="sm:col-span-2">
                  <input
                    className={inputClass}
                    value={tagline}
                    placeholder="如：被灭门的旧朝史官，靠一支笔复仇"
                    onChange={(e) => setTagline(e.target.value)}
                  />
                </Labeled>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" size="sm" isDisabled={saving} onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button variant="primary" size="sm" isPending={saving} onPress={() => void submit()}>
                创建并编辑
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
