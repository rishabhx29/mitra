// PermissionsPanel (Task E): the 4 ACL toggles. Keys mirror Permissions in
// shared/types (perm.* i18n keys); each toggle saves immediately and gates the
// named tool (gate↔tool mapping imported from the bridge's acl.ts — same source
// of truth the Local Bridge enforces).

import type { PermissionGate, } from '../server/acl';
import { TOOL_GATES } from '../server/acl';
import type { Settings, ToolName } from '../shared/types';
import { Badge, Card, Toggle, Tt } from './ui';
import type { SaveFn } from './types';

const GATES: readonly PermissionGate[] = ['notion', 'launcher', 'terminal', 'browser'];

function toolForGate(gate: PermissionGate): ToolName {
  const entry = (Object.entries(TOOL_GATES) as Array<[ToolName, PermissionGate]>).find(
    ([, g]) => g === gate,
  );
  return entry![0];
}

export default function PermissionsPanel({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  const { permissions } = settings;
  const activeCount = GATES.filter((g) => permissions[g]).length;

  return (
    <div className="stagger space-y-4">
      <Card
        micro={tt('settings.micro.permissions')}
        title={tt('settings.permissions')}
        help={tt('settings.permissions.help')}
      >
        <ul className="space-y-2">
          {GATES.map((gate) => {
            const active = permissions[gate];
            return (
              <li key={gate} className="glass-row flex items-center gap-3 px-3 py-2.5">
                <Toggle
                  checked={active}
                  label={tt(`perm.${gate}`)}
                  onChange={(next) => save({ permissions: { ...permissions, [gate]: next } })}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-zinc-100">{tt(`perm.${gate}`)}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{toolForGate(gate)}</div>
                </div>
                {active && <Badge tone="ok">{tt('settings.permissions.active')}</Badge>}
              </li>
            );
          })}
        </ul>
        {activeCount === 0 && (
          <p className="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {tt('settings.permissions.noneActive')}
          </p>
        )}
      </Card>
    </div>
  );
}
