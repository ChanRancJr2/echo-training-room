import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export interface ComparePoint { id: string; category: string; text: string }
export interface ComparedPoint {
  id: string;
  complete: boolean;
  accurate: boolean;
  listenerQuote: string;
  tag: string | null;
  clarification: string | null;
}

const supportedTags = new Set(['遗漏重要信息', '理解不到位', '理解偏了', '杜撰信息', '强加信息', '语气被误解', '重点被误解']);
const answer = z.object({ items: z.array(z.object({
  id: z.string(), complete: z.boolean(), accurate: z.boolean(), listenerQuote: z.string().max(500),
  tag: z.string().nullable(), clarification: z.string().nullable(),
}).strict()).max(12) }).strict();
const transcriptAnswer = z.object({ result: z.object({ text: z.string().default('') }).optional() }).passthrough();
type Fetcher = typeof fetch;

function timeout(seconds: number): AbortSignal { return AbortSignal.timeout(seconds * 1000); }
function fallback(point: ComparePoint): ComparedPoint {
  return { id: point.id, complete: false, accurate: false, listenerQuote: '', tag: '遗漏重要信息', clarification: null };
}

export function normalizeComparison(points: ComparePoint[], raw: unknown): ComparedPoint[] {
  const parsed = answer.parse(raw);
  const unique = new Map<string, z.infer<typeof answer>['items'][number]>();
  for (const item of parsed.items) {
    if (unique.has(item.id)) throw new Error('Duplicate comparison point');
    unique.set(item.id, item);
  }
  if ([...unique.keys()].some(id => !points.some(point => point.id === id))) throw new Error('Unknown comparison point');
  return points.map(point => {
    const item = unique.get(point.id);
    if (!item) return fallback(point);
    const complete = item.complete;
    const accurate = complete && item.accurate;
    const tag = complete && accurate ? null : supportedTags.has(item.tag ?? '') ? item.tag : '理解不到位';
    return { id: point.id, complete, accurate, listenerQuote: item.listenerQuote.trim(), tag,
      clarification: item.clarification?.trim().slice(0, 200) || null };
  });
}

export interface AiProvider {
  transcribe(mp3Url: string): Promise<string>;
  compare(points: ComparePoint[], listenerTranscript: string): Promise<ComparedPoint[]>;
}

export class VolcAiProvider implements AiProvider {
  private readonly settings: { speechKey: string; resourceId: string; arkKey: string; modelId: string };
  private readonly http: Fetcher;
  constructor(settings: { speechKey: string; resourceId: string; arkKey: string; modelId: string }, http: Fetcher = fetch) {
    this.settings = settings;
    this.http = http;
  }

  async transcribe(mp3Url: string): Promise<string> {
    const requestId = randomUUID();
    const headers = { 'Content-Type': 'application/json', 'X-Api-Key': this.settings.speechKey,
      'X-Api-Resource-Id': this.settings.resourceId, 'X-Api-Request-Id': requestId };
    const submit = await this.http('https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit', {
      method: 'POST', headers: { ...headers, 'X-Api-Sequence': '-1' }, signal: timeout(20),
      body: JSON.stringify({ user: { uid: requestId }, audio: { format: 'mp3', url: mp3Url }, request: { model_name: 'bigmodel' } }),
    });
    if (!submit.ok || submit.headers.get('X-Api-Status-Code') !== '20000000') throw new Error('SPEECH_SUBMIT_FAILED');
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const query = await this.http('https://openspeech.bytedance.com/api/v3/auc/bigmodel/query', {
        method: 'POST', headers, body: '{}', signal: timeout(20),
      });
      const status = query.headers.get('X-Api-Status-Code');
      if (status === '20000003') return '';
      if (query.ok && status === '20000000') return transcriptAnswer.parse(await query.json()).result?.text ?? '';
      if (status !== '20000001' && status !== '20000002') throw new Error('SPEECH_QUERY_FAILED');
    }
    throw new Error('SPEECH_TIMEOUT');
  }

  async compare(points: ComparePoint[], listenerTranscript: string): Promise<ComparedPoint[]> {
    if (!listenerTranscript.trim()) return points.map(fallback);
    const prompt = `请对照表达者确认的信息点与复述者转写，逐条给出辅助判断。只评价给出的信息点，不虚构原话。完整表示该点被复述；准确表示意思和条件均正确。listenerQuote 只截取复述转写中的对应原文，没有则为空。tag 在遗漏重要信息、理解不到位、理解偏了、杜撰信息、强加信息、语气被误解、重点被误解中选；无问题时为 null。clarification 是可能有争议时的一句澄清问题，无则为 null。返回 json 对象 {"items":[{"id":"...","complete":true,"accurate":true,"listenerQuote":"...","tag":null,"clarification":null}]}。\n信息点：${JSON.stringify(points)}\n复述转写：${listenerTranscript.slice(0, 8000)}`;
    const response = await this.http('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.settings.arkKey}` }, signal: timeout(60),
      body: JSON.stringify({ model: this.settings.modelId, messages: [{ role: 'user', content: prompt }], temperature: 0.1,
        thinking: { type: 'disabled' }, response_format: { type: 'json_object' } }),
    });
    if (!response.ok) throw new Error('ARK_COMPARE_FAILED');
    const body = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).passthrough().parse(await response.json());
    return normalizeComparison(points, JSON.parse(body.choices[0]!.message.content) as unknown);
  }
}
