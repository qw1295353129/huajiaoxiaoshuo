import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card } from "@heroui/react";
import {
  ArrowLeft,
  Eye,
  Heart,
  Lightbulb,
  MessageSquare,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  Zap,
} from "lucide-react";
import type { Character } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading } from "@/components/common/ui";
import { deleteCharacter, getCharacter, updateCharacter } from "@/db/repo/cast";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { formatDateTime } from "@/utils/format";
import { AiFillDialog } from "./AiFillDialog";
import { AppearancePanel } from "./AppearancePanel";
import { MilestonePanel } from "./MilestonePanel";
import { RelationshipPanel } from "./RelationshipPanel";
import {
  CharacterAvatar,
  ConfirmDialog,
  Labeled,
  SectionCard,
  TagEditor,
  inputClass,
  selectClass,
  textareaClass,
} from "./parts";
import {
  ALL_DRAFT_KEYS,
  SECTIONS,
  buildPatch,
  isAnyDirty,
  isSectionDirty,
  toDraft,
  type CharacterDraft,
  type DraftKey,
  type SectionKey,
  type VoiceDraft,
} from "./draft";
import {
  REGISTER_PRESETS,
  ROLE_LABEL,
  ROLE_ORDER,
  SENTENCE_LENGTH_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  roleLabel,
} from "./meta";

const SECTION_LABEL: Record<SectionKey, string> = {
  basics: "基础信息",
  appearance: "外貌",
  personality: "性格",
  drive: "欲望与缺陷",
  arc: "人物弧光",
  abilities: "能力",
  background: "背景",
  voice: "口吻卡",
};

/**
 * 人物详情：分区编辑（每块独立保存）+ 口吻卡 + 里程碑 + 出场统计 + 关系。
 * 只读订阅用 useLiveQuery 直接读 getCharacter（任务允许的单条例外），写库一律走 updateCharacter。
 */
export function CharacterDetail() {
  const { projectId = "", characterId = "" } = useParams<{ projectId: string; characterId: string }>();
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);

  // 第三参数 null 作为哨兵：null=还没读到，undefined=确实不存在
  const character = useLiveQuery(() => getCharacter(characterId), [characterId], null) as
    | Character
    | null
    | undefined;

  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const ownerRef = useRef<string | null>(null);
  const [savingSection, setSavingSection] = useState<SectionKey | "all" | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 只在切换角色时重建草稿：保存后不重置换，避免未保存的输入被冲掉
  useEffect(() => {
    if (character === null) return;
    if (!character) {
      ownerRef.current = null;
      setDraft(null);
      return;
    }
    if (ownerRef.current === character.id) return;
    ownerRef.current = character.id;
    setDraft(toDraft(character));
  }, [character]);

  const currentDraft = useMemo(() => (character ? toDraft(character) : null), [character]);

  if (character === null) {
    return (
      <PageScaffold title="人物" description="正在读取人物档案…">
        <Loading label="正在读取人物档案…" />
      </PageScaffold>
    );
  }

  if (!character || !draft || !currentDraft) {
    return (
      <PageScaffold title="找不到这个人物" description={characterId}>
        <EmptyHint
          title="人物不存在或已被删除"
          description="可能已经在别处删除了，回列表看看其它角色。"
          action={
            <Button variant="primary" size="sm" onPress={() => navigate(ROUTES.characters(projectId))}>
              返回人物列表
            </Button>
          }
        />
      </PageScaffold>
    );
  }

  const set = <K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) =>
    setDraft((d) => (d ? ({ ...d, [key]: value } as CharacterDraft) : d));

  const setVoice = <K extends keyof VoiceDraft>(key: K, value: VoiceDraft[K]) =>
    setDraft((d) => (d ? ({ ...d, voice: { ...d.voice, [key]: value } } as CharacterDraft) : d));

  const dirtyOf = (section: SectionKey) => isSectionDirty(draft, currentDraft, SECTIONS[section]);
  const anyDirty = isAnyDirty(draft, currentDraft);

  const save = async (section: SectionKey) => {
    const keys = SECTIONS[section] as readonly DraftKey[];
    if ((keys as readonly string[]).includes("name") && !draft.name.trim()) {
      notify("warning", "姓名不能为空");
      return;
    }
    setSavingSection(section);
    try {
      await updateCharacter(character.id, buildPatch(draft, keys));
      notify("success", "已保存" + SECTION_LABEL[section]);
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSection(null);
    }
  };

  const saveAll = async () => {
    if (!draft.name.trim()) {
      notify("warning", "姓名不能为空");
      return;
    }
    setSavingSection("all");
    try {
      await updateCharacter(character.id, buildPatch(draft, ALL_DRAFT_KEYS));
      notify("success", "已保存全部修改");
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSection(null);
    }
  };

  const applyAi = async (patch: Partial<Character>) => {
    await updateCharacter(character.id, patch);
    // 立刻同步草稿，避免等待 liveQuery 回灌造成输入框闪回
    setDraft(toDraft({ ...character, ...patch }));
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteCharacter(character.id);
      notify("success", "已删除人物", character.name);
      navigate(ROUTES.characters(projectId));
    } catch (e) {
      notify("danger", "删除失败", e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageScaffold
      title={character.name}
      description={
        [roleLabel(character.role), character.tagline, "更新于 " + formatDateTime(character.updatedAt)]
          .filter(Boolean)
          .join(" · ")
      }
      actions={
        <>
          <Button variant="ghost" size="sm" onPress={() => navigate(ROUTES.characters(projectId))}>
            <ArrowLeft className="size-4" />
            返回列表
          </Button>
          {anyDirty && (
            <Button variant="outline" size="sm" isPending={savingSection === "all"} onPress={() => void saveAll()}>
              保存全部
            </Button>
          )}
          <Button variant="secondary" size="sm" onPress={() => setAiOpen(true)}>
            <Sparkles className="size-4" />
            AI 补全人物卡
          </Button>
          <Button variant="danger-soft" size="sm" isIconOnly aria-label="删除人物" onPress={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
          </Button>
        </>
      }
    >
      <div className="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------- 主栏：设定编辑 ---------- */}
        <div className="space-y-4">
          <SectionCard
            title="基础信息"
            hint="姓名与别名会被一致性检查用来识别同一个人"
            icon={<UserRound className="size-4 opacity-60" />}
            dirty={dirtyOf("basics")}
            saving={savingSection === "basics"}
            onSave={() => void save("basics")}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="姓名">
                <input className={inputClass} value={draft.name} onChange={(e) => set("name", e.target.value)} />
              </Labeled>
              <Labeled label="头像" hint="emoji 或留空用名字首字">
                <div className="flex items-center gap-2">
                  <CharacterAvatar
                    character={{ id: character.id, name: draft.name, avatarEmoji: draft.avatarEmoji }}
                    size={36}
                  />
                  <input
                    className={inputClass}
                    value={draft.avatarEmoji}
                    placeholder="🦊"
                    onChange={(e) => set("avatarEmoji", e.target.value)}
                  />
                </div>
              </Labeled>
              <Labeled label="角色类型">
                <select
                  className={selectClass}
                  value={draft.role}
                  onChange={(e) => set("role", e.target.value as CharacterDraft["role"])}
                >
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="状态">
                <select
                  className={selectClass}
                  value={draft.status}
                  onChange={(e) => set("status", e.target.value as CharacterDraft["status"])}
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="年龄">
                <input className={inputClass} value={draft.age} onChange={(e) => set("age", e.target.value)} />
              </Labeled>
              <Labeled label="性别">
                <input className={inputClass} value={draft.gender} onChange={(e) => set("gender", e.target.value)} />
              </Labeled>
              <Labeled label="代词">
                <input
                  className={inputClass}
                  value={draft.pronouns}
                  placeholder="他 / 她 / 它"
                  onChange={(e) => set("pronouns", e.target.value)}
                />
              </Labeled>
              <Labeled label="定位" hint="一句话说清他是谁">
                <input className={inputClass} value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} />
              </Labeled>
              <Labeled label="别名 / 称呼" hint="回车添加，不同称呼会被识别为同一人" className="sm:col-span-2">
                <TagEditor value={draft.aliases} onChange={(v) => set("aliases", v)} placeholder="阿砚 / 沈大人…" />
              </Labeled>
              <Labeled label="标签" className="sm:col-span-2">
                <TagEditor value={draft.tags} onChange={(v) => set("tags", v)} placeholder="旧朝 / 史官…" />
              </Labeled>
              <Labeled label="写作提示" hint="只写给 AI 看的备注，例如「不要写成恋爱脑」" className="sm:col-span-2">
                <textarea
                  className={textareaClass}
                  rows={2}
                  value={draft.writingNotes}
                  onChange={(e) => set("writingNotes", e.target.value)}
                />
              </Labeled>
            </div>
          </SectionCard>

          {/* 口吻卡：AI 生成对话的主要依据，单独高亮 */}
          <SectionCard
            title="口吻卡"
            hint="AI 生成对白与续写时会带上这张卡；写得越具体，人物说话越像他自己"
            icon={<MessageSquare className="size-4 text-violet-500" />}
            accent
            dirty={dirtyOf("voice")}
            saving={savingSection === "voice"}
            onSave={() => void save("voice")}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="语气" hint="冷淡 / 咋呼 / 文绉绉…">
                <input
                  className={inputClass}
                  value={draft.voice.tone}
                  placeholder="克制、带刺"
                  onChange={(e) => setVoice("tone", e.target.value)}
                />
              </Labeled>
              <Labeled label="语域" hint="粗俗 / 日常 / 文雅 / 古风 / 学术">
                <input
                  className={inputClass}
                  list="nf-register-presets"
                  value={draft.voice.register}
                  onChange={(e) => setVoice("register", e.target.value)}
                />
              </Labeled>
              <Labeled label="句长偏好">
                <select
                  className={selectClass}
                  value={draft.voice.sentenceLength}
                  onChange={(e) => setVoice("sentenceLength", e.target.value as VoiceDraft["sentenceLength"])}
                >
                  <option value="">未设定</option>
                  <option value="short">{SENTENCE_LENGTH_LABEL.short}</option>
                  <option value="medium">{SENTENCE_LENGTH_LABEL.medium}</option>
                  <option value="long">{SENTENCE_LENGTH_LABEL.long}</option>
                </select>
              </Labeled>
              <Labeled label="潜台词习惯" hint="嘴上说什么、心里其实想什么">
                <input
                  className={inputClass}
                  value={draft.voice.subtext}
                  placeholder="从不直接说在乎，改用命令句"
                  onChange={(e) => setVoice("subtext", e.target.value)}
                />
              </Labeled>
              <Labeled label="口癖 / 句尾助词" hint="一行一条，会作为对话生成的硬约束" className="sm:col-span-2">
                <textarea
                  className={textareaClass}
                  rows={3}
                  value={draft.voice.verbalTics.join("\n")}
                  placeholder={"……罢了\n你懂什么"}
                  onChange={(e) =>
                    setVoice(
                      "verbalTics",
                      e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Labeled>
              <Labeled label="爱用词">
                <TagEditor
                  value={draft.voice.favoriteWords}
                  onChange={(v) => setVoice("favoriteWords", v)}
                  placeholder="规矩 / 账目…"
                />
              </Labeled>
              <Labeled label="绝不会说的话" hint="出现即出戏的表达">
                <TagEditor
                  tone="danger"
                  value={draft.voice.neverSays}
                  onChange={(v) => setVoice("neverSays", v)}
                  placeholder="人家啦 / 么么哒…"
                />
              </Labeled>
              <Labeled
                label="台词样例（few-shot）"
                hint="一行一句，AI 会照着这个语感写对白"
                className="sm:col-span-2"
              >
                <textarea
                  className={textareaClass}
                  rows={4}
                  value={draft.voice.sampleLines.join("\n")}
                  placeholder={"「你以为我想活着？」\n「笔在我手里，我说了算。」"}
                  onChange={(e) =>
                    setVoice(
                      "sampleLines",
                      e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Labeled>
            </div>
            <datalist id="nf-register-presets">
              {REGISTER_PRESETS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </SectionCard>

          <SectionCard
            title="外貌"
            hint="别人第一眼会注意到什么"
            icon={<Eye className="size-4 opacity-60" />}
            dirty={dirtyOf("appearance")}
            saving={savingSection === "appearance"}
            onSave={() => void save("appearance")}
          >
            <textarea
              className={textareaClass}
              rows={4}
              value={draft.appearance}
              placeholder="身高体型、面部特征、惯常穿着、随身物件、走路的样子…"
              onChange={(e) => set("appearance", e.target.value)}
            />
          </SectionCard>

          <SectionCard
            title="性格"
            hint="他在压力下的默认反应"
            icon={<Lightbulb className="size-4 opacity-60" />}
            dirty={dirtyOf("personality")}
            saving={savingSection === "personality"}
            onSave={() => void save("personality")}
          >
            <textarea
              className={textareaClass}
              rows={4}
              value={draft.personality}
              placeholder="待人接物的方式、在意什么、被冒犯时的反应、说话与沉默的节奏…"
              onChange={(e) => set("personality", e.target.value)}
            />
          </SectionCard>

          <SectionCard
            title="欲望 · 需要 · 恐惧 · 缺陷"
            hint="这四项决定人物在关键节点会怎么选"
            icon={<Heart className="size-4 opacity-60" />}
            dirty={dirtyOf("drive")}
            saving={savingSection === "drive"}
            onSave={() => void save("drive")}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="欲望（表层想要）" hint="他自己以为想要的东西：复仇、钱、被认可…">
                <textarea
                  className={textareaClass}
                  rows={3}
                  value={draft.want}
                  onChange={(e) => set("want", e.target.value)}
                />
              </Labeled>
              <Labeled label="需要（深层缺失）" hint="他真正缺的东西：被爱、被原谅、允许自己活下去…">
                <textarea
                  className={textareaClass}
                  rows={3}
                  value={draft.need}
                  onChange={(e) => set("need", e.target.value)}
                />
              </Labeled>
              <Labeled label="恐惧" hint="最怕发生什么？">
                <textarea
                  className={textareaClass}
                  rows={3}
                  value={draft.fear}
                  onChange={(e) => set("fear", e.target.value)}
                />
              </Labeled>
              <Labeled label="缺陷" hint="会主动把他推向深渊的性格弱点">
                <textarea
                  className={textareaClass}
                  rows={3}
                  value={draft.flaw}
                  onChange={(e) => set("flaw", e.target.value)}
                />
              </Labeled>
            </div>
          </SectionCard>

          <SectionCard
            title="人物弧光"
            hint="从开篇的状态走到结尾的状态"
            icon={<Zap className="size-4 opacity-60" />}
            dirty={dirtyOf("arc")}
            saving={savingSection === "arc"}
            onSave={() => void save("arc")}
          >
            <textarea
              className={textareaClass}
              rows={3}
              value={draft.arc}
              placeholder="开篇：只为复仇而活 → 结尾：明白复仇之后要自己决定怎么活"
              onChange={(e) => set("arc", e.target.value)}
            />
            <div className="mt-3">
              <Labeled label="秘密" hint="读者或其他角色还不知道的事">
                <textarea
                  className={textareaClass}
                  rows={3}
                  value={draft.secrets}
                  onChange={(e) => set("secrets", e.target.value)}
                />
              </Labeled>
            </div>
          </SectionCard>

          <SectionCard
            title="能力"
            hint="技能、特长、资源、限制"
            icon={<Target className="size-4 opacity-60" />}
            dirty={dirtyOf("abilities")}
            saving={savingSection === "abilities"}
            onSave={() => void save("abilities")}
          >
            <TagEditor
              value={draft.abilities}
              onChange={(v) => set("abilities", v)}
              placeholder="过目不忘 / 一手好字 / 不会游泳…"
              emptyHint="回车添加一条，例如「辨认真迹」"
            />
          </SectionCard>

          <SectionCard
            title="背景"
            hint="他是怎么变成现在这样的"
            dirty={dirtyOf("background")}
            saving={savingSection === "background"}
            onSave={() => void save("background")}
          >
            <textarea
              className={textareaClass}
              rows={5}
              value={draft.background}
              placeholder="出身、关键经历、与其它角色的旧账…"
              onChange={(e) => set("background", e.target.value)}
            />
          </SectionCard>
        </div>

        {/* ---------- 侧栏：只读统计与需要即时生效的编辑 ---------- */}
        <div className="space-y-4">
          <AppearancePanel characterId={character.id} projectId={projectId} />
          <MilestonePanel character={character} projectId={projectId} />
          <RelationshipPanel projectId={projectId} characterId={character.id} />
          <Card className="p-4 text-[11px] leading-relaxed opacity-55">
            小提示：里程碑、关系、出场统计是即时保存的；上面每一块设定改完记得点该卡片右上角的「保存」。
          </Card>
        </div>
      </div>

      <AiFillDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        projectId={projectId}
        character={character}
        onApplied={applyAi}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除人物"
        description={
          <>
            确定删除「{character.name}」吗？该角色的关系、出场统计与里程碑会一起删除，此操作不可撤销。
          </>
        }
        isPending={deleting}
        onConfirm={() => void remove()}
      />
    </PageScaffold>
  );
}
