import { useEffect, useRef, useState } from 'react';
import { boundedFetch as fetch, newRequestId } from './client.ts';
import { Recorder } from './Recorder.tsx';
import { AudioPlayer } from './AudioPlayer.tsx';
import { PointEditor } from './PointEditor.tsx';
import { ComparisonView } from './ComparisonView.tsx';

type Room = { id: string; version: number; mode: string; status: string; durationSeconds: number; retellStyle: string; topic: string; roundId: string | null; stage: string | null; terminalReason?: string | null; roundVersion: number | null; activeSeat: 'speaker' | 'listener' | null; deadlineAt: string | null; speakerAudioId: string | null; listenerAudioId: string | null; you: { role: 'speaker' | 'listener' | 'observer'; ready: boolean }; members: { id: string; nickname: string; role: string; ready: boolean }[] };
const names = { speaker: '表达者', listener: '复述者', observer: '观察者' };
const messages: Record<string, string> = {
  RATE_LIMITED: '操作太频繁，请稍后再试。',
  ORIGIN_DENIED: '请通过训练室的正式 HTTPS 地址打开。',
  STALE_VERSION: '房间状态已更新，请确认后重试。',
  INVITATION_EXPIRED: '邀请已使用或过期，请让表达者重新生成。',
  INVITATION_PASSWORD: '邀请密码不正确。',
  ROOM_NOT_JOINABLE: '本轮已开始，暂时无法加入。',
  ROOM_CLOSED: '训练室已关闭。',
  PLAYERS_NOT_READY: '请等表达者和复述者都准备好。',
  NOT_ROOM_MEMBER: '你已离开或训练室已关闭。',
  UNAUTHENTICATED: '会话已过期，请刷新页面。',
};
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
async function call<T>(path: string, body?: object): Promise<T> {
  const options: RequestInit = { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
  const retryable = body === undefined || path === '/api/rooms' || path === '/api/rooms/join' || path.endsWith('/ready') || path.endsWith('/next-round');
  let response: Response | null = null;
  for (let attempt = 0; attempt < (retryable ? 3 : 1); attempt++) {
    try { response = await fetch(path, options); }
    catch { response = null; }
    if (response && ![502, 503, 504].includes(response.status)) break;
    if (retryable && attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
  }
  if (!response) throw new Error('网络暂时中断，请稍后重试。');
  if (!response.ok) {
    const code = ((await response.json().catch(() => ({}))) as { error?: string }).error;
    throw new HttpError(response.status, code ? messages[code] ?? '操作失败，请稍后重试。' : `网络请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export function RoomFlow({ mode, onRoomChange }: { mode: string | null; onRoomChange: (active: boolean) => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [inviteRole, setInviteRole] = useState<'listener' | 'observer'>('listener');
  const [inviteMinutes, setInviteMinutes] = useState(60);
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteOnce, setInviteOnce] = useState(true);
  const [shareUrl, setShareUrl] = useState('');
  const running = useRef(false);
  const createKey = useRef<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [retellStyle, setRetellStyle] = useState<'auditory' | 'keywords'>('auditory');
  const [topic, setTopic] = useState('家庭日常');
  const [customTopic, setCustomTopic] = useState('');
  const refresh = async (id: string, restore = false) => {
    const incoming = await call<Room>(`/api/rooms/${id}`);
    setRoom(current => restore ? incoming : current?.id === id && (
      incoming.version > current.version ||
      (incoming.version === current.version && incoming.roundId === current.roundId && (incoming.roundVersion ?? 0) > (current.roundVersion ?? 0))
    ) ? incoming : current);
    setReconnecting(false);
  };
  useEffect(() => {
    const incoming = new URLSearchParams(location.hash.slice(1)).get('invite');
    if (incoming) { setToken(incoming); return; }
    const id = new URLSearchParams(location.search).get('room');
    if (id) void refresh(id, true).catch(cause => {
      setError(cause instanceof Error ? cause.message : '训练室恢复失败，请刷新重试。');
      if (cause instanceof HttpError && [401, 403, 404].includes(cause.status)) {
        history.replaceState({}, '', location.pathname);
        onRoomChange(false);
      }
    });
  }, []);
  useEffect(() => {
    if (!room) return;
    let live = true;
    let timer: number;
    const poll = async () => { await refresh(room.id).catch(cause => {
      if (!live) return;
      if (cause instanceof HttpError && [401, 403, 404].includes(cause.status)) {
        setRoom(null); setError('训练室已关闭或会话已失效'); history.replaceState({}, '', location.pathname); onRoomChange(false);
      } else setReconnecting(true);
    }); if (live) timer = window.setTimeout(poll, 2000); };
    timer = window.setTimeout(poll, 2000);
    return () => { live = false; clearTimeout(timer); };
  }, [room?.id, room?.status]);
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { running.current = false; setBusy(false); }
  }
  const create = () => void run(async () => {
    if (!mode) return;
    createKey.current ??= newRequestId();
    const result = await call<{ state: Room; inviteToken: string | null }>('/api/rooms', { mode, createKey: createKey.current, durationSeconds, retellStyle, topic: topic === '自定义填写' ? customTopic.trim() : topic });
    createKey.current = null;
    setRoom(result.state); setInvite(result.inviteToken); setShareUrl(''); onRoomChange(true); history.replaceState({}, '', `?room=${result.state.id}`);
  });
  const join = () => void run(async () => {
    const state = await call<Room>('/api/rooms/join', { token, password: password || null });
    setRoom(state); setToken(null); onRoomChange(true); history.replaceState({}, '', `?room=${state.id}`);
  });
  const ready = () => void run(async () => { if (room) setRoom(await call<Room>(`/api/rooms/${room.id}/ready`, { ready: !room.you.ready })); });
  const start = () => void run(async () => { if (room) setRoom(await call<Room>(`/api/rooms/${room.id}/start`, {})); });
  const prepareNext = () => void run(async () => {
    if (!room?.roundId || !room.roundVersion) return;
    setRoom(await call<Room>(`/api/rooms/${room.id}/next-round`, { roundId: room.roundId, expectedVersion: room.roundVersion }));
  });
  const roundRole = room?.mode === 'solo' ? room.activeSeat ?? room.you.role : room?.you.role;
  const beginRecording = async (kind: 'speaker' | 'listener') => {
    if (!room?.roundId || !room.roundVersion) throw new Error('轮次状态尚未恢复');
    const firstRecording = kind === 'speaker' && room.stage === 'TASK';
    if (kind === 'listener') player.current?.pause();
    try {
      const result = await call<{ version: number; stage: string; deadlineAt: string }>(`/api/rounds/${room.roundId}/${firstRecording ? 'task' : 'restart-recording'}`,
        firstRecording ? { expectedVersion: room.roundVersion } : { expectedVersion: room.roundVersion, kind });
      setRoom(current => current?.roundId === room.roundId && (current.roundVersion ?? 0) < result.version
        ? { ...current, roundVersion: result.version, stage: result.stage, deadlineAt: result.deadlineAt } : current);
      void refresh(room.id).catch(() => setReconnecting(true));
      return result.version;
    } catch (cause) {
      void refresh(room.id).catch(() => setReconnecting(true));
      throw cause;
    }
  };
  const leave = () => void run(async () => { if (room) { await call(`/api/rooms/${room.id}/leave`, {}); setRoom(null); setInvite(null); setShareUrl(''); setInviteRole('listener'); onRoomChange(false); history.replaceState({}, '', location.pathname); } });
  const makeInvite = (role: 'listener' | 'observer') => void run(async () => {
    if (!room) return;
    const { token } = await call<{ token: string }>(`/api/rooms/${room.id}/invitations`, { role, minutes: inviteMinutes, maxUses: inviteOnce ? 1 : 10, password: invitePassword || null });
    setInvite(token);
    setShareUrl(`${location.origin}/#invite=${token}`);
  });
  const share = () => void run(async () => {
    if (!invite) return;
    const url = `${location.origin}${location.pathname}#invite=${invite}`;
    setShareUrl(url);
    try { if (navigator.share) await navigator.share({ title: '回声训练室邀请', url }); else await navigator.clipboard?.writeText(url); }
    catch { /* The selectable link remains available. */ }
  });
  return <section className="room-flow">
    {error && <div role="alert" className="notice error">{error}</div>}
    {room && reconnecting && <div role="status" className="notice">网络暂时中断，正在恢复训练室状态…</div>}
    {token && !room && <div className="card"><h2>加入训练室</h2><p>邀请决定你的座位。若有密码，请先填写。</p><input aria-label="邀请密码" type="password" value={password} onChange={event => setPassword(event.target.value)} /><button className="primary" disabled={busy} onClick={join}>加入</button></div>}
    {!token && !room && mode && <div className="card"><h2>创建训练室</h2><p>{mode === 'teen' ? '该练法的正式流程仍在开发，请先查看可点击原型。' : '选择本轮主题、发言时长和复述方式。'}</p>
      <strong>本轮主题</strong><div className="option-grid">{['家庭日常', '大学生活', '疾病与需求', '工作需求', '自定义填写'].map(value => <button key={value} className={topic === value ? 'chosen' : ''} onClick={() => setTopic(value)}>{value}</button>)}</div>
      {topic === '自定义填写' && <input aria-label="自定义主题" maxLength={80} placeholder="填写本轮主题" value={customTopic} onChange={event => setCustomTopic(event.target.value)} />}
      <strong>每人发言时长</strong><div className="option-grid">{[[30, '30 秒'], [60, '1 分钟'], [120, '2 分钟'], [300, '5 分钟']].map(([value, label]) => <button key={value} className={durationSeconds === value ? 'chosen' : ''} onClick={() => setDurationSeconds(Number(value))}>{label}</button>)}</div>
      <strong>复述方式</strong><div className="option-grid">{[['auditory', '纯听觉'], ['keywords', '关键词辅助']].map(([value, label]) => <button key={value} className={retellStyle === value ? 'chosen' : ''} onClick={() => setRetellStyle(value as 'auditory' | 'keywords')}>{label}</button>)}</div>
      <button className="primary" disabled={busy || mode === 'teen' || (topic === '自定义填写' && !customTopic.trim())} onClick={create}>创建训练室</button></div>}
    {room && <div className="card"><h2>{room.status === 'WAITING' ? '准备好，慢慢开始' : '本轮已开始'}</h2><p>你的座位：{names[room.you.role]} · {room.topic} · {room.durationSeconds} 秒 · {room.retellStyle === 'keywords' ? '关键词辅助' : '纯听觉'}</p>
      {(room.mode === 'solo' ? ['speaker'] as const : ['speaker', 'listener', 'observer'] as const).map(role => {
        const member = room.members.find(item => item.role === role);
        return <div className="member" key={role}><span>{names[role]}{member && ` · ${member.nickname}`}</span><b>{!member ? '待加入' : member.ready ? '已准备' : '未准备'}</b></div>;
      })}
      {room.status === 'WAITING' && <button className="primary" disabled={busy} onClick={ready}>{room.you.ready ? '取消准备' : '准备好了'}</button>}
      {room.status === 'WAITING' && room.you.role === 'speaker' && <button className="secondary" disabled={busy || !room.members.some(m => m.role === 'speaker' && m.ready) || (room.mode !== 'solo' && !room.members.some(m => m.role === 'listener' && m.ready))} onClick={start}>开始本轮</button>}
      {room.status === 'ACTIVE' && <div className="notice">轮次 {room.roundId?.slice(0, 8)} · {room.stage}</div>}
      {room.stage === 'TASK' && room.you.role === 'speaker' && <section><h2>定任务</h2><p>围绕「{room.topic}」讲清一个重点。每人 {room.durationSeconds} 秒。</p></section>}
      {room.stage === 'COMPARING' && <p className="notice" role="status">正在转写复述录音并生成逐条对照，请稍候。</p>}
      {room.stage === 'CANCELLED' && <p className="notice" role="status">{room.terminalReason === 'COMPARISON_FAILED' ? '本轮对照未能完成，请重新准备后开始一轮。' : '本轮已超时，请重新准备后开始一轮。'}</p>}
      {room.stage === 'ASYNC_PENDING' && <div className="notice">{room.you.role === 'listener' && room.roundId ? <button className="primary" disabled={busy} onClick={() => void run(async () => { await call(`/api/rounds/${room.roundId}/open-message`, { expectedVersion: room.roundVersion }); await refresh(room.id); })}>打开留言，开始复述</button> : '留言已准备好，等待复述者打开。'}</div>}
      {room.status === 'ACTIVE' && (room.stage === 'TASK' || room.stage === 'SPEAKER_RECORDING') && room.you.role === 'speaker' && room.roundId && room.roundVersion && <Recorder key={room.roundId + ':speaker'} roundId={room.roundId} kind="speaker" version={room.roundVersion} maxSeconds={room.durationSeconds} onBegin={() => beginRecording('speaker')} onCommitted={() => refresh(room.id)} />}
      {room.status === 'ACTIVE' && room.stage === 'KEYPOINT_CONFIRM' && room.you.role === 'speaker' && room.roundId && room.roundVersion && <PointEditor roundId={room.roundId} version={room.roundVersion} onConfirmed={() => refresh(room.id)} />}
      {room.status === 'ACTIVE' && room.speakerAudioId && room.roundId && room.stage !== 'SPEAKER_RECORDING' && roundRole !== 'speaker' && <AudioPlayer audioRef={player} key={room.roundId} roundId={room.roundId} audioId={room.speakerAudioId} />}
      {room.status === 'ACTIVE' && room.stage === 'LISTENER_RETELL' && roundRole === 'listener' && room.roundId && room.roundVersion && <Recorder key={room.roundId + ':listener'} roundId={room.roundId} kind="listener" version={room.roundVersion} maxSeconds={room.durationSeconds} onBegin={() => beginRecording('listener')} onCommitted={() => refresh(room.id)} />}
      {['SPEAKER_LABELING', 'MUTUAL_CONFIRM', 'ADVICE', 'ARCHIVED'].includes(room.stage ?? '') && room.roundId && room.roundVersion && <ComparisonView key={room.roundId} roundId={room.roundId} stage={room.stage!} version={room.roundVersion} role={roundRole ?? room.you.role} solo={room.mode === 'solo'} onChanged={() => refresh(room.id)} />}
      {room.stage === 'ADVICE' && room.you.role === 'speaker' && <button className="primary" disabled={busy} onClick={prepareNext}>归档并准备下一轮</button>}
      {room.status === 'WAITING' && room.you.role === 'speaker' && room.mode !== 'solo' && <section className="invite-card">
        <h2>邀请搭档</h2>
        <div className="option-grid" aria-label="邀请角色">
          <button className={inviteRole === 'listener' ? 'chosen' : ''} onClick={() => { setInviteRole('listener'); setInvite(null); setShareUrl(''); }}>复述者</button>
          <button className={inviteRole === 'observer' ? 'chosen' : ''} onClick={() => { setInviteRole('observer'); setInvite(null); setShareUrl(''); }}>观察者</button>
        </div>
        <label>有效期 <select value={inviteMinutes} onChange={event => setInviteMinutes(Number(event.target.value))}>
          <option value={60}>1 小时</option><option value={1440}>24 小时</option><option value={10080}>7 天</option>
        </select></label>
        <label>邀请密码（可选） <input type="password" minLength={6} maxLength={100} value={invitePassword} onChange={event => setInvitePassword(event.target.value)} /></label>
        <label><input type="checkbox" checked={inviteOnce} onChange={event => setInviteOnce(event.target.checked)} /> 仅可使用一次</label>
        <button className="secondary" disabled={busy || (invitePassword.length > 0 && invitePassword.length < 6)} onClick={() => makeInvite(inviteRole)}>生成{names[inviteRole]}邀请</button>
        <button className="secondary" disabled={busy || !invite} onClick={share}>分享该链接</button>
        {shareUrl && <input aria-label="邀请链接" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} />}
      </section>}
      <button className="danger" disabled={busy} onClick={leave}>{room.you.role === 'speaker' ? '结束并关闭训练室' : '离开训练室'}</button>
    </div>}
  </section>;
}
