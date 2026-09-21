/**
 * 向量（embedding）模型目录与 Ollama 管理。
 *
 * 为什么要有这份清单：embedding 的选择对作者来说是个陌生的东西 ——
 * 大部分人不知道 nomic-embed-text 和 bge-m3 有什么区别，也不知道哪个支持中文。
 * 直接给一个空输入框让人手填模型名，等于把"选错模型"的风险丢给作者。
 * 所以这里给出一份精选清单，标注语言、体积、维度，并标注推荐项。
 *
 * 全部是开源、免费、可离线跑的模型。Ollama 能直接 pull，不需要任何 key。
 */

export interface EmbeddingModelInfo {
  /** Ollama 上的模型名（也是 pull 时用的名字） */
  name: string;
  /** 展示名 */
  label: string;
  /** 参数量，粗略反映速度与质量 */
  params: string;
  /** 磁盘占用（约） */
  size: string;
  /** 向量维度 */
  dim: number;
  /** 中文支持程度 */
  chinese: '优秀' | '良好' | '一般';
  /** 为什么选它 / 什么时候不要选它 */
  note: string;
  /** 中文写作场景的推荐度 */
  recommended?: boolean;
}

/**
 * 精选清单。排序即推荐顺序。
 *
 * 取舍依据：中文写作的记忆条目多为短句（几十字），
 * 所以「中文语义质量」优先于「维度高」—— 维度高只增加存储和计算，不提升短句区分度。
 */
export const EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  {
    name: 'bge-m3',
    label: 'BGE-M3',
    params: '568M',
    size: '约 1.2 GB',
    dim: 1024,
    chinese: '优秀',
    note: '中文语义质量最好的一档，多语言，支持长文本。缺点是体积较大、首次加载慢。中文写作首选。',
    recommended: true,
  },
  {
    name: 'nomic-embed-text',
    label: 'Nomic Embed Text',
    params: '137M',
    size: '约 274 MB',
    dim: 768,
    chinese: '良好',
    note: '体积小、速度快，英文为主但中文可用。机器一般或想快速试水时选它。',
  },
  {
    name: 'quentinz/bge-large-zh-v1.5',
    label: 'BGE Large 中文 v1.5',
    params: '326M',
    size: '约 1.3 GB',
    dim: 1024,
    chinese: '优秀',
    note: '专门为中文训练的版本，中文短句区分度很好。只在中文场景下用。',
  },
  {
    name: 'snowflake-arctic-embed2',
    label: 'Snowflake Arctic Embed 2',
    params: '568M',
    size: '约 1.2 GB',
    dim: 1024,
    chinese: '良好',
    note: '多语言长文本表现好，稳定性高。中英混排的稿子可以考虑。',
  },
  {
    name: 'mxbai-embed-large',
    label: 'MixedBread Embed Large',
    params: '335M',
    size: '约 670 MB',
    dim: 1024,
    chinese: '一般',
    note: '英文检索很强，中文较弱。纯英文写作才建议选。',
  },
  {
    name: 'all-minilm',
    label: 'All-MiniLM',
    params: '23M',
    size: '约 46 MB',
    dim: 384,
    chinese: '一般',
    note: '极小极快，适合先验证流程能不能跑通。中文效果一般，正式用不建议。',
  },
];

export function findModel(name: string): EmbeddingModelInfo | undefined {
  return EMBEDDING_MODELS.find((m) => m.name === name || m.name.endsWith('/' + name));
}

/** Ollama 的根地址：把用户填的端点（可能是 /api/embeddings）归一到 origin */
export function ollamaOrigin(endpoint: string): string {
  const raw = (endpoint || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
  try {
    const u = new URL(raw.includes('://') ? raw : 'http://' + raw);
    return u.origin;
  } catch {
    return 'http://127.0.0.1:11434';
  }
}

export interface OllamaStatus {
  reachable: boolean;
  /** 已安装的模型名 */
  installed: string[];
  version?: string;
  message?: string;
}

/**
 * 探测 Ollama 是否在运行，并列出已安装的模型。
 *
 * 注意 CORS：Ollama 默认只接受同源请求，浏览器从开发服务器（另一个端口）调用会被拦。
 * 这不是我们的 bug，是 Ollama 的默认安全设置，必须让作者知道怎么改（设置面板里有提示）。
 */
export async function probeOllama(endpoint: string, timeoutMs = 2500): Promise<OllamaStatus> {
  const origin = ollamaOrigin(endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(origin + '/api/tags', { signal: ctrl.signal });
    if (!res.ok) return { reachable: false, installed: [], message: 'Ollama 返回 ' + res.status };
    const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
    const installed = (data.models ?? [])
      .map((m) => m.name ?? m.model ?? '')
      .filter(Boolean)
      .sort();
    return { reachable: true, installed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      reachable: false,
      installed: [],
      message: /abort/i.test(msg)
        ? '连不上 Ollama（' + origin + '）。确认它已启动：ollama serve'
        : '连不上 Ollama：' + msg + '。若 Ollama 已启动，多半是跨域被拦，需要设置 OLLAMA_ORIGINS',
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
  /** 0~100，无法计算时为 undefined */
  percent?: number;
  done: boolean;
  error?: string;
}

/**
 * 拉取（下载）一个模型。
 *
 * Ollama 的 /api/pull 是流式的 NDJSON：每行一个进度对象。
 * 这里解析成回调，让界面能显示"下载了多少"——几百 MB 的下载没有进度条是不可接受的。
 */
export async function pullOllamaModel(
  endpoint: string,
  model: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  const origin = ollamaOrigin(endpoint);
  try {
    const res = await fetch(origin + '/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: '拉取失败（HTTP ' + res.status + '）' + (text ? '：' + text.slice(0, 150) : '') };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastError: string | undefined;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: { status?: string; completed?: number; total?: number; error?: string };
        try {
          obj = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (obj.error) lastError = obj.error;
        const percent =
          typeof obj.completed === 'number' && typeof obj.total === 'number' && obj.total > 0
            ? Math.round((obj.completed / obj.total) * 100)
            : undefined;
        onProgress({ status: obj.status ?? '', completed: obj.completed, total: obj.total, percent, done: false });
      }
    }
    if (lastError) return { ok: false, error: lastError };
    onProgress({ status: 'success', done: true, percent: 100 });
    return { ok: true };
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: '已取消' };
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: '拉取中断：' + msg };
  }
}

/** 人类可读的字节数 */
export function formatBytes(n?: number): string {
  if (typeof n !== 'number' || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + units[i];
}
