export default function App() {
  // Phase 1: this becomes the settings-window root (Task E) / overlay root (Task D).
  // The Electron main process loads the same renderer with ?window=overlay | settings.
  const kind = new URLSearchParams(window.location.search).get('window') ?? 'settings';
  return (
    <div className={kind === 'overlay' ? 'h-full w-full bg-transparent' : 'h-full w-full bg-zinc-950 text-zinc-100'}>
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-semibold">Mitra</p>
          <p className="mt-2 text-sm text-zinc-400">scaffold ready — window: {kind}</p>
        </div>
      </div>
    </div>
  );
}
