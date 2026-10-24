import PersonaHarness from './dev/PersonaHarness';

// Phase-1 root: routes the two Electron windows (overlay | settings) plus the dev persona
// harness at #/dev/persona. Task D replaces the overlay stub with the live SessionController
// (PersonaStage + Captions + VoiceProvider); Task E replaces the settings stub.
export default function App() {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  if (hash.startsWith('#/dev/persona')) return <PersonaHarness />;

  const kind = new URLSearchParams(window.location.search).get('window') ?? 'settings';
  if (kind === 'overlay') {
    return <div className="h-full w-full bg-transparent" />;
  }
  return (
    <div className="h-full w-full bg-zinc-950 text-zinc-100">
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-semibold">Mitra</p>
          <p className="mt-2 text-sm text-zinc-400">
            settings shell ready — Task E replaces this · dev: <a className="underline" href="#/dev/persona">#/dev/persona</a>
          </p>
        </div>
      </div>
    </div>
  );
}
