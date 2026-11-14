import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { applyRoundCommand, type Member, type Round } from '../../../packages/core/src/round.ts';
import type { AudioStorage } from './audio-storage.ts';
import { RoomError } from './rooms.ts';
import { lockActiveRoundRoom } from './round-lock.ts';

export type AudioKind = 'speaker' | 'listener';
type Asset = { id: string; round_id: string; member_id: string; kind: AudioKind; object_key: string; mime_type: string; byte_size: string; state: string; idempotency_key: string; round_version: string };
const allowedMime = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac']);
const demand = (code: string, status = 409): never => { throw new RoomError(code, status); };
export function matchesAudioHeader(mime: string, bytes: Buffer): boolean {
  const starts = (signature: string) => bytes.subarray(0, signature.length / 2).toString('hex') === signature;
  switch (mime) {
    case 'audio/webm': return starts('1a45dfa3');
    case 'audio/ogg': return starts('4f676753');
    case 'audio/mp4': return bytes.toString('ascii', 4, 8) === 'ftyp';
    case 'audio/wav': return starts('52494646') && bytes.toString('ascii', 8, 12) === 'WAVE';
    case 'audio/mpeg': return starts('494433') || (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224);
    case 'audio/aac': return bytes[0] === 255 && ((bytes[1] ?? 0) & 246) === 240;
    default: return false;
  }
}

export class PgUploadStore {
  private readonly pool: Pool;
  private readonly storage: AudioStorage;
  constructor(pool: Pool, storage: AudioStorage) { this.pool = pool; this.storage = storage; }

  private async transaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try { await db.query('BEGIN'); const value = await work(db); await db.query('COMMIT'); return value; }
    catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }

  private async member(db: PoolClient, round: Round, sessionId: string, kind: AudioKind): Promise<Member> {
    const member = (await db.query<Member & { session_id: string }>(
      'SELECT id, role, active, session_id FROM room_members WHERE room_id = $1 AND session_id = $2 AND active', [round.roomId, sessionId])).rows[0];
    if (!member) return demand('NOT_ROOM_MEMBER', 403);
    const expectedId = kind === 'speaker' ? round.speakerId : round.listenerId;
    if (member.id !== expectedId || (round.mode !== 'solo' && member.role !== kind)) return demand('FORBIDDEN_ROLE', 403);
    return member;
  }

  async request(roundId: string, sessionId: string, kind: AudioKind, mimeType: string, byteSize: number, idempotencyKey: string): Promise<{ audioId: string; status: 'PENDING' | 'COMMITTED'; uploadUrl: string | null }> {
    if (!allowedMime.has(mimeType) || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > 15_000_000) return demand('INVALID_AUDIO', 400);
    const asset = await this.transaction(async db => {
      await lockActiveRoundRoom(db, roundId);
      const row = (await db.query<{ snapshot: Round }>("SELECT snapshot FROM rounds WHERE id = $1 AND stage NOT IN ('CANCELLED', 'ARCHIVED') FOR UPDATE", [roundId])).rows[0];
      if (!row) return demand('ROUND_NOT_FOUND', 404);
      const round = row.snapshot;
      const member = await this.member(db, round, sessionId, kind);
      const existing = (await db.query<Asset>('SELECT * FROM audio_assets WHERE round_id = $1 AND member_id = $2 AND kind = $3 AND idempotency_key = $4', [roundId, member.id, kind, idempotencyKey])).rows[0];
      if (existing) {
        if (existing.state !== 'COMMITTED' && Number(existing.round_version) !== round.version) return demand('STALE_AUDIO');
        if (existing.state !== 'PENDING' && existing.state !== 'COMMITTED') return demand('AUDIO_UNAVAILABLE');
        return existing;
      }
      const committed = (await db.query<Asset>(`SELECT * FROM audio_assets WHERE round_id = $1 AND kind = $2 AND state = 'COMMITTED'`, [roundId, kind])).rows[0];
      if (committed) return committed;
      if (round.stage !== (kind === 'speaker' ? 'SPEAKER_RECORDING' : 'LISTENER_RETELL')) return demand('WRONG_STAGE');
      const audioId = randomUUID();
      const objectKey = `rounds/${roundId}/${kind}/${audioId}`;
      return (await db.query<Asset>(`INSERT INTO audio_assets (id, round_id, member_id, kind, object_key, mime_type, byte_size, state, idempotency_key, round_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9) RETURNING *`, [audioId, roundId, member.id, kind, objectKey, mimeType, byteSize, idempotencyKey, round.version])).rows[0]!;
    });
    return { audioId: asset.id, status: asset.state as 'PENDING' | 'COMMITTED', uploadUrl: asset.state === 'PENDING' ? await this.storage.uploadUrl(asset.object_key, asset.mime_type) : null };
  }

  async commit(roundId: string, sessionId: string, audioId: string, expectedVersion: number, transcribe = false, consentToTranscribe = false): Promise<{ audioId: string; status: 'COMMITTED'; round: Round }> {
    const asset = (await this.pool.query<Asset>('SELECT * FROM audio_assets WHERE id = $1 AND round_id = $2', [audioId, roundId])).rows[0];
    if (!asset) return demand('AUDIO_NOT_FOUND', 404);
    if (asset.state !== 'COMMITTED') {
      const object = await this.storage.inspect(asset.object_key);
      if (!object || object.bytes !== Number(asset.byte_size) || object.mimeType !== asset.mime_type) return demand('UPLOAD_NOT_VERIFIED');
      if (!matchesAudioHeader(asset.mime_type, await this.storage.prefix(asset.object_key))) {
        return demand('UNSUPPORTED_AUDIO', 400);
      }
    }
    return this.transaction(async db => {
      await lockActiveRoundRoom(db, roundId);
      const row = (await db.query<{ snapshot: Round }>("SELECT snapshot FROM rounds WHERE id = $1 AND stage NOT IN ('CANCELLED', 'ARCHIVED') FOR UPDATE", [roundId])).rows[0];
      if (!row) return demand('ROUND_NOT_FOUND', 404);
      const round = row.snapshot;
      const member = await this.member(db, round, sessionId, asset.kind);
      const current = (await db.query<Asset>('SELECT * FROM audio_assets WHERE id = $1 FOR UPDATE', [audioId])).rows[0];
      if (!current || current.member_id !== member.id) return demand('AUDIO_NOT_OWNED', 403);
      if (current.state === 'COMMITTED') return { audioId, status: 'COMMITTED' as const, round };
      if (current.state !== 'PENDING') return demand('AUDIO_UNAVAILABLE');
      if (Number(current.round_version) !== round.version) return demand('STALE_AUDIO');
      if (asset.kind === 'listener' && !consentToTranscribe) return demand('CONSENT_REQUIRED', 400);
      const previous = (await db.query<Asset>(`SELECT * FROM audio_assets WHERE round_id = $1 AND kind = $2 AND state = 'COMMITTED'`, [roundId, asset.kind])).rows[0];
      if (previous) return { audioId: previous.id, status: 'COMMITTED' as const, round };
      const command = asset.kind === 'speaker' ? { type: 'speaker-submitted' as const, audioId } : { type: 'listener-submitted' as const, audioId };
      const members = (await db.query<Member>('SELECT id, role, active FROM room_members WHERE room_id = $1', [round.roomId])).rows;
      const settings = (await db.query<{ duration_seconds: number }>('SELECT duration_seconds FROM rooms WHERE id = $1', [round.roomId])).rows[0];
      if (!settings) return demand('ROOM_NOT_FOUND', 404);
      const next = applyRoundCommand(round, command, { members, actor: { kind: 'member', memberId: member.id }, expectedVersion, now: new Date(), speakerSeconds: settings.duration_seconds, listenerSeconds: settings.duration_seconds, asyncWaitSeconds: 7 * 24 * 60 * 60 });
      await db.query(`UPDATE audio_assets SET state = 'COMMITTED', committed_at = now(), transcription_requested = $2 WHERE id = $1`, [audioId, asset.kind === 'listener' ? consentToTranscribe : transcribe]);
      await db.query('UPDATE rounds SET stage = $2, version = $3, deadline_at = $4, snapshot = $5 WHERE id = $1', [roundId, next.stage, next.version, next.deadlineAt, next]);
      await db.query('UPDATE rooms SET version = version + 1 WHERE id = $1', [round.roomId]);
      return { audioId, status: 'COMMITTED' as const, round: next };
    });
  }

  async access(roundId: string, audioId: string, sessionId: string): Promise<{ url: string; expiresIn: number }> {
    const result = await this.pool.query<{ object_key: string }>(
      `SELECT a.object_key FROM audio_assets a
       JOIN rounds r ON r.id = a.round_id JOIN rooms room ON room.id = r.room_id
       JOIN room_members m ON m.room_id = room.id AND m.session_id = $3 AND m.active
       WHERE a.id = $2 AND a.round_id = $1 AND a.state = 'COMMITTED' AND room.status = 'ACTIVE'
       AND r.stage NOT IN ('CANCELLED', 'ARCHIVED') LIMIT 1`, [roundId, audioId, sessionId]);
    const asset = result.rows[0];
    if (!asset) return demand('AUDIO_NOT_ACCESSIBLE', 403);
    return { url: await this.storage.downloadUrl(asset.object_key), expiresIn: 60 };
  }
}
