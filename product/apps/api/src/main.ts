import pg from 'pg';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { Redis } from 'ioredis';
import { createApp } from './app.ts';
import { readConfig } from './config.ts';
import { PgSessionStore } from './session-store-pg.ts';
import { PgRoomStore } from './rooms.ts';
import { PgRoundStore } from './rounds.ts';
import { S3AudioStorage } from './audio-storage.ts';
import { PgUploadStore } from './uploads.ts';
import { TextCipher } from './crypto.ts';
import { PgPointStore } from './points.ts';
import { PgComparisonStore } from './comparisons.ts';
import { PgReviewStore } from './reviews.ts';

try { process.loadEnvFile('.env'); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const config = readConfig(process.env);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 });
const rooms = new PgRoomStore(pool);
const cipher = config.ENCRYPTION_MASTER_KEY ? new TextCipher(config.ENCRYPTION_MASTER_KEY) : null;
const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
await redis.connect();

const app = await createApp({
  sessions: new PgSessionStore(pool),
  rooms,
  rounds: new PgRoundStore(pool),
  uploads: config.S3_ACCESS_KEY && config.S3_SECRET_KEY ? new PgUploadStore(pool, new S3AudioStorage({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKey: config.S3_ACCESS_KEY, secretKey: config.S3_SECRET_KEY })) : undefined,
  points: cipher ? new PgPointStore(pool, cipher) : undefined,
  comparisons: cipher ? new PgComparisonStore(pool, cipher) : undefined,
  reviews: new PgReviewStore(pool),
  publicOrigin: config.PUBLIC_ORIGIN,
  production: config.NODE_ENV === 'production',
  ready: async () => {
    try {
      const [db, cache] = await Promise.all([pool.query('SELECT 1'), redis.ping()]);
      return db.rowCount === 1 && cache === 'PONG';
    } catch { return false; }
  },
});

if (process.env.WEB_ROOT) await app.register(fastifyStatic, { root: resolve(process.env.WEB_ROOT) });

const close = async () => {
  clearInterval(sweeper);
  await app.close();
  await Promise.all([pool.end(), redis.quit()]);
};
const sweeper = setInterval(() => { void rooms.sweepExpiredSessions(new Date()).catch(error => app.log.error({ error }, 'session sweep failed')); }, 60_000);
process.once('SIGTERM', () => { void close().then(() => process.exit(0)); });
process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
await app.listen({ host: '0.0.0.0', port: config.PORT });
