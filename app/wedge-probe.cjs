const { _electron: electron } = require('@playwright/test');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mitra-wedge-'));
  const env = { ...process.env, MITRA_E2E: '1' };
  for (const k of Object.keys(env)) if (/^(BOLNA_|SARVAM_|DEEPGRAM_|CARTESIA_|OPENAI_|NOTION_)/i.test(k)) delete env[k];
  const app = await electron.launch({ args: [join(__dirname, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`], env });

  // overlay page (mounted hidden at boot)
  let overlay = null;
  for (let i = 0; i < 30; i++) { overlay = app.windows().find(w => w.url().includes('window=overlay')); if (overlay) break; await new Promise(r => setTimeout(r, 500)); }
  await overlay.waitForSelector('[data-testid="mitra-overlay-root"]', { timeout: 30000 });

  // settings window
  const winP = app.waitForEvent('window', { timeout: 30000 });
  await app.evaluate(({ ipcMain }) => { ipcMain.emit('mitra:e2e-show-settings'); });
  const settings = await winP;
  await settings.getByText('Mitra Settings').waitFor({ timeout: 20000 });

  // --- test 3 sequence: summon, Escape, re-summon ---
  const emit = (ch) => app.evaluate(({ ipcMain }, c) => { ipcMain.emit(c); }, ch);
  await emit('mitra:e2e-toggle-overlay'); await new Promise(r => setTimeout(r, 800));
  await overlay.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 800));
  await emit('mitra:e2e-toggle-overlay'); await new Promise(r => setTimeout(r, 800));

  // --- test 4 sequence: wait greeting, submit milk ---
  const input = overlay.getByTestId('mitra-dev-input');
  await overlay.getByTestId('mitra-caption').toContainText('Hi, I am Mitra', { timeout: 30000 });
  await input.fill('add milk to my todo list'); await input.press('Enter');
  await overlay.getByTestId('mitra-caption').toContainText('Added', { timeout: 30000 });
  console.log('[t4] milk reply OK');

  // --- test 6 sequence: flip terminal permission off via settings IPC, re-summon, submit opencode ---
  await settings.evaluate(async () => {
    await window.mitra.setSettings({ permissions: { notion: true, launcher: true, terminal: false, browser: true } });
  });
  await emit('mitra:e2e-show-overlay'); await new Promise(r => setTimeout(r, 1000));
  await overlay.getByTestId('mitra-caption').toContainText('Hi, I am Mitra', { timeout: 30000 });
  console.log('[t6] re-summon greeting OK');
  await input.fill('open opencode and build me a portfolio site');
  await input.press('Enter');
  await new Promise(r => setTimeout(r, 6000));
  const caption = await overlay.getByTestId('mitra-caption').textContent();
  console.log('[t6] caption after 6s:', JSON.stringify(caption.slice(0, 90)));
  // conversation log ground truth: did handle() run for the opencode utterance?
  await settings.getByRole('button', { name: /conversation/i }).click();
  const log = await settings.getByTestId('mitra-transcript-log').textContent().catch(() => 'NO LOG');
  console.log('[t6] conversation log tail:', JSON.stringify(log.slice(-300)));
  await app.close();
})().catch(e => { console.error('PROBE FAIL', e.message); process.exit(1); });
