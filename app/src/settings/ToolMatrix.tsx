// ToolMatrix — the legibility layer for the permission gates: EVERY tool the
// assistant can execute, grouped under the gate that unlocks it. The mapping
// comes from shared/toolGates.ts — the same single source server/acl.ts
// enforces in main — so this page can never drift from what the bridge
// actually runs. Read-only by design: the toggles live in PermissionsPanel
// (section 2.2); when a gate is off, its tools' gate chips render muted/struck.
import { TOOL_GATES, type ToolGate } from '../shared/toolGates';
import type { Permissions, ToolName } from '../shared/types';
import { Badge, Card, type Tt } from './ui';

/** Group order: the four permission gates in toggle order, then gateless tools. */
const GATE_ORDER: readonly ToolGate[] = ['notion', 'launcher', 'terminal', 'browser', 'none'];

const ALL_TOOLS = Object.keys(TOOL_GATES) as ToolName[];

/** '{n} tools' / '{n} टूल' — the i18n layer is plain strings, so interpolate here. */
function countLabel(tt: Tt, n: number): string {
  return tt('page.capabilities.toolMatrix.count').replace('{n}', String(n));
}

export default function ToolMatrix({ permissions, tt }: { permissions: Permissions; tt: Tt }) {
  const gateLabel = (gate: ToolGate): string =>
    gate === 'none' ? tt('page.capabilities.toolMatrix.gateNone') : tt(`perm.${gate}`);

  return (
    <Card
      micro={tt('settings.micro.tools')}
      right={
        <Badge tone="accent">{countLabel(tt, ALL_TOOLS.length)}</Badge>
      }
    >
      <div className="space-y-5">
        {GATE_ORDER.map((gate) => {
          const tools = ALL_TOOLS.filter((tool) => TOOL_GATES[tool] === gate);
          if (tools.length === 0) return null;
          // Gateless tools never lock; every other group follows its toggle live.
          const unlocked = gate === 'none' ? true : permissions[gate];
          return (
            <div key={gate}>
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={unlocked ? 'ok' : 'muted'}>{gateLabel(gate)}</Badge>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                  {countLabel(tt, tools.length)}
                </span>
                {gate === 'none' && (
                  <span className="text-[11px] text-zinc-500">
                    {tt('page.capabilities.toolMatrix.alwaysAllowed')}
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {tools.map((tool) => (
                  <li key={tool} className="glass-row flex items-center gap-3 px-3 py-2">
                    <code
                      className={`shrink-0 font-mono text-[11px] ${
                        unlocked ? 'text-zinc-100' : 'text-zinc-500'
                      }`}
                    >
                      {tool}
                    </code>
                    <span
                      className={`min-w-0 flex-1 text-xs leading-relaxed ${
                        unlocked ? 'text-zinc-400' : 'text-zinc-600'
                      }`}
                    >
                      {tt(`tool.${tool}.desc`)}
                    </span>
                    <span
                      title={gateLabel(gate)}
                      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                        unlocked
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-white/10 bg-white/5 text-zinc-500 line-through'
                      }`}
                    >
                      {gate}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
