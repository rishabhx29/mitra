// ACL: maps every Tool to the permission gate that must be granted before the
// Local Bridge executes it (plan Review Focus #2). Pure logic — no I/O — so the
// dispatcher can enforce it and vitest can pin the full matrix.
import type { Permissions, ToolName } from '../shared/types';

/**
 * Gate names mirror the keys of `Permissions` in shared/types (frozen).
 * ToolGate adds 'none' for read-only local tools that need no grant at all —
 * they are always allowed and can never produce a denial reason. (The union
 * lives on TOOL_GATES values, NOT on PermissionGate, so UI code that indexes
 * Permissions by gate keeps compiling.)
 */
export type PermissionGate = keyof Permissions;
export type ToolGate = PermissionGate | 'none';

export const TOOL_GATES: Readonly<Record<ToolName, ToolGate>> = {
  // Ultron port rows 1/2/3/4: workspace bundles, reminders and the workstation
  // lock all act on the machine the way launch_app does → launcher gate.
  notion_add_todo: 'notion',
  launch_app: 'launcher',
  run_opencode_task: 'terminal',
  open_url: 'browser',
  workspace_mode: 'launcher',
  set_reminder: 'launcher',
  list_reminders: 'launcher',
  lock_workstation: 'launcher',
  // Ultron port row 5: memory is notes semantics → notion gate.
  memory: 'notion',
  // Ultron port row 6: status briefing is read-only + local → no gate.
  status_briefing: 'none',
  // Real-world task tools (docs/DECISION_TIER_PLAN.md §2): writing a local
  // notes file + opening Notepad acts like launching an app → launcher;
  // youtube_search opens a URL → browser; agenda_today reads the to-do
  // board → notion (same gate as the tool that writes it).
  note_notepad: 'launcher',
  youtube_search: 'browser',
  agenda_today: 'notion',
  // §2b general app control: machine-side actions → launcher; web → browser.
  open_any_app: 'launcher',
  close_app: 'launcher',
  web_search: 'browser',
};

export interface PermissionDecision {
  allowed: boolean;
  gate: ToolGate;
  /** Set only when denied; exact string used as the ToolResult summary. */
  reason?: string;
}

/**
 * Decide whether `tool` may run under `permissions`.
 * Denied results NEVER execute — the dispatcher short-circuits on `allowed === false`.
 */
export function checkPermission(tool: ToolName, permissions: Permissions): PermissionDecision {
  const gate = TOOL_GATES[tool];
  if (gate === 'none') {
    return { allowed: true, gate };
  }
  if (permissions[gate]) {
    return { allowed: true, gate };
  }
  return { allowed: false, gate, reason: `Permission denied: ${gate}` };
}
