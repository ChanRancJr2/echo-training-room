import { Component, useEffect, useState, type ReactNode } from 'react';
import { RoomFlow } from './RoomFlow.tsx';
import { Lobby } from './Lobby.tsx';
import { History, type RecordSummary } from './History.tsx';
import { modes } from './flow.ts';
import { boundedFetch as fetch } from './client.ts';

interface Session { id: string; nickname: string; expiresAt: string; handoffRoomId?: string }
let sessionRequest: Promise<Session> | null = null;

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
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [historyStatus, setHistoryStatus] = useState('');
  const [inRoom, setInRoom] = useState(() => Boolean(new URLSearchParams(location.search).get('room') || new URLSearchParams(location.hash.slice(1)).get('invite')));
  const [lobby, setLobby] = useState(() => location.hash === '#/lobby' && !inRoom);
  const [fromLobby, setFromLobby] = useState(() => lobby || history.state?.fromLobby === true);
  useEffect(() => {
    const update = () => {
      const invitation = new URLSearchParams(location.hash.slice(1)).has('invite');
      const hasRoom = new URLSearchParams(location.search).has('room');
      setLobby(location.hash === '#/lobby' && !hasRoom);
      if (invitation && !hasRoom) { setSelected(null); setHistoryOpen(false); setInRoom(true); }
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    let live = true;
    sessionRequest ??= readOrCreateSession().finally(() => { sessionRequest = null; });
    void sessionRequest.then(value => {
      if (!live) return;
      if (value.handoffRoomId) {
        history.replaceState({}, '', `?room=${encodeURIComponent(value.handoffRoomId)}`);
        setLobby(false); setInRoom(true);
      }
      setSession(value);
    }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : '网络异常'); });
    return () => { live = false; };
  }, []);
  const openHistory = async () => {
    setHistoryOpen(true); setHistoryStatus('正在读取复盘…');
    try {
      const response = await fetch('/api/history');
      if (!response.ok) throw new Error();
      setRecords(await response.json()); setHistoryStatus('');
    } catch { setHistoryStatus('复盘暂时无法读取，请返回后重试。'); }
  };
  const returnToLobby = () => {
    setSelected(null);
    history.replaceState({}, '', location.pathname + '#/lobby');
    setLobby(true);
  };
  const onRoomChange = (active: boolean) => {
    setInRoom(active);
    if (!active) setSelected(null);
    if (active && fromLobby) queueMicrotask(() => history.replaceState({ fromLobby: true }, ''));
    if (!active && fromLobby) returnToLobby();
  };
  return <div className="shell">
    <header className="top"><span className="mark">↗</span><strong>回声训练室</strong><span className="status">动态 Demo 版</span></header>
    <main>
      {!window.isSecureContext && <p role="alert" className="notice">请通过 HTTPS 打开训练室，才能使用麦克风。</p>}
      {!selected && !inRoom && !historyOpen && !lobby && <><h1>让“听懂了”，<br /><em>变成真的听懂。</em></h1>
      <p className="lead">先复述，不评价。逐条确认说出去的和听到的差在哪里。</p></>}
      {error ? <div className="notice" role="alert">{error}<button type="button" onClick={() => location.reload()}>重试</button></div> :
        <div className="notice">{session ? `匿名会话已建立 · ${session.nickname}` : '正在建立安全会话…'}</div>}
      {session && lobby && !historyOpen && <Lobby
        onCreate={() => { setFromLobby(true); history.replaceState({}, '', location.pathname); setLobby(false); }}
        onHistory={() => void openHistory()}
        onJoin={id => {
          history.replaceState({ fromLobby: true }, '', `?room=${encodeURIComponent(id)}`);
          setFromLobby(true); setInRoom(true); setLobby(false);
        }} />}
      {!selected && !inRoom && !historyOpen && !lobby && <><h2>选择练法</h2>
      <div className="modes">{modes.map(([key, title, description]) => <button type="button" key={key} disabled={!session} onClick={() => { setSelected(key); window.scrollTo(0, 0); }}>
        <strong>{title}</strong><small>{description}</small>
      </button>)}</div><button className="secondary" disabled={!session} onClick={() => void openHistory()}>复盘记录</button>
      <a href="#/lobby" onClick={() => setFromLobby(true)}>训练大厅</a></>}
      {historyOpen && <History records={records} status={historyStatus} onBack={() => setHistoryOpen(false)} onDeleted={openHistory} />}
      {selected && !inRoom && <button className="text-button" onClick={() => setSelected(null)}>← 返回首页</button>}
      {session && !lobby && !historyOpen && <RoomFlow mode={selected} onRoomChange={onRoomChange} />}
    </main>
  </div>;
}
