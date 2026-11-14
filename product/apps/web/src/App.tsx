import { Component, useEffect, useState, type ReactNode } from 'react';
import { RoomFlow } from './RoomFlow.tsx';
import { boundedFetch as fetch } from './client.ts';

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

export function App() { return <PageBoundary><TrainingApp /></PageBoundary>; }

class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main role="alert"><p>页面加载出错，会话仍保留。</p><button onClick={() => location.reload()}>重新打开</button></main> : this.props.children;
  }
}

function TrainingApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [records, setRecords] = useState<{ id: string; topic: string; mode: string; finishedAt: string; total: number; complete: number; accurate: number }[]>([]);
  const [historyStatus, setHistoryStatus] = useState('');
  const [inRoom, setInRoom] = useState(() => Boolean(new URLSearchParams(location.search).get('room') || new URLSearchParams(location.hash.slice(1)).get('invite')));
  useEffect(() => {
    let live = true;
    void readOrCreateSession().then(value => { if (live) setSession(value); }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : '网络异常'); });
    return () => { live = false; };
  }, []);
  return <div className="shell">
    <header className="top"><span className="mark">↗</span><strong>回声训练室</strong><span className="status">动态 Demo 版</span></header>
    <main>
      {!window.isSecureContext && <p role="alert" className="notice">请通过 HTTPS 打开训练室，才能使用麦克风。</p>}
      {!selected && !inRoom && !historyOpen && <><h1>让“听懂了”，<br /><em>变成真的听懂。</em></h1>
      <p className="lead">先复述，不评价。逐条确认说出去的和听到的差在哪里。</p></>}
      {error ? <div className="notice" role="alert">{error}<button type="button" onClick={() => location.reload()}>重试</button></div> :
        <div className="notice">{session ? `匿名会话已建立 · ${session.nickname}` : '正在建立安全会话…'}</div>}
      {!selected && !inRoom && !historyOpen && <><h2>选择练法</h2>
      <div className="modes">{modes.map(([key, title, description]) => <button type="button" key={key} disabled={!session || key === 'teen'} onClick={() => { setSelected(key); window.scrollTo(0, 0); }}>
        <strong>{title}</strong><small>{key === 'teen' ? '暂未开放' : description}</small>
      </button>)}</div><button className="secondary" disabled={!session} onClick={async () => {
        setHistoryOpen(true); setHistoryStatus('正在读取复盘…');
        try {
          const response = await fetch('/api/history');
          if (!response.ok) throw new Error();
          setRecords(await response.json()); setHistoryStatus('');
        } catch { setHistoryStatus('复盘暂时无法读取，请返回后重试。'); }
      }}>复盘记录</button></>}
      {historyOpen && <section><button className="text-button" onClick={() => setHistoryOpen(false)}>← 返回首页</button><h2>复盘记录</h2>
        {historyStatus ? <p role="status">{historyStatus}</p> : !records.length ? <p>归档一轮后可在这里查看记录。</p> : records.map(record =>
          <div className="card" key={record.id}><strong>{record.topic} · {modes.find(([key]) => key === record.mode)?.[1]}</strong>
            <p>{new Date(record.finishedAt).toLocaleString()} · 完整 {record.complete}/{record.total} · 准确 {record.accurate}/{record.total}</p></div>)}
      </section>}
      {selected && !inRoom && <button className="text-button" onClick={() => setSelected(null)}>← 返回首页</button>}
      {session && <RoomFlow mode={selected} onRoomChange={setInRoom} />}
    </main>
  </div>;
}
