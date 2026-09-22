import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/features/settings/SettingsPage.tsx';
let s = readFileSync(p, 'utf8');
const NL = String.fromCharCode(10);
const need = (f, l) => { if (!s.includes(f)) throw new Error('锚点未找到: ' + l); };

// 1) 组件内加"拉取模型列表"的状态与逻辑
need('  const [modelsText, setModelsText] = useState(provider.models.join("\n"));', 'modelsText 状态');
s = s.replace(
  '  const [modelsText, setModelsText] = useState(provider.models.join("\n"));',
  [
    '  const [modelsText, setModelsText] = useState(provider.models.join("\n"));',
    '  const [fetching, setFetching] = useState(false);',
    '  const [fetchNote, setFetchNote] = useState<string | null>(null);',
    '',
    '  /**',
    '   * 在弹窗里直接拉取模型列表。',
    '   *',
    '   * 以前只有保存到主界面之后、再往 Key 输入框里打字才会触发自动拉取 ——',
    '   * 而在弹窗里填完地址和 Key 却拿不到列表，是最需要它的时刻。',
    '   *',
    '   * 探测用的是**草稿里的**地址与 Key（还没落库），所以不必先保存。',
    '   */',
    '  const fetchModels = async () => {
    '    setFetching(true);',
    '    setFetchNote(null);',
    '    try {',
    '      const res = await probeProvider({ ...draft, baseUrl: draft.baseUrl.trim(), apiKey: (draft.apiKey ?? "").trim() });',
    '      if (!res.ok) {',
    '        setFetchNote("拉取失败：" + res.message);',
    '        return;',
    '      }',
    '      const found = res.models ?? [];',
    '      if (found.length === 0) {',
    '        setFetchNote("连接正常，但该服务没有返回模型列表，请手动填写");',
    '        return;',
    '      }',
    '      // 与已填内容合并去重，保留顺序：先已有的，再新增的',
    '      const existing = modelsText.split("\n").map((m) => m.trim()).filter(Boolean);',
    '      const merged = [...existing];',
    '      let added = 0;',
    '      for (const m of found) if (!merged.includes(m)) { merged.push(m); added++; }',
    '      setModelsText(merged.join("\n"));',
    '      setFetchNote(' + '"拉取到 " + found.length + " 个模型"' + ' + (added ? "，新增 " + added + " 个" : "，列表已是最新"));',
    '    } catch (e) {',
    '      setFetchNote("拉取失败：" + (e instanceof Error ? e.message : String(e)));',
    '    } finally {',
    '      setFetching(false);',
    '    }',
    '  };',
  ].join(NL),
);

// 2) 移除协议类型下拉
const kindOld = [
  '        <div>',
  '          <Label className="mb-1.5 block text-xs">协议类型</Label>',
  '          <select',
  '            value={draft.kind}',
  '            onChange={(e) => setDraft({ ...draft, kind: e.target.value as ProviderKind })}',
  '            className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"',
  '          >',
  '            {(["openai", "deepseek", "moonshot", "zhipu", "qwen", "siliconflow", "openrouter", "ollama", "lmstudio", "custom"] as ProviderKind[]).map(',
  '              (k) => (',
  '                <option key={k} value={k}>',
  '                  {k}',
  '                </option>',
  '              ),',
  '            )}',
  '          </select>',
  '        </div>',
].join(NL);
need(kindOld, '协议类型下拉');
s = s.replace(
  kindOld,
  [
    '        {/*',
    '          「协议类型」下拉已移除。',
    '          它只提供 openai / deepseek / ollama / custom 等标签，',
    '          但**非本地供应商全都走 OpenAI 兼容格式**，没有任何分支依赖它 ——',
    '          对用户来说是一个不知道该怎么选、也不影响结果的字段。',
    '          现在由接口地址自动推断（见 inferProviderKind），本地服务才需要区分。',
    '        */}',
  ].join(NL),
);

// 3) 模型列表加"拉取"按钮
const listOld = [
  '        <div>',
  '          <Label className="mb-1.5 block text-xs">模型列表（每行一个）</Label>',
  '          <TextArea rows={4} value={modelsText} onChange={(e) => setModelsText(e.target.value)} />',
  '        </div>',
].join(NL);
need(listOld, '模型列表');
s = s.replace(
  listOld,
  [
    '        <div>',
    '          <div className="mb-1.5 flex items-center justify-between gap-2">',
    '            <Label className="block text-xs">模型列表（每行一个）</Label>',
    '            <Button size="sm" variant="outline" isPending={fetching} onPress={() => void fetchModels()}>',
    '              <RefreshCw className="size-3.5" />',
    '              拉取模型列表',
    '            </Button>',
    '          </div>',
    '          <TextArea rows={4} value={modelsText} onChange={(e) => setModelsText(e.target.value)} />',
    '          {fetchNote && <p className="mt-1 text-[11px] opacity-65">{fetchNote}</p>}',
    '        </div>',
  ].join(NL),
);

writeFileSync(p, s);
console.log('弹窗已改：去掉协议类型、加入拉取按钮');
