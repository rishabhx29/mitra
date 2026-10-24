// Unit tests stay logic-only (node env, no electron import / jsdom / WebGL — AGENTS.md):
// they live beside their modules under src/ and electron/. The Playwright e2e suite
// (e2e/smoke.spec.ts) matches vitest's default *.spec.* glob, so it is excluded here
// and runs through `npx playwright test` (playwright.config.ts) instead.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: [
      'e2e/**',
      'node_modules/**',
      'out/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
});
