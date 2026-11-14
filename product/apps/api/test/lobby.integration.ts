import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../src/app.ts';
import { PgRoomStore } from '../src/rooms.ts';
import { PgSessionStore } from '../src/session-store-pg.ts';

test('lobby codes and links share invitation checks, membership and revocation', async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const origin = 'http://localhost:3100';
  const app = await createApp({
    rooms: new PgRoomStore(pool), sessions: new PgSessionStore(pool), publicOrigin: origin,
    production: false, ready: async () => true,
  });
  const post = (url: string, payload: object, cookie?: string, remoteAddress?: string) =>
    app.inject({ method: 'POST', url, payload, headers: { origin, ...(cookie ? { cookie } : {}) }, ...(remoteAddress ? { remoteAddress } : {}) });
  const session = async () => {
    const response = await post('/api/sessions/anonymous', {});
    assert.equal(response.statusCode, 200);
    return String(response.headers['set-cookie']).split(';')[0]!;
  };
  try {
    const host = await session();
    const guest = await session();
    const other = await session();
    const created = (await post('/api/rooms', { mode: 'sync', createKey: randomUUID() }, host)).json();
    const id = created.state.id;
    const endpoint = `/api/rooms/${id}/invitations`;
    const options = { role: 'observer', minutes: 60, maxUses: 1, password: 'safe1234' };
    const issued = await post(endpoint, options, host);
    assert.equal(issued.statusCode, 201);
    const { code, token } = issued.json();
    const second = (await post(endpoint, { ...options, role: 'listener' }, host)).json();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.match(created.inviteCode, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(new Set([code, second.code, created.inviteCode]).size, 3);

    const unknown = '222222';
    assert.equal((await post('/api/rooms/join', { token, code }, guest)).statusCode, 400);
    const absent = await post('/api/rooms/join', { code: unknown }, guest);
    const wrong = await post('/api/rooms/join', { code, password: 'incorrect' }, guest);
    assert.equal(absent.statusCode, 404);
    assert.equal(wrong.statusCode, 404);
    assert.deepEqual(wrong.json(), absent.json());
    assert.equal(absent.json().error, 'INVITE_NOT_FOUND');
    const joined = await post('/api/rooms/join', { code: ` ${code.slice(0, 3).toLowerCase()} ${code.slice(3)} `, password: 'safe1234' }, guest);
    assert.equal(joined.statusCode, 200);
    assert.equal(joined.json().you.role, 'observer');
    for (const credential of [{ code }, { token }]) {
      const repeated = await post('/api/rooms/join', credential, guest);
      assert.equal(repeated.statusCode, 200);
      assert.equal(repeated.json().you.memberId, joined.json().you.memberId);
    }
    assert.equal((await pool.query('SELECT use_count FROM invitations WHERE code=$1', [code])).rows[0].use_count, 1);
    const used = await post('/api/rooms/join', { code, password: 'safe1234' }, other);
    assert.equal(used.statusCode, 410);
    assert.deepEqual(used.json(), absent.json());

    const legacy = randomBytes(32).toString('base64url');
    await pool.query("INSERT INTO invitations (id, room_id, token_hash, expires_at, max_uses) VALUES ($1,$2,$3,now()+interval '1 hour',1)",
      [randomUUID(), id, createHash('sha256').update(legacy).digest('hex')]);
    assert.equal((await post('/api/rooms/join', { token: legacy }, other)).json().you.role, 'listener');
    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = await post('/api/rooms/join', { code: '333 333' }, attempt % 2 ? guest : other, '192.0.2.23');
      assert.equal(response.statusCode, attempt <= 5 ? 404 : 429);
    }
    assert.equal((await post('/api/rooms/join', { code: '333333' }, other, '192.0.2.24')).statusCode, 404);
    assert.equal((await post(`/api/rooms/${id}/leave`, {}, host)).statusCode, 200);
    const revoked = await post('/api/rooms/join', { code: second.code, password: 'safe1234' }, other);
    assert.equal(revoked.statusCode, 410);
    assert.deepEqual(revoked.json(), absent.json());
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM invitations WHERE room_id=$1 AND revoked_at IS NULL', [id])).rows[0].n, 0);
  } finally { await app.close(); await pool.end(); }
});
