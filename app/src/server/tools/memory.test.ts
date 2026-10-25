// memory tool tests (docs/ULTRON_PORT.md row 5): remember/recall/list over the
// injected Cerebro-lite store, honest empty-state answers, and the notion gate.
// Node env, no electron import.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createMemoryTool } from './memory';
import { createInMemoryMemoryStore } from '../memory';
import { createToolDispatcher } from './index';

const FIXED_TS = 1_700_000_000_000;

function makeFixture() {
  const memory = createInMemoryMemoryStore({ now: () => FIXED_TS, idFactory: () => 'mem_1' });
  const tool = createMemoryTool({ memory });
  return { memory, tool };
}

describe('memory tool', () => {
  describe('remember', () => {
    it('stores the text and reports it back', async () => {
      const { memory, tool } = makeFixture();
      const result = await tool({ action: 'remember', text: '  deploy checklist lives in notion  ' });
      expect(result.ok).toBe(true);
      expect(result.summary).toBe('Stored in memory: "deploy checklist lives in notion"');
      expect(result.data).toEqual({
        entry: { id: 'mem_1', text: 'deploy checklist lives in notion', ts: FIXED_TS },
      });
      expect(await memory.list()).toHaveLength(1);
    });

    it('accepts the query field as an alias for text (lenient arg naming)', async () => {
      const { memory, tool } = makeFixture();
      const result = await tool({ action: 'remember', query: 'wifi password is hunter2' });
      expect(result.ok).toBe(true);
      expect((await memory.list())[0]!.text).toBe('wifi password is hunter2');
    });

    it('empty text → ok:false, nothing stored', async () => {
      const { memory, tool } = makeFixture();
      const result = await tool({ action: 'remember', text: '   ' });
      expect(result.ok).toBe(false);
      expect(result.summary).toBe('Nothing to remember — tell me what to store.');
      expect(await memory.list()).toHaveLength(0);
    });
  });

  describe('recall', () => {
    it('returns matches with scores in data and a speakable summary', async () => {
      const { tool } = makeFixture();
      await tool({ action: 'remember', text: 'deploy checklist lives in notion' });
      await tool({ action: 'remember', text: 'wifi password is hunter2' });
      const result = await tool({ action: 'recall', query: 'deploy' });
      expect(result.ok).toBe(true);
      expect(result.summary).toBe('Found 1 memory matching "deploy": "deploy checklist lives in notion"');
      const data = result.data as { matches: Array<{ entry: { text: string }; score: number }> };
      expect(data.matches).toEqual([
        { entry: { id: 'mem_1', text: 'deploy checklist lives in notion', ts: FIXED_TS }, score: 2 },
      ]);
    });

    it('plural summary for multiple matches', async () => {
      const { tool } = makeFixture();
      await tool({ action: 'remember', text: 'chai break at 4' });
      await tool({ action: 'remember', text: 'chai with Rahul tomorrow' });
      const result = await tool({ action: 'recall', query: 'chai' });
      expect(result.summary).toBe(
        'Found 2 memories matching "chai": "chai break at 4"; "chai with Rahul tomorrow"',
      );
    });

    it('no matches is still ok:true (the capability worked, honestly empty)', async () => {
      const { tool } = makeFixture();
      await tool({ action: 'remember', text: 'something unrelated' });
      const result = await tool({ action: 'recall', query: 'kubernetes' });
      expect(result).toEqual({ ok: true, summary: 'Nothing in memory matches "kubernetes".', data: { matches: [] } });
    });

    it('empty query → ok:false with a hint', async () => {
      const { tool } = makeFixture();
      const result = await tool({ action: 'recall', query: '  ' });
      expect(result).toEqual({ ok: false, summary: 'No query provided for recall.' });
    });
  });

  describe('list', () => {
    it('empty memory → honest empty answer', async () => {
      const { tool } = makeFixture();
      const result = await tool({ action: 'list' });
      expect(result).toEqual({ ok: true, summary: 'Memory is empty — nothing stored yet.', data: { entries: [] } });
    });

    it('lists stored texts', async () => {
      const { tool } = makeFixture();
      await tool({ action: 'remember', text: 'deploy checklist' });
      await tool({ action: 'remember', text: 'wifi password' });
      const result = await tool({ action: 'list' });
      expect(result.ok).toBe(true);
      expect(result.summary).toBe('2 in memory: "deploy checklist"; "wifi password"');
    });

    it('caps the speakable list at 5 with an "and N more" suffix', async () => {
      const { tool } = makeFixture();
      for (let i = 0; i < 7; i++) await tool({ action: 'remember', text: `note ${i}` });
      const result = await tool({ action: 'list' });
      expect(result.summary).toBe(
        '7 in memory: "note 0"; "note 1"; "note 2"; "note 3"; "note 4" …and 2 more',
      );
    });
  });

  it('unknown or missing action → ok:false listing the actions', async () => {
    const { tool } = makeFixture();
    const unknown = await tool({ action: 'delete', text: 'x' });
    expect(unknown).toEqual({
      ok: false,
      summary: 'Unknown memory action "delete". Use remember, recall, or list.',
    });
    const missing = await tool({});
    expect(missing).toEqual({
      ok: false,
      summary: 'Unknown memory action "(none)". Use remember, recall, or list.',
    });
  });
});

describe('memory tool through the dispatcher (ACL — notion gate)', () => {
  function makeDispatch(permissions = DEFAULT_SETTINGS.permissions) {
    const memory = createInMemoryMemoryStore({ now: () => FIXED_TS, idFactory: () => 'mem_1' });
    const dispatch = createToolDispatcher({
      settings: () => ({ ...DEFAULT_SETTINGS, permissions }),
      memory,
      env: {},
      platform: 'win32',
    });
    return { memory, dispatch };
  }

  it('remember via the dispatcher writes the shared store', async () => {
    const { memory, dispatch } = makeDispatch();
    const result = await dispatch({ id: 'm1', tool: 'memory', args: { action: 'remember', text: 'standup at 10' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Stored in memory: "standup at 10"');
    expect(await memory.list()).toHaveLength(1);
  });

  it('denied when the notion gate is false — nothing stored', async () => {
    const { memory, dispatch } = makeDispatch({ ...DEFAULT_SETTINGS.permissions, notion: false });
    const result = await dispatch({ id: 'm2', tool: 'memory', args: { action: 'remember', text: 'x' } });
    expect(result).toEqual({ id: 'm2', ok: false, summary: 'Permission denied: notion' });
    expect(await memory.list()).toHaveLength(0);
  });

  it('handler failure degrades to ok:false (never rejects)', async () => {
    const dispatch = createToolDispatcher({
      settings: () => ({ ...DEFAULT_SETTINGS }),
      memory: {
        remember: async () => {
          throw new Error('disk on fire');
        },
        recall: async () => [],
        list: async () => [],
      },
      env: {},
      platform: 'win32',
    });
    const result = await dispatch({ id: 'm3', tool: 'memory', args: { action: 'remember', text: 'x' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Tool memory failed: disk on fire');
  });
});
