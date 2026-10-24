import PersonaHarness from './dev/PersonaHarness';
import SettingsApp from './settings/App';
import Overlay from './overlay/Overlay';

// Root: routes the two Electron windows (overlay | settings) plus the dev persona
// harness at #/dev/persona. The overlay branch is Task D's (voice) mount point —
// keep it byte-identical; settings is Task E's window.
export default function App() {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  if (hash.startsWith('#/dev/persona')) return <PersonaHarness />;

  const kind = new URLSearchParams(window.location.search).get('window') ?? 'settings';
  if (kind === 'overlay') {
    return <Overlay />;
  }
  return <SettingsApp />;
}
