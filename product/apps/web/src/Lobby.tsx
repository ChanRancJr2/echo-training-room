import { useRef, useState, type FormEvent } from 'react';
import { boundedFetch } from './client.ts';

const invalidInvite = '邀请无效或已过期，请让发起人重新生成';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function parseInvite(input: string): { token: string } | { code: string } | null {
  const trimmed = input.trim();
  if (tokenPattern.test(trimmed)) return { token: trimmed };
  const code = trimmed.replace(/\s/g, '').toUpperCase();
  if (/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return { code };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const token = new URLSearchParams(url.hash.slice(1)).get('invite') ?? url.searchParams.get('invite');
    return token && tokenPattern.test(token) ? { token } : null;
  } catch { return null; }
}

export function Lobby({ onCreate, onHistory, onJoin }: {
  onCreate: () => void; onHistory: () => void; onJoin: (id: string) => void;
}) {
  const [panel, setPanel] = useState<'join' | 'help' | null>(null);
  const [input, setInput] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const invitation = parseInvite(input);
    if (!invitation) { setError(invalidInvite); return; }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await boundedFetch('/api/rooms/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...invitation, ...(password ? { password } : {}) }),
      });
      if (response.status === 429) { setError('尝试过于频繁，请稍后再试。'); return; }
      if (!response.ok) { setError(response.status < 500 ? invalidInvite : '暂时无法连接，请稍后再试。'); return; }
      const { id } = await response.json() as { id: string };
      onJoin(id);
    } catch {
      setError('暂时无法连接，请稍后再试。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <section>
    <h1>训练大厅</h1>
    <div className="modes">
      <button type="button" disabled={busy} onClick={onCreate}>创建训练室</button>
      <button type="button" disabled={busy} aria-expanded={panel === 'join'} onClick={() => setPanel('join')}>用邀请链接或房间码加入</button>
      <button type="button" disabled={busy} onClick={onHistory}>我的复盘</button>
      <button type="button" disabled={busy} aria-expanded={panel === 'help'} onClick={() => setPanel('help')}>使用说明</button>
    </div>
    {panel === 'join' && <form className="card" onSubmit={event => void join(event)}>
      <label>邀请链接、令牌或 6 位房间码
        <input autoComplete="off" spellCheck={false} maxLength={2048} value={input}
          onChange={event => { setInput(event.target.value); setError(''); }}
          onBlur={() => { const parsed = parseInvite(input); if (parsed && 'code' in parsed) setInput(parsed.code); }} />
      </label>
      <label>邀请密码（如有）<input type="password" autoComplete="off" maxLength={100} value={password} onChange={event => setPassword(event.target.value)} /></label>
      {error && <p role="alert" className="error-text">{error}</p>}
      <button className="primary" disabled={busy} type="submit">{busy ? '正在加入…' : '加入'}</button>
    </form>}
    {panel === 'help' && <section className="card"><h2>使用说明</h2>
      <p>先复述，不评价。AI 结果用于辅助核对，不用于诊断。</p>
      <p>归档报告和录音会保留，房间创建者可在复盘中删除。</p>
    </section>}
  </section>;
}
