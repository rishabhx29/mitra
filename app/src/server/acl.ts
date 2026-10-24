// ACL: maps every Tool to the permission gate that must be granted before the
// Local Bridge executes it (plan Review Focus #2). Pure logic — no I/O — so the
// dispatcher can enforce it and vitest can pin the full matrix.
import type { Permissions, ToolName } from '../shared/types';

/** Gate names mirror the keys of `Permissions` in shared/types (frozen). */
export type PermissionGate = keyof Permissions;

export const TOOL_GATES: Readonly<Record<ToolName, PermissionGate>> = {
  notion_add_todo: 'notion',
  launch_app: 'launcher',
  run_opencode_task: 'terminal',
  open_url: 'browser',
};

export interface PermissionDecision {
  allowed: boolean;
  gate: PermissionGate;
  /** Set only when denied; exact string used as the ToolResult summary. */
  reason?: string;
}

/**
 * Decide whether `tool` may run under `permissions`.
 * Denied results NEVER execute — the dispatcher short-circuits on `allowed === false`.
 */
export function checkPermission(tool: ToolName, permissions: Permissions): PermissionDecision {
  const gate = TOOL_GATES[tool];
  if (permissions[gate]) {
    return { allowed: true, gate };
  }
  return { allowed: false, gate, reason: `Permission denied: ${gate}` };
}
