// ACL: maps every Tool to the permission gate that must be granted before the
// Local Bridge executes it (plan Review Focus #2). Pure logic — no I/O — so the
// dispatcher can enforce it and vitest can pin the full matrix.
//
// The tool→gate MAPPING itself lives in shared/toolGates.ts (one source of
// truth, also consumed by the renderer's Capabilities tool matrix); this module
// consumes it and owns the runtime decision logic. The mapping + gate types are
// re-exported so existing consumers (PermissionsPanel, acl.test.ts) keep their
// import site.
import type { Permissions, ToolName } from '../shared/types';
import { TOOL_GATES, type ToolGate } from '../shared/toolGates';

export { TOOL_GATES };
export type { PermissionGate, ToolGate } from '../shared/toolGates';

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
