// BootSequence — the console's first-open neural-boot log (docs/CONSOLE_PLAN.md
// "boot sequence on first open"): monospace lines that animate in line-by-line
// (the reveal timing lives in ConsoleApp; this is the pure renderer), with a
// blinking cursor while the sequence is still running.
export function BootSequence({ lines, done }: { lines: string[]; done: boolean }) {
  return (
    <div data-testid="console-boot" className="space-y-1.5 py-2 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        <p key={`${i}-${line}`} className="console-entry flex items-center gap-2 text-zinc-500">
          <span aria-hidden="true" style={{ color: 'color-mix(in oklab, var(--orb-a) 65%, white)' }}>
            ▸
          </span>
          {line}
          {i === lines.length - 1 && !done && <span className="console-cursor" aria-hidden="true">▊</span>}
        </p>
      ))}
    </div>
  );
}
