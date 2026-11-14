import { useEffect, useState } from 'react';
import { Recorder } from './Recorder.tsx';
import { AudioPlayer } from './AudioPlayer.tsx';
import { PointEditor } from './PointEditor.tsx';
import { ComparisonView } from './ComparisonView.tsx';

type Room = { id: string; version: number; mode: string; status: string; durationSeconds: number; retellStyle: string; topic: string; roundId: string | null; stage: string | null; roundVersion: number | null; activeSeat: 'speaker' | 'listener' | null; deadlineAt: string | null; speakerAudioId: string | null; listenerAudioId: string | null; you: { role: 'speaker' | 'listener' | 'observer'; ready: boolean }; members: { id: string; nickname: string; role: string; ready: boolean }[] };
const names = { speaker: '表达者', listener: '复述者', observer: '观察者' };
const messages: Record<string, string> = {
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

export function RoomFlow({ mode }: { mode: string | null }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [retellStyle, setRetellStyle] = useState<'auditory' | 'keywords'>('auditory');
  const [topic, setTopic] = useState('家庭日常');
  const [customTopic, setCustomTopic] = useState('');
  const refresh = async (id: string, restore = false) => {
    const incoming = await call<Room>(`/api/rooms/${id}`);
    setRoom(current => restore ? incoming : current?.id === id && current.version <= incoming.version ? incoming : current);
    setReconnecting(false);
  };
  useEffect(() => {
    const incoming = new URLSearchParams(location.hash.slice(1)).get('invite');
    if (incoming) { setToken(incoming); history.replaceState({}, '', location.pathname); return; }
    const id = new URLSearchParams(location.search).get('room');
    if (id) void refresh(id, true).catch(() => history.replaceState({}, '', location.pathname));
  }, []);
  useEffect(() => {
    if (!room) return;
    const timer = window.setInterval(() => { void refresh(room.id).catch(cause => {
      if (cause instanceof HttpError && [401, 403, 404].includes(cause.status)) {
        setRoom(null); setError('训练室已关闭或会话已失效'); history.replaceState({}, '', location.pathname);
      } else setReconnecting(true);
    }); }, 2000);
    return () => clearInterval(timer);
  }, [room?.id, room?.status]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  }
  const create = () => void run(async () => {
    if (!mode) return;
    const result = await call<{ state: Room; inviteToken: string | null }>('/api/rooms', { mode, createKey: crypto.randomUUID(), durationSeconds, retellStyle, topic: topic === '自定义填写' ? customTopic.trim() : topic });
    setRoom(result.state); setInvite(result.inviteToken); history.replaceState({}, '', `?room=${result.state.id}`);
  });
  const join = () => void run(async () => {
    const state = await call<Room>('/api/rooms/join', { token, password: password || null });
    setRoom(state); setToken(null); history.replaceState({}, '', `?room=${state.id}`);
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
    const result = await call<{ version: number }>(`/api/rounds/${room.roundId}/${firstRecording ? 'task' : 'restart-recording'}`,
      firstRecording ? { expectedVersion: room.roundVersion } : { expectedVersion: room.roundVersion, kind });
    await refresh(room.id);
    return result.version;
  };
  const leave = () => void run(async () => { if (room) { await call(`/api/rooms/${room.id}/leave`, {}); setRoom(null); setInvite(null); history.replaceState({}, '', location.pathname); } });
  const makeInvite = (role: 'listener' | 'observer') => void run(async () => {
    if (room) setInvite((await call<{ token: string }>(`/api/rooms/${room.id}/invitations`, { role, minutes: 60, maxUses: 1, password: null })).token);
  });
  const share = () => void run(async () => {
    if (!invite) return;
    const url = `${location.origin}${location.pathname}#invite=${invite}`;
    if (navigator.share) await navigator.share({ title: '回声训练室邀请', url }); else await navigator.clipboard.writeText(url);
  });
  return <section className="room-flow">
    {error && <div role="alert" className="notice error">{error}</div>}
    {room && reconnecting && <div role="status" className="notice">网络暂时中断，正在恢复训练室状态…</div>}
    {token && !room && <div className="card"><h2>加入训练室</h2><p>邀请决定你的座位。若有密码，请先填写。</p><input aria-label="邀请密码" type="password" value={password} onChange={event => setPassword(event.target.value)} /><button className="primary" disabled={busy} onClick={join}>加入</button></div>}
    {!token && !room && mode && <div className="card"><h2>创建训练室</h2><p>{mode === 'teen' || mode === 'async' ? '该练法的正式流程仍在开发，请先查看可点击原型。' : '选择本轮主题、发言时长和复述方式。'}</p>
      <strong>本轮主题</strong><div className="option-grid">{['家庭日常', '大学生活', '疾病与需求', '工作需求', '自定义填写'].map(value => <button key={value} className={topic === value ? 'chosen' : ''} onClick={() => setTopic(value)}>{value}</button>)}</div>
      {topic === '自定义填写' && <input aria-label="自定义主题" maxLength={80} placeholder="填写本轮主题" value={customTopic} onChange={event => setCustomTopic(event.target.value)} />}
      <strong>每人发言时长</strong><div className="option-grid">{[[30, '30 秒'], [60, '1 分钟'], [120, '2 分钟'], [300, '5 分钟']].map(([value, label]) => <button key={value} className={durationSeconds === value ? 'chosen' : ''} onClick={() => setDurationSeconds(Number(value))}>{label}</button>)}</div>
      <strong>复述方式</strong><div className="option-grid">{[['auditory', '纯听觉'], ['keywords', '关键词辅助']].map(([value, label]) => <button key={value} className={retellStyle === value ? 'chosen' : ''} onClick={() => setRetellStyle(value as 'auditory' | 'keywords')}>{label}</button>)}</div>
      <button className="primary" disabled={busy || mode === 'teen' || mode === 'async' || (topic === '自定义填写' && !customTopic.trim())} onClick={create}>创建训练室</button></div>}
    {room && <div className="card"><h2>{room.status === 'WAITING' ? '准备好，慢慢开始' : '本轮已开始'}</h2><p>你的座位：{names[room.you.role]} · {room.topic} · {room.durationSeconds} 秒 · {room.retellStyle === 'keywords' ? '关键词辅助' : '纯听觉'}</p>
      {room.members.map(member => <div className="member" key={member.id}><span>{names[member.role as keyof typeof names]} · {member.nickname}</span><b>{member.ready ? '已准备' : '未准备'}</b></div>)}
      {room.status === 'WAITING' && room.you.role !== 'observer' && <button className="primary" disabled={busy} onClick={ready}>{room.you.ready ? '取消准备' : '准备好了'}</button>}
      {room.status === 'WAITING' && room.you.role === 'speaker' && <button className="secondary" disabled={busy || !room.members.some(m => m.role === 'speaker' && m.ready) || (room.mode !== 'solo' && !room.members.some(m => m.role === 'listener' && m.ready))} onClick={start}>开始本轮</button>}
      {room.status === 'ACTIVE' && <div className="notice">轮次 {room.roundId?.slice(0, 8)} · {room.stage}。AI 信息点与反馈仍在开发，请勿用于真实训练。</div>}
      {room.status === 'ACTIVE' && (room.stage === 'TASK' || room.stage === 'SPEAKER_RECORDING') && room.you.role === 'speaker' && room.roundId && room.roundVersion && <Recorder roundId={room.roundId} kind="speaker" version={room.roundVersion} maxSeconds={room.durationSeconds} onBegin={() => beginRecording('speaker')} onCommitted={() => refresh(room.id)} />}
      {room.status === 'ACTIVE' && room.stage === 'KEYPOINT_CONFIRM' && room.you.role === 'speaker' && room.roundId && room.roundVersion && <PointEditor roundId={room.roundId} version={room.roundVersion} onConfirmed={() => refresh(room.id)} />}
      {room.status === 'ACTIVE' && room.speakerAudioId && room.roundId && room.stage !== 'SPEAKER_RECORDING' && roundRole !== 'speaker' && <AudioPlayer key={room.roundId} roundId={room.roundId} audioId={room.speakerAudioId} />}
      {room.status === 'ACTIVE' && room.stage === 'LISTENER_RETELL' && roundRole === 'listener' && room.roundId && room.roundVersion && <Recorder key={room.roundId} roundId={room.roundId} kind="listener" version={room.roundVersion} maxSeconds={room.durationSeconds} onBegin={() => beginRecording('listener')} onCommitted={() => refresh(room.id)} />}
      {['SPEAKER_LABELING', 'MUTUAL_CONFIRM', 'ADVICE', 'ARCHIVED'].includes(room.stage ?? '') && room.roundId && room.roundVersion && <ComparisonView key={room.roundId} roundId={room.roundId} stage={room.stage!} version={room.roundVersion} role={roundRole ?? room.you.role} solo={room.mode === 'solo'} onChanged={() => refresh(room.id)} />}
      {room.stage === 'ADVICE' && room.you.role === 'speaker' && <button className="primary" disabled={busy} onClick={prepareNext}>归档并准备下一轮</button>}
      {room.status === 'WAITING' && room.you.role === 'speaker' && room.mode !== 'solo' && <div><h2>邀请搭档</h2><p>新邀请默认一小时有效，仅可使用一次。</p><button className="secondary" disabled={busy || !invite} onClick={share}>分享当前邀请</button><button className="text-button" disabled={busy} onClick={() => makeInvite('listener')}>生成复述者邀请</button><button className="text-button" disabled={busy} onClick={() => makeInvite('observer')}>生成观察者邀请</button></div>}
      <button className="danger" disabled={busy} onClick={leave}>{room.you.role === 'speaker' ? '结束并关闭训练室' : '离开训练室'}</button>
    </div>}
  </section>;
}
