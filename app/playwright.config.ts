// Playwright config for the Electron smoke suite (plan Task F, e2e/smoke.spec.ts).
// Single worker on purpose: the app under test owns the local bridge port
// 127.0.0.1:8765, and a second Electron instance would contend for it (the bridge
// binds once) as well as for the single-instance lock. The app is launched from the
// BUILT output (out/main/index.js) — run `npm run build` first.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Generous: cold Electron launch + bridge startup + mock-brain latency on a
  // Windows CI-ish machine (per-task, on top of expect timeout below).
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
});
