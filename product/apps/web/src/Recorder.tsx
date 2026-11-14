import { useEffect, useRef, useState } from 'react';
import { boundedFetch as fetch, newRequestId } from './client.ts';

type UploadResult = { audioId: string; status: string; uploadUrl: string | null };
type CommitResult = { audioId: string; status: string; round: { stage: string } };
const acceptable = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];

export function Recorder({ roundId, kind, version, maxSeconds, onBegin, onCommitted, onCaptureChange }: { roundId: string; kind: 'speaker' | 'listener'; version: number; maxSeconds: number; onBegin: () => Promise<number>; onCommitted: () => Promise<void>; onCaptureChange?: (active: boolean) => void }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const commitVersion = useRef(version);
  const discardOnStop = useRef(false);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const idempotencyKey = useRef<string | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'ready' | 'uploading'>('idle');
  const [audio, setAudio] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [listenerConsent, setListenerConsent] = useState(false);
  useEffect(() => {
    if (state !== 'recording') return;
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);
  useEffect(() => { if (state === 'recording' && seconds >= maxSeconds) recorder.current?.stop(); }, [seconds, maxSeconds, state]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function begin() {
    if (state !== 'idle') return;
    setState('starting');
    onCaptureChange?.(true);
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('当前浏览器不支持录音，请使用最新版微信或手机浏览器。');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      commitVersion.current = await onBegin();
      if (!mounted.current) return;
      const mimeType = acceptable.find(candidate => MediaRecorder.isTypeSupported(candidate));
      const current = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = current; chunks.current = []; discardOnStop.current = false;
      current.ondataavailable = event => { if (recorder.current === current && event.data.size) chunks.current.push(event.data); };
      current.onerror = () => setError('录音中断，请删除后重试。');
      current.onstop = () => {
        media.getTracks().forEach(track => track.stop());
        if (discardOnStop.current || !mounted.current || recorder.current !== current) return;
        onCaptureChange?.(false);
        const baseType = current.mimeType.split(';')[0] || 'audio/webm';
        const blob = new Blob(chunks.current, { type: baseType });
        if (!blob.size) { setError('未录到声音，请重新开始。'); setState('idle'); return; }
        setAudio(blob); setPreview(URL.createObjectURL(blob)); setState('ready');
      };
      current.start(500); setSeconds(0); setState('recording');
    } catch (cause) { if (mounted.current) { onCaptureChange?.(false); setError(cause instanceof Error ? cause.message : '无法使用麦克风'); setState('idle'); } stream.current?.getTracks().forEach(track => track.stop()); }
  }
  function toggle() {
    if (recorder.current?.state === 'recording') { recorder.current.pause(); setState('paused'); }
    else if (recorder.current?.state === 'paused') { recorder.current.resume(); setState('recording'); }
  }
  function finish() { if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop(); }
  function remove() {
    discardOnStop.current = true;
    if (recorder.current?.state !== 'inactive') recorder.current?.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    chunks.current = [];
    if (preview) URL.revokeObjectURL(preview);
    recorder.current = null;
    onCaptureChange?.(false);
    setAudio(null); setPreview(null); setSeconds(0); setState('idle'); setError(''); setListenerConsent(false); idempotencyKey.current = null;
  }
  async function upload() {
    if (!audio) return;
    setState('uploading'); setError('');
    try {
      idempotencyKey.current ??= newRequestId();
      const request = await fetch(`/api/rounds/${roundId}/uploads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, mimeType: audio.type, byteSize: audio.size, idempotencyKey: idempotencyKey.current }) });
      const data = await request.json() as UploadResult & { error?: string };
      if (!request.ok) throw new Error(data.error ?? '申请上传失败');
      if (data.uploadUrl) {
        const put = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': audio.type }, body: audio }, 60000);
        if (!put.ok) throw new Error('录音上传失败，请重试。');
      }
      const commit = await fetch(`/api/rounds/${roundId}/uploads/${data.audioId}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: commitVersion.current, transcribe: kind === 'speaker', consentToTranscribe: kind === 'listener' && listenerConsent }) });
      const result = await commit.json() as CommitResult & { error?: string };
      if (!commit.ok) throw new Error(result.error ?? '提交确认失败');
      await onCommitted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '上传失败，请重试。'); setState('ready'); }
  }
  return <section className="recorder"><h2>{kind === 'speaker' ? '表达录音' : '复述录音'}</h2>
    <p>最长 {maxSeconds} 秒。录音仅在确认上传后发送；可暂停、预听或删除重录。</p>
    <div className="record-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {state === 'idle' && <button className="primary" onClick={() => void begin()}>开始录音</button>}
    {state === 'starting' && <p>正在获取录音权限并同步本轮计时…</p>}
    {(state === 'recording' || state === 'paused') && <><button className="secondary" onClick={toggle}>{state === 'recording' ? '暂停录音' : '继续录音'}</button><button className="primary" onClick={finish}>结束录音</button></>}
    {(state === 'recording' || state === 'paused' || state === 'ready') && <button className="secondary" onClick={remove}>删除录音，重新录入</button>}
    {state === 'ready' && <><audio controls src={preview ?? undefined} />{kind === 'speaker' && <div className="transcription-choice">确认上传后会自动转写</div>}{kind === 'listener' && <label className="transcription-consent"><input type="checkbox" checked={listenerConsent} onChange={event => setListenerConsent(event.target.checked)} /> 我知晓复述录音提交后会被转写，用于本轮逐条对照。</label>}<button className="primary" disabled={kind === 'listener' && !listenerConsent} onClick={() => void upload()}>确认上传</button></>}
    {state === 'uploading' && <p>正在上传并确认，请稍候…</p>}
    {kind === 'speaker' && state !== 'ready' && <p>确认上传后自动转写，可在本轮信息点页面查看。</p>}
  </section>;
}
