// status_briefing — a spoken snapshot of the machine + Mitra itself
// (docs/ULTRON_PORT.md row 6; the Ultron context-watchdog/fatigue parts were
// deliberately NOT ported). Read-only and local, so it needs NO permission gate
// (acl.ts maps it to 'none'). All probes are injectable:
//   - power: Electron powerMonitor-shaped dep ({ isOnBatteryPower }) — Electron
//     exposes charging state only, no percentage, so the briefing says
//     "charging" / "on battery power" and never invents a number.
//   - os: node:os-shaped dep ({ uptime, platform }) — defaults to the real
//     node:os module.
//   - counts come from the shared memory store and mock Notion board.
import * as nodeOs from 'node:os';
import process from 'node:process';
import type { ToolOutcome } from './notion';

export interface PowerMonitorLike {
  isOnBatteryPower(): boolean;
}

export interface OsLike {
  uptime(): number;
  platform(): string;
}

export interface StatusBriefingDeps {
  power?: PowerMonitorLike;
  os?: OsLike;
  env?: Record<string, string | undefined>;
  memoryCount: () => number | Promise<number>;
  notionItemCount: () => number | Promise<number>;
}

/**
 * Mirrors bolnaKeys() in ../bridge.ts — kept local to avoid a
 * bridge → tools/index → tools/status → bridge import cycle.
 */
export function hasBolnaKeys(env: Record<string, string | undefined>): boolean {
  return Boolean(env['BOLNA_API_KEY']?.trim() && env['BOLNA_AGENT_ID']?.trim());
}

/** "2h 14m", "10m", "45s" — speakable short form. */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${secs}s`;
}

/** Friendly OS name for TTS; unknown platforms pass through verbatim. */
export function platformLabel(platform: string): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

export function createStatusBriefingTool(
  deps: StatusBriefingDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const os = deps.os ?? nodeOs;
  return async () => {
    const env = deps.env ?? process.env;
    const live = hasBolnaKeys(env);

    let powerText: string | null = null;
    let charging: boolean | null = null;
    let onBattery: boolean | null = null;
    if (deps.power && typeof deps.power.isOnBatteryPower === 'function') {
      onBattery = deps.power.isOnBatteryPower();
      charging = !onBattery;
      powerText = onBattery ? 'on battery power' : 'charging';
    }

    const uptimeSeconds = os.uptime();
    const platform = os.platform();
    const memoryCount = await deps.memoryCount();
    const notionItemCount = await deps.notionItemCount();

    const bits = [
      powerText,
      `up ${formatUptime(uptimeSeconds)}`,
      `on ${platformLabel(platform)}`,
      live ? 'live mode (Bolna connected)' : 'mock mode (no Bolna keys)',
      `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}`,
      `${notionItemCount} ${notionItemCount === 1 ? 'to-do' : 'to-dos'}`,
    ].filter(Boolean) as string[];

    return {
      ok: true,
      summary: `Status: ${bits.join(', ')}.`,
      data: {
        charging,
        onBattery,
        powerKnown: powerText !== null,
        uptimeSeconds,
        platform,
        providerMode: live ? ('live' as const) : ('mock' as const),
        memoryCount,
        notionItemCount,
      },
    };
  };
}
