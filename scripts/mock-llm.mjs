/**
 * 本地假模型服务（OpenAI 兼容），用于在没有 API Key 的情况下验证整条 AI 链路。
 * 启动：node scripts/mock-llm.mjs [port]
 * 行为：
 *   GET  /v1/models            → 返回一个模型列表
 *   POST /v1/chat/completions  → 支持 stream 与 JSON 输出（按提示词里的关键词返回不同内容）
 * 所有响应都带 CORS 头，浏览器可直连。
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 8765);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const SAMPLE = [
  '雨在凌晨三点停了。',
  '沈砚把白布重新盖回去，手指在布面上停了一瞬——那点余温不像一具泡了三天的尸体该有的。',
  '「你听见了。」林晚站在门口，伞尖滴着水，「别否认，你刚才的表情和十二年前一模一样。」',
  '他没有回答。验尸房的铜钟在没有风的时候轻轻响了一下。',
];

function pickReply(body) {
  const text = JSON.stringify(body.messages ?? []);
  const wantsJson = /JSON/.test(text) || body.response_format !== undefined;
  if (wantsJson) {
    if (/issues/.test(text)) {
      return JSON.stringify({
        issues: [
          {
            kind: 'continuity',
            severity: 'warn',
            title: '铜钟响动与前文设定不一致',
            detail: '前文设定铜钟只在有人死亡时响，本段在无死亡事件时响了一次。',
            evidence: { quote: '验尸房的铜钟在没有风的时候轻轻响了一下' },
            conflictsWith: { label: '验尸官的规矩', quote: '铜钟只在死者出现时敲响' },
            suggestion: '改为「铜钟没有响」或补一个死者出现的理由。',
            fixPrompt: '把铜钟响动改成没有响，保留悬念。',
          },
        ],
      });
    }
    // 注意：text 是 JSON.stringify 之后的，引号都成了 \" —— 所以判断只能用
    // 不含引号的特征词（我第一版写了 /"characters"/ 永远匹配不上，白查一轮）。
    // 人物页的「AI 生成人物」（cast-gen 任务）
    if (/verbalTics/.test(text) && /characters/.test(text) && !/entities/.test(text)) {
      return JSON.stringify({
        characters: [
          {
            name: '温晚', role: 'deuteragonist', tagline: '永安堂的女药师，手里有半张旧方子',
            age: '二十七', gender: '女', appearance: '右手虎口有一道旧烫伤',
            personality: '表面圆滑周全，遇到药材的事绝不让步',
            want: '保住永安堂', need: '承认兄长死于自己的方子',
            fear: '再开错一次药', flaw: '凡事都自己扛，不肯求助',
            arc: '从独力支撑到学会把后背交给别人', secrets: '旧方子是她兄长留下的',
            aliases: ['温药师'],
            voice: { tone: '客气但疏离', verbalTics: ['这个方子'], favoriteWords: ['药性', '剂量'], neverSays: ['我认输'], register: '市井行话夹书面语', sampleLines: ['这个方子，我不改。'] },
          },
          {
            name: '陆断', role: 'antagonist', tagline: '海禁令执行官，相信沉默才是慈悲',
            age: '四十一', gender: '男', appearance: '总穿官服，袖口磨得发白',
            personality: '严苛到不近人情，对自己同样苛刻',
            want: '彻底封住遗言', need: '面对自己也曾听过不该听的遗言',
            fear: '海禁在自己手上破口', flaw: '把规则看得比人重',
            arc: '从铁面执法到亲手破例', secrets: '他的妻子死于一场被遗言揭穿的冤案',
            aliases: ['陆大人'],
            voice: { tone: '一句话说一半', verbalTics: ['按律'], favoriteWords: ['律例', '规矩'], neverSays: ['求'], register: '公文腔', sampleLines: ['按律，该封。'] },
          },
        ],
      });
    }
    // 世界观页的「AI 生成条目」（world-gen 任务）
    if (/entries/.test(text) && /importance/.test(text) && !/arcs/.test(text) && !/verbalTics/.test(text)) {
      return JSON.stringify({
        entries: [
          {
            title: '触骨', category: 'magic', importance: 5,
            body: '验尸官以指骨接触死者遗骨，可听见其最后一句话。触骨时不得佩戴任何金属，否则听到的是金属的震颤而非人声；每次触骨会让验尸官失去同日的一段记忆，失去哪一段无法选择。',
            tags: ['力量体系'],
          },
          {
            title: '海禁', category: 'politics', importance: 4,
            body: '雾港自十二年前起施行海禁：所有出港船只须登记，且不得载运"会说话的东西"。海禁令由执行官陆断执行，违者船只焚毁、船主充军。海禁的表面理由是防谍，实际是为了让某批遗言永远留在海上。',
            tags: ['制度'],
          },
        ],
      });
    }
    if (/characters/.test(text) && /entities/.test(text)) {
      return JSON.stringify({
        characters: [{ name: '周砚清', aliases: ['周法医'], role: 'minor', tagline: '退休的老验尸官', appearance: '左手缺了两根指头', personality: '话少，爱喝酒', evidence: '周法医把酒杯推过来' }],
        entities: [{ name: '铜钟', kind: 'item', summary: '验尸房里无人敲响却会响的钟' }],
        relationships: [],
        timeline: [{ title: '周砚清交出旧钥匙', inWorldTime: '第十二年·霜月', participants: ['周砚清'], location: '雾港', importance: 3 }],
        glossary: [{ canonical: '沈砚', variants: ['沈验尸', '老沈'] }],
        foreshadows: [{ title: '缺了两根指头的手', description: '老验尸官的旧伤', quote: '左手缺了两根指头', plannedPayoff: '' }],
      });
    }
    if (/arcs/.test(text) || /chapters/.test(text)) {
      return JSON.stringify({
        title: '雾港纪事',
        logline: '一个能听见死者遗言的验尸官，发现自己的名字出现在下一具尸体上。',
        themes: ['记忆与赎罪'],
        arcs: [
          {
            title: '第一卷 · 溺水的钟',
            kind: 'volume',
            summary: '三具无名尸把沈砚拖回十二年前的旧案。',
            goal: '查清尸体身份',
            conflict: '警局要求结案',
            outcome: '沈砚被停职',
            chapters: [
              { title: '第四章 钟声', summary: '沈砚在停职后重回验尸房。', goals: ['发现铜钟的异常'], tension: 4, hook: '钟自己响了' },
              { title: '第五章 旧钥匙', summary: '老验尸官交出一把钥匙。', goals: ['获得旧案物证'], tension: 3, hook: '钥匙上的血' },
            ],
          },
        ],
        beats: [
          { summary: '沈砚夜访验尸房', kind: 'hook', tension: 3 },
          { summary: '铜钟无风自响', kind: 'reveal', tension: 4 },
        ],
      });
    }
    return JSON.stringify({ directions: [{ title: '让死者说谎', premise: '遗言本身是假的', why: '推翻主角的能力前提', risk: '需要重新铺垫', examples: ['第四具尸体说出相反的证词'] }] });
  }
  return SAMPLE.join('');
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.url?.startsWith('/v1/models')) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-story-model', object: 'model' }, { id: 'mock-fast', object: 'model' }] }));
    return;
  }
  if (req.url?.startsWith('/v1/chat/completions') && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* ignore */
      }
      const reply = pickReply(body);
      if (body.stream) {
        res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const chunks = reply.match(/[\s\S]{1,12}/g) ?? [reply];
        let i = 0;
        const timer = setInterval(() => {
          if (i >= chunks.length) {
            clearInterval(timer);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          const payload = { choices: [{ delta: { content: chunks[i] }, index: 0 }] };
          res.write('data: ' + JSON.stringify(payload) + '\n\n');
          i += 1;
        }, 35);
        return;
      }
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'mock-1',
          object: 'chat.completion',
          model: body.model ?? 'mock-story-model',
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1200, completion_tokens: 260, total_tokens: 1460 },
        }),
      );
    });
    return;
  }
  res.writeHead(404, CORS);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock LLM listening on http://127.0.0.1:' + PORT + '/v1');
});
