import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { applyRoundCommand, type Member, type Round } from '../../../packages/core/src/round.ts';
import type { ComparePoint, ComparedPoint } from './ai-provider.ts';
import type { PointInput } from './points.ts';
import { TextCipher } from './crypto.ts';
import { RoomError } from './rooms.ts';
import { lockActiveRoundRoom } from './round-lock.ts';

type Sealed = { ciphertext: Buffer; nonce: Buffer; keyRef: string };
export interface ComparisonView {
  transcripts?: { speaker: string; listener: string };
  total: number;
  complete: number;
  accurate: number;
  issues: { id: string; category: string; original: string; listenerQuote: string; complete: boolean; accurate: boolean; tag: string | null; clarification: string | null;
    resolution: string | null; speakerConfirmed: boolean; listenerConfirmed: boolean; listenerNote: string | null }[];
}

export class PgComparisonStore {
  private readonly pool: Pool;
  private readonly cipher: TextCipher;
  constructor(pool: Pool, cipher: TextCipher) { this.pool = pool; this.cipher = cipher; }

  async pendingRoundIds(limit = 100): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(`SELECT r.id FROM rounds r JOIN rooms room ON room.id = r.room_id
      WHERE r.stage = 'COMPARING' AND room.status = 'ACTIVE' ORDER BY r.created_at LIMIT $1`, [limit]);
    return result.rows.map(row => row.id);
  }

  async pendingSpeakerTranscripts(): Promise<{ roundId: string; audioId: string }[]> {
    const result = await this.pool.query<{ roundId: string; audioId: string }>(`
      SELECT r.id AS "roundId", a.id AS "audioId"
      FROM rounds r JOIN rooms room ON room.id = r.room_id
      JOIN audio_assets a ON a.id = (r.snapshot->>'speakerAudioId')::uuid
      LEFT JOIN transcripts t ON t.audio_id = a.id
      WHERE r.stage IN ('KEYPOINT_CONFIRM','ASYNC_PENDING','LISTENER_RETELL','COMPARING') AND room.status = 'ACTIVE'
        AND a.kind = 'speaker' AND a.state = 'COMMITTED' AND a.transcription_requested AND t.audio_id IS NULL
      ORDER BY r.created_at LIMIT 100`);
    return result.rows;
  }

  async speakerAudioKey(roundId: string, audioId: string): Promise<string | null> {
    const row = (await this.pool.query<{ object_key: string }>(`
      SELECT a.object_key FROM rounds r JOIN rooms room ON room.id = r.room_id
      JOIN audio_assets a ON a.id = (r.snapshot->>'speakerAudioId')::uuid
      WHERE r.id = $1 AND a.id = $2 AND r.stage IN ('KEYPOINT_CONFIRM','ASYNC_PENDING','LISTENER_RETELL','COMPARING') AND room.status = 'ACTIVE'
        AND a.kind = 'speaker' AND a.state = 'COMMITTED' AND a.transcription_requested
        AND NOT EXISTS (SELECT 1 FROM transcripts WHERE audio_id = a.id)`, [roundId, audioId])).rows[0];
    return row?.object_key ?? null;
  }

  async saveSpeakerTranscript(roundId: string, audioId: string, transcript: string, candidates: PointInput[] = []): Promise<void> {
    const sealed = this.cipher.encrypt(transcript);
    const points = this.cipher.encrypt(JSON.stringify(candidates));
    await this.pool.query(`
      INSERT INTO transcripts (id, audio_id, ciphertext, nonce, key_ref, candidates_ciphertext, candidates_nonce)
      SELECT $3, a.id, $4, $5, $6, $7, $8 FROM rounds r JOIN rooms room ON room.id = r.room_id
      JOIN audio_assets a ON a.id = (r.snapshot->>'speakerAudioId')::uuid
      WHERE r.id = $1 AND a.id = $2 AND r.stage IN ('KEYPOINT_CONFIRM','ASYNC_PENDING','LISTENER_RETELL','COMPARING','SPEAKER_LABELING','MUTUAL_CONFIRM','ADVICE') AND room.status = 'ACTIVE'
        AND a.kind = 'speaker' AND a.state = 'COMMITTED' AND a.transcription_requested
      ON CONFLICT (audio_id) DO NOTHING`, [roundId, audioId, randomUUID(), sealed.ciphertext, sealed.nonce, sealed.keyRef, points.ciphertext, points.nonce]);
  }

  async input(roundId: string): Promise<{ audioKey: string; audioId: string; points: ComparePoint[] } | null> {
    const row = (await this.pool.query<{ snapshot: Round; status: string }>(`SELECT r.snapshot, room.status FROM rounds r JOIN rooms room ON room.id = r.room_id WHERE r.id = $1`, [roundId])).rows[0];
    if (!row || row.status !== 'ACTIVE' || row.snapshot.stage !== 'COMPARING' || !row.snapshot.listenerAudioId) return null;
    const audio = (await this.pool.query<{ object_key: string; transcription_requested: boolean }>(
      `SELECT object_key, transcription_requested FROM audio_assets WHERE id = $1 AND state = 'COMMITTED'`, [row.snapshot.listenerAudioId])).rows[0];
    if (!audio?.transcription_requested) throw new Error('LISTENER_CONSENT_MISSING');
    const result = await this.pool.query<{ id: string; category: string; content_ciphertext: Buffer; nonce: Buffer; key_ref: string }>(
      'SELECT id, category, content_ciphertext, nonce, key_ref FROM key_points WHERE round_id = $1 ORDER BY position', [roundId]);
    if (!result.rows.length) throw new Error('POINTS_MISSING');
    return { audioKey: audio.object_key, audioId: row.snapshot.listenerAudioId,
      points: result.rows.map(point => ({ id: point.id, category: point.category, text: this.cipher.decrypt(point.content_ciphertext, point.nonce, point.key_ref) })) };
  }

  async complete(roundId: string, audioId: string, transcript: string, compared: ComparedPoint[]): Promise<boolean> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      try { await lockActiveRoundRoom(db, roundId); }
      catch (error) {
        if (!(error instanceof RoomError)) throw error;
        await db.query('ROLLBACK');
        return false;
      }
      const row = (await db.query<{ snapshot: Round }>(
        "SELECT snapshot FROM rounds WHERE id = $1 AND stage = 'COMPARING' FOR UPDATE", [roundId],
      )).rows[0];
      if (!row || row.snapshot.listenerAudioId !== audioId) {
        await db.query('COMMIT'); return false;
      }
      const round = row.snapshot;
      const points = (await db.query<{ id: string }>('SELECT id FROM key_points WHERE round_id = $1 ORDER BY position', [roundId])).rows;
      if (points.length !== compared.length || points.some((point, i) => compared[i]?.id !== point.id)) throw new Error('COMPARISON_POINT_MISMATCH');
      const sealedTranscript = this.cipher.encrypt(transcript);
      await db.query(`INSERT INTO transcripts (id, audio_id, ciphertext, nonce, key_ref) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (audio_id) DO NOTHING`, [randomUUID(), audioId, sealedTranscript.ciphertext, sealedTranscript.nonce, sealedTranscript.keyRef]);
      const ids: string[] = [];
      for (const item of compared) {
        const id = randomUUID();
        const quote: Sealed | null = item.listenerQuote ? this.cipher.encrypt(item.listenerQuote) : null;
        const clarification: Sealed | null = item.clarification ? this.cipher.encrypt(item.clarification) : null;
        await db.query(`INSERT INTO comparison_items (id, round_id, key_point_id, complete, accurate, tag,
          listener_quote_ciphertext, listener_quote_nonce, listener_quote_key_ref, clarification_ciphertext, clarification_nonce, clarification_key_ref)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, roundId, item.id, item.complete, item.accurate, item.tag,
          quote?.ciphertext ?? null, quote?.nonce ?? null, quote?.keyRef ?? null,
          clarification?.ciphertext ?? null, clarification?.nonce ?? null, clarification?.keyRef ?? null]);
        ids.push(id);
      }
      const members = (await db.query<Member>('SELECT id, role, active FROM room_members WHERE room_id = $1', [round.roomId])).rows;
      const next = applyRoundCommand(round, { type: 'comparison-ready', issueIds: ids.filter((_, i) => !compared[i]?.complete || !compared[i]?.accurate) },
        { members, actor: { kind: 'system' }, expectedVersion: round.version, now: new Date(), speakerSeconds: 30, listenerSeconds: 30, asyncWaitSeconds: 604800 });
      await db.query('UPDATE rounds SET stage = $2, version = $3, deadline_at = $4, snapshot = $5 WHERE id = $1', [roundId, next.stage, next.version, next.deadlineAt, next]);
      await db.query('UPDATE rooms SET version = version + 1 WHERE id = $1', [round.roomId]);
      await db.query('COMMIT');
      return true;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }

  async view(roundId: string, sessionId: string): Promise<ComparisonView> {
    const room = (await this.pool.query<{ room_id: string; status: string; stage: string; snapshot: Round }>(`SELECT r.room_id, room.status, r.stage, r.snapshot FROM rounds r
      JOIN rooms room ON room.id = r.room_id WHERE r.id = $1`, [roundId])).rows[0];
    if (!room) throw new RoomError('ROUND_NOT_FOUND', 404);
    const member = (await this.pool.query<{ id: string }>(`SELECT id FROM room_members WHERE room_id = $1 AND session_id = $2 AND active`, [room.room_id, sessionId])).rows[0];
    if (!member || room.status === 'CLOSED' || (room.stage === 'ARCHIVED' && ![room.snapshot.speakerId, room.snapshot.listenerId].includes(member.id))) {
      throw new RoomError('NOT_ROOM_MEMBER', 403);
    }
    if (!['SPEAKER_LABELING', 'MUTUAL_CONFIRM', 'ADVICE', 'ARCHIVED'].includes(room.stage)) throw new RoomError('COMPARISON_PENDING', 409);
    const result = await this.pool.query<{ id: string; category: string; content_ciphertext: Buffer; content_nonce: Buffer; content_key_ref: string;
      complete: boolean; accurate: boolean; tag: string | null; resolution: string | null; listener_quote_ciphertext: Buffer | null; listener_quote_nonce: Buffer | null;
      listener_quote_key_ref: string | null; clarification_ciphertext: Buffer | null; clarification_nonce: Buffer | null; clarification_key_ref: string | null;
      listener_note_ciphertext: Buffer | null; listener_note_nonce: Buffer | null; listener_note_key_ref: string | null }>(
      `SELECT ci.id, kp.category, kp.content_ciphertext, kp.nonce AS content_nonce, kp.key_ref AS content_key_ref,
        ci.complete, ci.accurate, ci.tag, ci.resolution, ci.listener_quote_ciphertext, ci.listener_quote_nonce, ci.listener_quote_key_ref,
        ci.clarification_ciphertext, ci.clarification_nonce, ci.clarification_key_ref,
        ci.listener_note_ciphertext, ci.listener_note_nonce, ci.listener_note_key_ref
       FROM comparison_items ci JOIN key_points kp ON kp.id = ci.key_point_id WHERE ci.round_id = $1 ORDER BY kp.position`, [roundId]);
    const issues = result.rows.map(row => ({ id: row.id, category: row.category,
      original: this.cipher.decrypt(row.content_ciphertext, row.content_nonce, row.content_key_ref),
      listenerQuote: row.listener_quote_ciphertext && row.listener_quote_nonce && row.listener_quote_key_ref ? this.cipher.decrypt(row.listener_quote_ciphertext, row.listener_quote_nonce, row.listener_quote_key_ref) : '',
      complete: row.complete, accurate: row.accurate, tag: row.tag, resolution: row.resolution,
      listenerNote: row.listener_note_ciphertext && row.listener_note_nonce && row.listener_note_key_ref
        ? this.cipher.decrypt(row.listener_note_ciphertext, row.listener_note_nonce, row.listener_note_key_ref) : null,
      speakerConfirmed: room.snapshot.issues.find(issue => issue.id === row.id)?.speakerConfirmedRevision === room.snapshot.issues.find(issue => issue.id === row.id)?.revision && room.snapshot.issues.some(issue => issue.id === row.id),
      listenerConfirmed: room.snapshot.issues.find(issue => issue.id === row.id)?.listenerConfirmedRevision === room.snapshot.issues.find(issue => issue.id === row.id)?.revision && room.snapshot.issues.some(issue => issue.id === row.id),
      clarification: row.clarification_ciphertext && row.clarification_nonce && row.clarification_key_ref ? this.cipher.decrypt(row.clarification_ciphertext, row.clarification_nonce, row.clarification_key_ref) : null }));
    const complete = issues.filter(item => item.complete).length;
    const accurate = issues.filter(item => item.accurate).length;
    let transcripts: ComparisonView['transcripts'];
    if (issues.length && complete === issues.length && accurate === issues.length) {
      const rows = (await this.pool.query<{ kind: 'speaker' | 'listener'; ciphertext: Buffer; nonce: Buffer; key_ref: string }>(
        'SELECT a.kind, t.ciphertext, t.nonce, t.key_ref FROM transcripts t JOIN audio_assets a ON a.id=t.audio_id WHERE a.id IN ($1,$2)',
        [room.snapshot.speakerAudioId, room.snapshot.listenerAudioId])).rows;
      const speaker = rows.find(row => row.kind === 'speaker');
      const listener = rows.find(row => row.kind === 'listener');
      if (speaker && listener) transcripts = { speaker: this.cipher.decrypt(speaker.ciphertext, speaker.nonce, speaker.key_ref),
        listener: this.cipher.decrypt(listener.ciphertext, listener.nonce, listener.key_ref) };
    }
    return { total: issues.length, complete, accurate, issues, ...(transcripts ? { transcripts } : {}) };
  }
}
