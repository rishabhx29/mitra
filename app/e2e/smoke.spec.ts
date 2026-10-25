// Playwright Electron smoke — plan Task F (docs/superpowers/plans/2026-10-24-mitra-mvp.md).
//
// What it pins, in mock mode with zero API keys (AGENTS.md: mock mode is first-class):
//   1. the local bridge is up on 127.0.0.1:8765 and reports mock:true
//   2. the settings window opens and renders the ACL panel
//   3. the overlay summons and Escape dismisses (asserted via the Page Visibility
//      API — Playwright cannot press real OS-level global hotkeys)
//   4. the ?dev=1 text input drives the MockProvider's exact speech path:
//      "add milk to my todo list" → notion_add_todo → result caption, with the
//      user utterance landing in the settings window's Conversation log
//   5. the mock board carries the item (GET /api/notion/items — Task E's route)
//   6. terminal permission off → "open opencode …" intent → permission-denied reply
//   7. "stop" ends the session cleanly and the overlay auto-dismisses
//
// How it drives the app: the BUILT main (out/main/index.js) is launched with an
// isolated --user-data-dir and a scrubbed environment (no BOLNA_*/NOTION_*/… keys,
// MITRA_E2E=1). Two small MITRA_E2E-gated affordances in electron/main.ts are used:
//   - 'mitra:e2e-toggle-overlay' / 'mitra:e2e-show-settings' re-trigger the same
//     toggleOverlay()/showSettings() closures the hotkey and tray call
//     (the test emits them via electronApp.evaluate in the main process);
//   - the overlay page is loaded with ?dev=1 so SessionController mounts its dev
//     text input ([data-testid="mitra-dev-input"]).
//
// Run from app/:  npm run build && npx playwright test   (or: npm run e2e)
// Prereq: port 127.0.0.1:8765 must be free — close any running Mitra instance
// first (a leftover dev instance would own the bridge and receive the tool calls).
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_DIR = join(__dirname, '..');
const MAIN_PATH = join(APP_DIR, 'out', 'main', 'index.js');
const BRIDGE_BASE = 'http://127.0.0.1:8765';

interface MockTodo {
  id: string;
  text: string;
  createdAt: string;
}

interface BridgeHealth {
  ok: boolean;
  service?: string;
  mock?: boolean;
}

let electronApp: ElectronApplication;
let overlayPage: Page;
let settingsPage: Page | null = null;
let userDataDir = '';
/** Board size before the add-milk utterance — makes the board assertion robust even if --user-data-dir isolation ever regresses. */
let notionCountBeforeSubmit = 0;

test.describe.configure({ mode: 'serial' });

/** Shell env for the app under test: inherit, then scrub every API key + dev-server/Node overrides. */
function e2eEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      /^(BOLNA_|SARVAM_|DEEPGRAM_|CARTESIA_|OPENAI_|ANTHROPIC_|NOTION_)/i.test(key) ||
      key === 'ELECTRON_RENDERER_URL' || // never load a dev server — load the built renderer
      key === 'NODE_OPTIONS' ||
      key === 'ELECTRON_RUN_AS_NODE'
    ) {
      continue;
    }
    env[key] = value;
  }
  env['MITRA_E2E'] = '1'; // enables the documented e2e hooks in electron/main.ts
  return env;
}

/** Emit one of the MITRA_E2E-gated channels inside the app's main process. */
async function emitMainChannel(channel: string): Promise<void> {
  await electronApp.evaluate(
    ({ ipcMain }, ch) => {
      (ipcMain as unknown as { emit(channel: string): boolean }).emit(ch);
    },
    channel,
  );
}

async function pollBridgeHealth(timeoutMs: number): Promise<BridgeHealth> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BRIDGE_BASE}/api/health`);
      if (res.ok) return (await res.json()) as BridgeHealth;
      lastError = new Error(`health responded ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`bridge /api/health not reachable after ${timeoutMs}ms: ${String(lastError)}`);
}

async function listMockNotionItems(): Promise<MockTodo[]> {
  const res = await fetch(`${BRIDGE_BASE}/api/notion/items`);
  if (!res.ok) throw new Error(`/api/notion/items responded ${res.status}`);
  const body = (await res.json()) as { items?: MockTodo[] };
  return body.items ?? [];
}

/**
 * Window visibility, read from the main process for the window whose page URL is
 * the overlay. (document.visibilityState does NOT follow BrowserWindow.hide() in
 * this Electron build — verified live 2026-10-24 — so the Page Visibility API is
 * not a usable oracle here.)
 */
async function overlayWindowVisible(): Promise<boolean | null> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('window=overlay'),
    );
    return win ? win.isVisible() : null;
  });
}

async function expectOverlayVisible(visible: boolean): Promise<void> {
  await expect.poll(overlayWindowVisible, { timeout: 20_000 }).toBe(visible);
}

async function submitDevInput(text: string): Promise<void> {
  const input = overlayPage.getByTestId('mitra-dev-input');
  await input.fill(text);
  await input.press('Enter');
}

/**
 * Provider-ready signal before the FIRST typed submission: MockProvider.start()
 * emits the greeting right after createVoiceProvider resolves, and that resolution
 * includes a POST /api/session probe which can take >10s on a cold Windows machine
 * (firewall first-connect). SessionController drops a dev input submitted before
 * the provider exists ("Dev text input only works in mock mode"), so wait for the
 * greeting instead of racing it. Later submissions are safe — readiness is monotonic.
 */
async function expectProviderReady(): Promise<void> {
  await expect(overlayPage.getByTestId('mitra-caption')).toContainText('Hi, I am Mitra', {
    timeout: 60_000,
  });
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'mitra-e2e-'));
  electronApp = await electron.launch({
    // Isolated profile: this run gets its own mitra-settings.json + mock-notion.json
    // instead of touching the developer's default userData directory.
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: e2eEnv(),
    timeout: 120_000,
  });
  const appUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  console.log(`[mitra-e2e] electron pid=${String(electronApp.process()?.pid ?? '?')} userData=${appUserData}`);

  // The overlay window is created hidden at boot; wait for its page to exist and mount.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const page = electronApp.windows().find((w) => w.url().includes('window=overlay'));
    if (page) {
      overlayPage = page;
      break;
    }
    if (Date.now() > deadline) throw new Error('overlay window page never appeared');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await overlayPage.waitForSelector('[data-testid="mitra-overlay-root"]', {
    state: 'attached',
    timeout: 60_000,
  });
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
  try {
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup — the single-instance lock file may linger on Windows */
  }
});

test('bridge is up and reports mock mode (no API keys)', async () => {
  const health = await pollBridgeHealth(60_000);
  expect(health.ok).toBe(true);
  expect(health.service).toBe('mitra-bridge');
  expect(health.mock).toBe(true);
});

test('settings window opens and renders the permissions UI', async () => {
  // Since the first-launch-visible fix, the settings window already exists at
  // boot (no new window event fires when the hook re-shows it) — find it; the
  // hook stays as the fallback if the window was ever closed first.
  settingsPage =
    electronApp.windows().find((w) => w.url().includes('window=settings')) ??
    (await (async () => {
      const windowPromise = electronApp.waitForEvent('window');
      await emitMainChannel('mitra:e2e-show-settings');
      return windowPromise;
    })());
  expect(settingsPage.url()).toContain('window=settings');
  await expect(settingsPage.getByText('Mitra Settings')).toBeVisible();
  // Open the ACL panel and see the four gates (PermissionsPanel, Task E).
  await settingsPage.getByRole('button', { name: 'App permissions' }).click();
  await expect(settingsPage.getByText('Terminal & opencode')).toBeVisible();
});

test('overlay summons via the e2e toggle hook and Escape dismisses', async () => {
  await emitMainChannel('mitra:e2e-toggle-overlay');
  await expectOverlayVisible(true);

  // Escape dismisses (SessionController keydown → window.mitra.hideOverlay; the
  // main process also has a before-input-event safety net — either path hides).
  await overlayPage.keyboard.press('Escape');
  await expectOverlayVisible(false);

  // Summon again for the conversation steps below.
  await emitMainChannel('mitra:e2e-toggle-overlay');
  await expectOverlayVisible(true);
});

test('"add milk to my todo list" runs notion_add_todo and shows the result', async () => {
  notionCountBeforeSubmit = (await listMockNotionItems()).length;

  // The ?dev=1 input only exists with MITRA_E2E=1 — pin that contract here.
  await expect(overlayPage.getByTestId('mitra-dev-input')).toBeVisible();
  await expectProviderReady();
  await submitDevInput('add milk to my todo list');

  // Mock brain: user transcript → thinking → tool → agent reply with the tool summary.
  await expect(overlayPage.getByTestId('mitra-caption')).toContainText(
    'Added to Notion (mock board): "milk"',
  );
  // UI polish (docs/DESIGN_BRIEF.md): the 220×220 circle now shows ONE status pill
  // plus the newest agent/system reply line — user utterances are intentionally not
  // rendered there anymore (src/overlay/Captions.tsx replaced the captions list, so
  // mitra-caption-prev is gone). The full transcript must still exist: the overlay
  // reports every provider entry to main (mitra:report-transcript), which streams it
  // to the settings window's Conversation log. Pin the user's words there instead.
  await settingsPage!.getByRole('button', { name: 'Conversation log' }).click();
  await expect(settingsPage!.getByTestId('mitra-transcript-log')).toContainText(
    'add milk to my todo list',
  );
});

test('the mock Notion board carries the new item (GET /api/notion/items)', async () => {
  const items = await listMockNotionItems();
  expect(items.length).toBe(notionCountBeforeSubmit + 1);
  expect(items.some((item) => item.text === 'milk')).toBe(true);
});

test('terminal permission off → opencode intent gets the permission-denied reply', async () => {
  // Flip the terminal gate through the settings window's preload IPC — the same
  // mitra:setSettings path the PermissionsPanel toggles use.
  const next = await settingsPage!.evaluate(async () => {
    const mitra = (window as unknown as {
      mitra: { setSettings(patch: unknown): Promise<{ permissions: { terminal: boolean } }> };
    }).mitra;
    return mitra.setSettings({
      permissions: { notion: true, launcher: true, terminal: false, browser: true },
    });
  });
  expect(next.permissions.terminal).toBe(false);
  // Re-open the permissions panel first — test 4 left the settings window on the
  // Conversation log section, and role queries skip display:none subtrees.
  await settingsPage!.getByRole('button', { name: 'App permissions' }).click();
  await expect(
    settingsPage!.getByRole('switch', { name: 'Terminal & opencode' }),
  ).toHaveAttribute('aria-checked', 'false');

  // The 12s listening-no-speech timeout (docs/DESIGN_BRIEF.md) may have already
  // stopped test 4's session and auto-dismissed the overlay while this test was
  // setting up — a real user would just press the hotkey again, so re-summon
  // through the same e2e hook and wait for the fresh session before typing.
  await emitMainChannel('mitra:e2e-show-overlay');
  await expectOverlayVisible(true);
  // The re-summon starts a FRESH session; submitting before its provider exists
  // drops the input ("Dev text input only works in mock mode"). Wait for the
  // greeting like test 4 does (expectProviderReady).
  await expectProviderReady();
  await submitDevInput('open opencode and build me a portfolio site');
  // The bridge answers 403 {ok:false, summary:"Permission denied: terminal"};
  // MockProvider.failureReply localizes that exact shape.
  await expect(overlayPage.getByTestId('mitra-caption')).toContainText(
    'terminal access is turned off',
  );
});

test('"stop" ends the session and the overlay auto-dismisses', async () => {
  await submitDevInput('stop');
  await expect(overlayPage.getByTestId('mitra-caption')).toContainText('Okay, closing');
  // SessionController hides the window ~900ms after the session reaches idle.
  await expectOverlayVisible(false);
});

// 8. Console (docs/CONSOLE_PLAN.md): opens from the Home button, its input
//    drives the SAME intent→tool pipeline, and the thread shows a tool card.
test('console opens from Home, runs a tool from typed input, shows the card', async () => {
  // The settings window is on the Conversation log after test 6 — go Home first.
  await settingsPage!.getByRole('button', { name: 'Home' }).click();

  const consoleWindowPromise = electronApp.waitForEvent('window', { timeout: 30_000 });
  await settingsPage!.getByRole('button', { name: /console/i }).first().click();
  const consolePage = await consoleWindowPromise;
  expect(consolePage.url()).toContain('window=console');
  await consolePage.waitForSelector('[data-testid="console-root"]', { timeout: 30_000 });

  const before = (await listMockNotionItems()).length;
  const input = consolePage.getByTestId('console-input');
  await input.fill('add chai to my todo list');
  await input.press('Enter');

  // Tool card appears in the thread and the mock board carries the item.
  const thread = consolePage.getByTestId('console-thread');
  await expect(thread.locator('[data-testid="console-tool-card"]').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(thread).toContainText('chai', { timeout: 20_000 });
  await expect
    .poll(async () => (await listMockNotionItems()).length, { timeout: 20_000 })
    .toBe(before + 1);
});
