// agenda_today tool tests — board read + speakable summary (empty / 1 / many /
// >maxItems), the best-effort win32 calendar pop (non-fatal on failure, absent
// off-Windows), board-read failure, and the dispatcher-level ACL denial
// (notion gate — the board is then never read).
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createMemoryMockNotion, type MockNotion } from '../mockNotion';
import { createToolDispatcher, type ToolDispatcherDeps } from './index';
import { buildAgendaSummary, createAgendaTodayTool } from './agenda';

const ITEMS = [
  { id: 't1', text: 'buy milk', createdAt: '2026-10-27T09:00:00.000Z' },
  { id: 't2', text: 'call the dentist', createdAt: '2026-10-27T09:05:00.000Z' },
];

function fakeExec(code = 0) {
  const commands: string[] = [];
  return {
    commands,
    exec: async (command: string) => {
      commands.push(command);
      return { code, stdout: '', stderr: '' };
    },
  };
}

function baseDeps(overrides: Partial<ToolDispatcherDeps> = {}): ToolDispatcherDeps {
  return {
    settings: () => DEFAULT_SETTINGS,
    ...overrides,
  };
}

describe('buildAgendaSummary (pure)', () => {
  it('empty → honest empty line; 1 item → singular; N items → comma list', () => {
    expect(buildAgendaSummary([], 8)).toBe('Your board is empty — nothing due today.');
    expect(buildAgendaSummary([{ text: 'buy milk' }], 8)).toBe(
      'You have 1 item on your board: "buy milk"',
    );
    expect(buildAgendaSummary(ITEMS, 8)).toBe(
      'You have 2 items on your board: "buy milk", "call the dentist"',
    );
  });

  it('caps at maxItems with an "and N more" tail', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ text: `task ${i + 1}` }));
    const summary = buildAgendaSummary(many, 3);
    expect(summary).toContain('You have 10 items');
    expect(summary).toContain('"task 1", "task 2", "task 3"');
    expect(summary).toContain('… and 7 more');
    expect(summary).not.toContain('"task 4"');
  });
});

describe('createAgendaTodayTool', () => {
  it('happy (win32): reads the board, speaks the items, and best-effort execs start outlookcal:', async () => {
    const board: Pick<MockNotion, 'list'> = { list: async () => ITEMS };
    const { exec, commands } = fakeExec();
    const tool = createAgendaTodayTool({ board, exec, platform: 'win32' });
    const outcome = await tool({});
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('You have 2 items on your board: "buy milk", "call the dentist"');
    expect(outcome.data).toEqual({
      count: 2,
      items: [
        { id: 't1', text: 'buy milk' },
        { id: 't2', text: 'call the dentist' },
      ],
    });
    expect(commands).toEqual(['start outlookcal:']);
  });

  it('empty board → ok:true honest summary; the calendar pop still fires on win32', async () => {
    const board: Pick<MockNotion, 'list'> = { list: async () => [] };
    const { exec, commands } = fakeExec();
    const tool = createAgendaTodayTool({ board, exec, platform: 'win32' });
    const outcome = await tool({});
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Your board is empty — nothing due today.');
    expect(commands).toEqual(['start outlookcal:']);
  });

  it('calendar exec failure is NON-FATAL (thrown or non-zero) — the agenda still succeeds', async () => {
    const board: Pick<MockNotion, 'list'> = { list: async () => ITEMS };
    const throwing = createAgendaTodayTool({
      board,
      exec: async () => {
        throw new Error('start failed');
      },
      platform: 'win32',
    });
    const outcome = await throwing({});
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toContain('buy milk');

    const failing = createAgendaTodayTool({ board, exec: fakeExec(1).exec, platform: 'win32' });
    expect((await failing({})).ok).toBe(true);
  });

  it('off-Windows: no calendar exec at all', async () => {
    const board: Pick<MockNotion, 'list'> = { list: async () => ITEMS };
    const { commands } = fakeExec();
    const tool = createAgendaTodayTool({ board, exec: fakeExec().exec, platform: 'darwin' });
    await tool({});
    expect(commands).toHaveLength(0);
  });

  it('board read failure → ok:false with the reason, no calendar pop', async () => {
    const board: Pick<MockNotion, 'list'> = {
      list: async () => {
        throw new Error('disk on fire');
      },
    };
    const { commands } = fakeExec();
    const tool = createAgendaTodayTool({ board, exec: fakeExec().exec, platform: 'win32' });
    const outcome = await tool({});
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('Could not read the to-do board');
    expect(outcome.summary).toContain('disk on fire');
    expect(commands).toHaveLength(0);
  });
});

describe('agenda_today via the tool dispatcher', () => {
  it('reads the dispatcher-shared board (what notion_add_todo wrote)', async () => {
    const board = createMemoryMockNotion();
    const dispatch = createToolDispatcher(baseDeps({ mockNotion: board, platform: 'win32' }));
    await dispatch({ id: 'a0', tool: 'notion_add_todo', args: { text: 'buy milk' } });
    const result = await dispatch({ id: 'a1', tool: 'agenda_today', args: {} });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('You have 1 item on your board: "buy milk"');
  });

  it('denied when the notion gate is off — the board is never read', async () => {
    const list = vi.fn(async () => ITEMS);
    const board: Pick<MockNotion, 'list'> = { list };
    const dispatch = createToolDispatcher(
      baseDeps({
        settings: () => ({ ...DEFAULT_SETTINGS, permissions: { ...DEFAULT_SETTINGS.permissions, notion: false } }),
        mockNotion: board as unknown as MockNotion,
        platform: 'win32',
      }),
    );
    const result = await dispatch({ id: 'a2', tool: 'agenda_today', args: {} });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Permission denied: notion');
    expect(list).not.toHaveBeenCalled();
  });
});
