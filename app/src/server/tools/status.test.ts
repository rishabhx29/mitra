// status_briefing tests (docs/ULTRON_PORT.md row 6): summary shape + data shape
// with a fake powerMonitor-shaped dep, a fake node:os-shaped dep and injected
// counts. Node env, no electron import.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import {
  createStatusBriefingTool,
  formatUptime,
  hasBolnaKeys,
  platformLabel,
  type OsLike,
  type PowerMonitorLike,
} from './status';
import { createToolDispatcher } from './index';
import { createInMemoryMemoryStore } from '../memory';
import { createMemoryMockNotion } from '../mockNotion';

function makeOs(overrides: Partial<{ uptime: number; platform: string }> = {}): OsLike & { uptime: () => number; platform: () => string } {
  return {
    uptime: () => overrides.uptime ?? 8052, // 2h 14m 12s
    platform: () => overrides.platform ?? 'win32',
  };
}

function makePower(onBattery: boolean): PowerMonitorLike {
  return { isOnBatteryPower: () => onBattery };
}

function makeDeps(overrides: Partial<Parameters<typeof createStatusBriefingTool>[0]> = {}) {
  return {
    power: makePower(false),
    os: makeOs(),
    env: {} as Record<string, string | undefined>,
    memoryCount: async () => 3,
    notionItemCount: async () => 2,
    ...overrides,
  };
}

describe('status_briefing', () => {
  it('mock mode: summary covers charging, uptime, platform, provider mode and counts', async () => {
    const tool = createStatusBriefingTool(makeDeps());
    const result = await tool({});
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      'Status: charging, up 2h 14m, on Windows, mock mode (no Bolna keys), 3 memories, 2 to-dos.',
    );
    expect(result.data).toEqual({
      charging: true,
      onBattery: false,
      powerKnown: true,
      uptimeSeconds: 8052,
      platform: 'win32',
      providerMode: 'mock',
      memoryCount: 3,
      notionItemCount: 2,
    });
  });

  it('on battery power reads differently from charging', async () => {
    const tool = createStatusBriefingTool(makeDeps({ power: makePower(true) }));
    const result = await tool({});
    expect(result.summary).toContain('on battery power');
    expect(result.data).toMatchObject({ charging: false, onBattery: true });
  });

  it('live mode when Bolna keys are present in the env', async () => {
    const tool = createStatusBriefingTool(
      makeDeps({ env: { BOLNA_API_KEY: ' k ', BOLNA_AGENT_ID: ' a ' } }),
    );
    const result = await tool({});
    expect(result.summary).toBe(
      'Status: charging, up 2h 14m, on Windows, live mode (Bolna connected), 3 memories, 2 to-dos.',
    );
    expect(result.data).toMatchObject({ providerMode: 'live' });
  });

  it('no power dep → power clause omitted and powerKnown:false (never invents a battery number)', async () => {
    const tool = createStatusBriefingTool(makeDeps({ power: undefined }));
    const result = await tool({});
    expect(result.summary).toBe(
      'Status: up 2h 14m, on Windows, mock mode (no Bolna keys), 3 memories, 2 to-dos.',
    );
    expect(result.data).toMatchObject({ charging: null, onBattery: null, powerKnown: false });
  });

  it('singular nouns for 1 memory / 1 to-do', async () => {
    const tool = createStatusBriefingTool(makeDeps({ memoryCount: async () => 1, notionItemCount: async () => 1 }));
    const result = await tool({});
    expect(result.summary).toContain('1 memory, 1 to-do.');
  });

  it('runs through the dispatcher even with EVERY permission denied (no gate)', async () => {
    const memory = createInMemoryMemoryStore({ now: () => 1, idFactory: () => 'm1' });
    await memory.remember('only note');
    const notion = createMemoryMockNotion({ now: () => 1, idFactory: () => 't1' });
    await notion.add('only todo');
    const dispatch = createToolDispatcher({
      settings: () => ({
        ...DEFAULT_SETTINGS,
        permissions: { notion: false, launcher: false, terminal: false, browser: false },
      }),
      mockNotion: notion,
      memory,
      power: makePower(false),
      os: makeOs(),
      env: {},
    });
    const result = await dispatch({ id: 's1', tool: 'status_briefing', args: {} });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('1 memory');
    expect(result.summary).toContain('1 to-do');
  });

  it('counts come from the injected stores (memory + mock notion board)', async () => {
    const memory = createInMemoryMemoryStore();
    await memory.remember('deploy checklist');
    await memory.remember('wifi password');
    const notion = createMemoryMockNotion();
    await notion.add('buy milk');
    const tool = createStatusBriefingTool(
      makeDeps({
        memoryCount: async () => (await memory.list()).length,
        notionItemCount: async () => (await notion.list()).length,
      }),
    );
    const result = await tool({});
    expect(result.summary).toContain('2 memories, 1 to-do');
  });
});

describe('formatUptime / platformLabel / hasBolnaKeys helpers', () => {
  it('formats uptime in speakable chunks', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(600)).toBe('10m');
    expect(formatUptime(8052)).toBe('2h 14m');
    expect(formatUptime(7200)).toBe('2h');
    expect(formatUptime(0)).toBe('0s');
  });

  it('labels the three main platforms and passes unknown ones through', () => {
    expect(platformLabel('win32')).toBe('Windows');
    expect(platformLabel('darwin')).toBe('macOS');
    expect(platformLabel('linux')).toBe('Linux');
    expect(platformLabel('freebsd')).toBe('freebsd');
  });

  it('hasBolnaKeys mirrors bolnaKeys(): both keys non-blank required', () => {
    expect(hasBolnaKeys({})).toBe(false);
    expect(hasBolnaKeys({ BOLNA_API_KEY: 'k' })).toBe(false);
    expect(hasBolnaKeys({ BOLNA_API_KEY: 'k', BOLNA_AGENT_ID: '  ' })).toBe(false);
    expect(hasBolnaKeys({ BOLNA_API_KEY: ' k ', BOLNA_AGENT_ID: 'a' })).toBe(true);
  });
});
