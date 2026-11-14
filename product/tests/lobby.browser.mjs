import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:3103';
const env = {
  ...process.env, NODE_ENV: 'development', PUBLIC_ORIGIN: origin, PORT: '3103', WEB_ROOT: 'dist/web',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://echo:dev_only_change_me@127.0.0.1:15432/echo',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:16379', S3_ENDPOINT: 'http://127.0.0.1:18333',
  S3_REGION: 'us-east-1', S3_BUCKET: 'echo-private', AI_MODE: 'mock',
};
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/web/vite.config.ts'], { stdio: 'inherit', env });
assert.equal(build.status, 0, 'build web client');
const api = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/src/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
for (const stream of [api.stdout, api.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-4000); });
const executablePath = process.env.BROWSER_EXECUTABLE ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
let browser;
let hostCookie;
let roomId;
const post = (path, payload, cookie) => fetch(origin + path, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(payload),
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 50 && api.exitCode === null; attempt++) {
    if (await fetch(origin + '/health/ready').then(response => response.ok).catch(() => false)) { ready = true; break; }
    await delay(200);
  }
  assert.ok(ready && api.exitCode === null, 'lobby API became ready');
  const session = await post('/api/sessions/anonymous', {});
  assert.equal(session.status, 200);
  hostCookie = session.headers.get('set-cookie').split(';')[0];
  const created = await post('/api/rooms', { mode: 'sync', createKey: randomUUID() }, hostCookie);
  assert.equal(created.status, 201);
  const { state, inviteCode, inviteToken } = await created.json();
  roomId = state.id;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/');
  await page.getByRole('heading', { name: '选择练法' }).waitFor();
  await page.getByRole('link', { name: '训练大厅' }).click();
  await page.getByRole('heading', { name: '训练大厅' }).waitFor();
  for (const label of ['创建训练室', '用邀请链接或房间码加入', '我的复盘', '使用说明']) {
    await page.getByRole('button', { name: label, exact: true }).waitFor();
  }
  await page.getByRole('button', { name: '使用说明' }).click();
  await page.getByText('归档报告和录音会保留，房间创建者可在复盘中删除。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '用邀请链接或房间码加入' }).click();
  const input = page.getByLabel('邀请链接、令牌或 6 位房间码');
  await input.fill('OOOOOO');
  await page.getByRole('button', { name: '加入', exact: true }).click();
  await page.getByRole('alert').getByText('邀请无效或已过期，请让发起人重新生成').waitFor();
  assert.equal(page.url(), origin + '/#/lobby');
  await input.fill(`${inviteCode.slice(0, 3).toLowerCase()} ${inviteCode.slice(3)}`);
  await page.getByRole('button', { name: '加入', exact: true }).click();
  await page.waitForURL(origin + '/?room=' + roomId);
  await page.getByText(/你的座位：复述者/).waitFor();
  await page.getByRole('button', { name: '离开训练室' }).click();
  await page.waitForURL(origin + '/#/lobby');
  await page.getByRole('heading', { name: '训练大厅' }).waitFor();
  await page.goto(origin + '/#invite=' + inviteToken);
  await page.getByRole('button', { name: '加入', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Lobby browser passed: four entrances, invalid code, valid code joins a room, return to lobby, direct link shows Join');
} catch (error) {
  process.stderr.write(logs);
  throw error;
} finally {
  if (roomId) await post(`/api/rooms/${roomId}/leave`, {}, hostCookie).catch(() => undefined);
  await browser?.close();
  api.kill();
}
