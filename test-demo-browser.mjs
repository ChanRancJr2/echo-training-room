import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from './product/node_modules/playwright/index.mjs';

const executablePath = process.env.BROWSER_EXECUTABLE ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const url = process.env.ECHO_DEMO_URL ?? pathToFileURL(join(process.cwd(), 'index.html')).href;
try {
  for (const mode of ['sync', 'solo', 'teen', 'async', 'teen-child']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator(`[data-mode="${mode === 'teen-child' ? 'teen' : mode}"]`).click();
    if (mode.startsWith('teen')) {
      if (mode === 'teen-child') await page.locator('[data-teen-role="speaker"]').click();
      await page.locator('#guardian').check();
    }
    await page.locator('[data-action="create"]').click();
    if (mode === 'sync' || mode === 'async') await page.locator('[data-action="invite"]').click();
    await page.locator('#screen [data-action="next"]').click();
    await page.locator('#screen [data-action="next"]').click();
    if (mode === 'teen-child') await page.locator('[data-action="teenEnter"]').click();
    const screen = page.locator('#screen');
    await screen.getByText('录音转写', { exact: true }).waitFor();
    assert.equal(await screen.locator('[data-action="toggleTranscription"]').isDisabled(), true, `${mode}: transcription must be disabled before finishing`);
    await screen.locator('[data-action="record"]').click();
    await screen.getByText('暂停录音').waitFor();
    await screen.locator('[data-action="record"]').click();
    await screen.getByText('继续录音').waitFor();
    await screen.locator('[data-action="deleteRecord"]').click();
    await screen.getByText('开始录音').waitFor();
    assert.equal(await screen.locator('.transcript').count(), 0);
    await screen.locator('[data-action="record"]').click();
    await screen.locator('[data-action="finishRecord"]').click();
    assert.equal(await screen.locator('[data-action="toggleTranscription"]').isEnabled(), true);
    assert.equal(await screen.locator('.transcript').count(), 0, `${mode}: transcript defaults hidden after finishing`);
    await screen.locator('[data-action="toggleTranscription"]').click();
    await screen.locator('.transcript').getByText('这周六我希望').waitFor();
    await screen.locator('[data-action="deleteRecord"]').click();
    assert.equal(await screen.locator('.transcript').count(), 0, `${mode}: deletion clears transcript`);
    assert.equal(await screen.locator('[data-action="toggleTranscription"]').isDisabled(), true);
    await screen.locator('[data-action="record"]').click();
    await screen.locator('[data-action="finishRecord"]').click();
    await screen.locator('[data-action="next"]').click();
    await screen.getByText('转写已关闭，请手动填写重点。', { exact: true }).waitFor();
    await screen.locator('[data-action="loadExamplePoints"]').click();
    await screen.locator('[data-action="next"]').click();
    if (mode === 'async') await screen.locator('[data-action="asyncOpen"]').click();
    if (mode === 'teen') await screen.locator('[data-action="teenEnter"]').click();
    if (mode === 'teen-child') await screen.locator('[data-action="teenBack"]').click();
    await screen.getByRole('button', { name: '播放表达者音频' }).click();
    await screen.getByRole('button', { name: '暂停表达者音频' }).waitFor();
    await screen.locator('[data-action="retell"]').click();
    await screen.getByRole('button', { name: '继续播放' }).waitFor();
    await screen.locator('[data-action="finishRetell"]').click();
    assert.equal(await screen.locator('[data-action="next"]').isDisabled(), true);
    await screen.locator('#retell-consent').check();
    await screen.locator('[data-action="next"]').click();
    if (mode === 'teen') await screen.locator('[data-action="teenBack"]').click();
    await screen.getByText('准确度', { exact: true }).waitFor();
    await screen.locator('[data-action="next"]').click();
    await screen.locator('[data-action="next"]').click();
    if (mode === 'sync' || mode === 'async') await screen.locator('[data-confirm-device="speaker"]').click();
    for (const button of await screen.locator('[data-action="speakerConfirm"]').all()) {
      await button.click();
    }
    if (mode === 'sync' || mode === 'async') await screen.locator('[data-confirm-device="listener"]').click();
    for (const button of await screen.locator('[data-action="listenerConfirm"]').all()) {
      await button.click();
    }
    if (mode === 'sync' || mode === 'async') await screen.locator('[data-confirm-device="speaker"]').click();
    await screen.locator('[data-action="next"]').click();
    await screen.locator('[data-action="adopt"]').click();
    await screen.locator('[data-action="next"]').click();
    await screen.getByText('双方逐条确认', { exact: true }).waitFor();
    await screen.getByRole('button', { name: '查看复盘记录' }).click();
    await screen.getByText('变化趋势', { exact: true }).waitFor();
    if (mode === 'sync') {
      await screen.locator('[data-action="viewReport"]').first().click();
      await screen.locator('[data-action="toggleAnonymous"]').click();
      const downloadPromise = page.waitForEvent('download');
      await screen.getByRole('link', { name: '导出报告（TXT）' }).click();
      const download = await downloadPromise;
      assert.match(await readFile(await download.path(), 'utf8'), /座位 A · 座位 B/);
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${mode}: recording, audio, consent, confirmation, advice and history passed`);
  }
} finally { await browser.close(); }
