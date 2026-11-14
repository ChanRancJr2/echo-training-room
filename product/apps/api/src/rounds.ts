import type { Pool } from 'pg';
import { applyRoundCommand, DomainError, type Command, type Member, type Round } from '../../../packages/core/src/round.ts';
import { RoomError } from './rooms.ts';
import { lockActiveRoundRoom } from './round-lock.ts';

export class PgRoundStore {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async apply(roundId: string, sessionId: string, expectedVersion: number, command: Command, now = new Date()): Promise<Round> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await lockActiveRoundRoom(db, roundId);
      const row = (await db.query<{ snapshot: Round; version: string }>("SELECT snapshot, version FROM rounds WHERE id = $1 AND stage NOT IN ('CANCELLED', 'ARCHIVED') FOR UPDATE", [roundId])).rows[0];
      if (!row) throw new RoomError('ROUND_NOT_FOUND', 404);
      const round = row.snapshot;
      if (round.version !== Number(row.version)) throw new Error('Round snapshot version mismatch');
      const members = (await db.query<Member & { session_id: string }>(
        'SELECT id, role, active, session_id FROM room_members WHERE room_id = $1', [round.roomId])).rows;
      const actor = members.find(member => member.session_id === sessionId && member.active);
      if (!actor) throw new RoomError('NOT_ROOM_MEMBER', 403);
      const settings = (await db.query<{ duration_seconds: number }>('SELECT duration_seconds FROM rooms WHERE id = $1', [round.roomId])).rows[0];
      if (!settings) throw new RoomError('ROOM_NOT_FOUND', 404);
      const next = applyRoundCommand(round, command, { members, actor: { kind: 'member', memberId: actor.id }, expectedVersion, now, speakerSeconds: settings.duration_seconds, listenerSeconds: settings.duration_seconds, asyncWaitSeconds: 7 * 24 * 60 * 60 });
      await db.query('UPDATE rounds SET stage = $2, version = $3, deadline_at = $4, snapshot = $5, finished_at = CASE WHEN $2 = $6 THEN now() ELSE finished_at END WHERE id = $1',
        [roundId, next.stage, next.version, next.deadlineAt, next, 'ARCHIVED']);
      await db.query('UPDATE rooms SET version = version + 1 WHERE id = $1', [round.roomId]);
      await db.query('COMMIT');
      return next;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
}

export function roundErrorResponse(error: unknown): RoomError | null {
  if (!(error instanceof DomainError)) return null;
  const forbidden = ['NOT_MEMBER', 'FORBIDDEN_ROLE', 'ROLE_MISMATCH', 'SYSTEM_ONLY'];
  return new RoomError(error.code, forbidden.includes(error.code) ? 403 : 409);
}
