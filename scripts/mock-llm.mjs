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
