// ACL matrix — plan Review Focus #2: a tool without permission never executes and
// produces the exact refusal shape { ok:false, summary:'Permission denied: <gate>' }.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Permissions, type ToolName } from '../shared/types';
import { checkPermission, TOOL_GATES, type PermissionGate } from './acl';

const ALL_DENIED: Permissions = { notion: false, launcher: false, terminal: false, browser: false };
const ALL_GRANTED: Permissions = { notion: true, launcher: true, terminal: true, browser: true };

const TOOL_GATE_CASES: Array<[ToolName, PermissionGate]> = [
  ['notion_add_todo', 'notion'],
  ['launch_app', 'launcher'],
  ['run_opencode_task', 'terminal'],
  ['open_url', 'browser'],
];

describe('TOOL_GATES mapping (plan Task C)', () => {
  it.each(TOOL_GATE_CASES)('%s → %s gate', (tool, gate) => {
    expect(TOOL_GATES[tool]).toBe(gate);
  });

  it('covers every ToolName', () => {
    expect(Object.keys(TOOL_GATES).sort()).toEqual(
      ['launch_app', 'notion_add_todo', 'open_url', 'run_opencode_task'].sort(),
    );
  });
});

describe('checkPermission — granted', () => {
  it.each(TOOL_GATE_CASES)('%s allowed when its gate is granted', (tool, gate) => {
    const decision = checkPermission(tool, ALL_GRANTED);
    expect(decision.allowed).toBe(true);
    expect(decision.gate).toBe(gate);
    expect(decision.reason).toBeUndefined();
  });
});

describe('checkPermission — denied (full matrix)', () => {
  it.each(TOOL_GATE_CASES)('%s denied when every gate is false', (tool, gate) => {
    const decision = checkPermission(tool, ALL_DENIED);
    expect(decision.allowed).toBe(false);
    expect(decision.gate).toBe(gate);
    expect(decision.reason).toBe(`Permission denied: ${gate}`);
  });

  it.each(TOOL_GATE_CASES)('%s denied when ONLY its own gate is false (isolation)', (tool, gate) => {
    const permissions: Permissions = { ...ALL_GRANTED, [gate]: false };
    const decision = checkPermission(tool, permissions);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(`Permission denied: ${gate}`);
  });

  it.each(TOOL_GATE_CASES)('%s still allowed when the OTHER gates are false (no cross-leak)', (tool, gate) => {
    const permissions: Permissions = { ...ALL_DENIED, [gate]: true };
    const decision = checkPermission(tool, permissions);
    expect(decision.allowed).toBe(true);
    expect(decision.gate).toBe(gate);
  });
});

describe('shipped defaults (DEFAULT_SETTINGS.permissions)', () => {
  // DEFAULT_SETTINGS: { notion: true, launcher: true, terminal: false, browser: true }
  it('notion_add_todo is allowed out of the box', () => {
    expect(checkPermission('notion_add_todo', DEFAULT_SETTINGS.permissions).allowed).toBe(true);
  });

  it('launch_app is allowed out of the box', () => {
    expect(checkPermission('launch_app', DEFAULT_SETTINGS.permissions).allowed).toBe(true);
  });

  it('run_opencode_task is DENIED out of the box (terminal: false)', () => {
    const decision = checkPermission('run_opencode_task', DEFAULT_SETTINGS.permissions);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('Permission denied: terminal');
  });

  it('open_url is allowed out of the box', () => {
    expect(checkPermission('open_url', DEFAULT_SETTINGS.permissions).allowed).toBe(true);
  });
});
