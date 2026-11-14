import { useRef, useState } from 'react';

export function AudioPlayer({ roundId, audioId }: { roundId: string; audioId: string }) {
  const element = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<'new' | 'playing' | 'paused' | 'heard'>('new');
  const [error, setError] = useState('');
  async function toggle() {
    const audio = element.current;
    if (!audio) return;
    if (state === 'playing') { audio.pause(); setState('paused'); return; }
    if (state === 'paused' && audio.src) {
      try { await audio.play(); setState('playing'); } catch { setError('请点击下方播放器的播放键。'); }
      return;
    }
    setError('');
    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { response = await fetch(`/api/rounds/${roundId}/audio/${audioId}/access`); }
        catch { response = null; }
        if (response && ![502, 503, 504].includes(response.status)) break;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
      if (!response?.ok) throw new Error('暂时无法播放，请稍后重试。');
      const result = await response.json() as { url: string };
      audio.src = result.url;
      audio.load();
      try { await audio.play(); setState('playing'); }
      catch { setError('请点击下方播放器的播放键。'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '播放失败'); }
  }
  return <div className="audio-player"><button className="secondary" onClick={() => void toggle()}>{state === 'playing' ? '暂停播放' : state === 'paused' ? '继续播放' : state === 'heard' ? '已听过 · 再听一次' : '播放表达者录音'}</button>
    <audio ref={element} controls onPlay={() => setState('playing')} onPause={() => setState(current => current === 'playing' ? 'paused' : current)} onEnded={() => setState('heard')} />
    {error && <p role="alert" className="error-text">{error}</p>}
  </div>;
}
