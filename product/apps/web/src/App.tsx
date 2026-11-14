import { useEffect, useState } from 'react';
import { RoomFlow } from './RoomFlow.tsx';

interface Session { id: string; nickname: string; expiresAt: string }
const modes = [
  ['sync', '双人同步练', '两台手机，一人表达，一人复述'],
  ['solo', '双座位自练', '一个人交棒练习倾听与表达'],
  ['teen', '亲子同机练', '监护人和孩子轮流使用同一台手机'],
  ['async', '异步留言练', '先留下表达，搭档稍后再复述'],
] as const;

async function readOrCreateSession(): Promise<Session> {
  let response = await fetch('/api/me', { credentials: 'same-origin' });
  if (response.status === 401) {
    response = await fetch('/api/sessions/anonymous', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
  }
  if (!response.ok) throw new Error('暂时无法建立会话，请检查网络后重试。');
  return response.json() as Promise<Session>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readOrCreateSession().then(value => { if (live) setSession(value); }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : '网络异常'); });
    return () => { live = false; };
  }, []);
  return <div className="shell">
    <header className="top"><span className="mark">↗</span><strong>回声训练室</strong><span className="status">正式版开发中</span></header>
    <main>
      <p className="eyebrow">LISTEN · RETELL · UNDERSTAND</p>
      <h1>把听到的，<br /><em>再说清楚。</em></h1>
      <p className="lead">先复述，不评价。逐条确认说出去的和听到的差在哪里。</p>
      {error ? <div className="notice" role="alert">{error}<button type="button" onClick={() => location.reload()}>重试</button></div> :
        <div className="notice">{session ? `匿名会话已建立 · ${session.nickname}` : '正在建立安全会话…'}</div>}
      <h2>选择练法</h2>
      <div className="modes">{modes.map(([key, title, description]) => <button type="button" key={key} onClick={() => setSelected(key)} aria-pressed={selected === key}>
        <strong>{title}</strong><small>{description}</small>
      </button>)}</div>
      {session && <RoomFlow mode={selected} />}
    </main>
  </div>;
}
