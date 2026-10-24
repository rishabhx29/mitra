import PersonaHarness from './dev/PersonaHarness';
import SettingsApp from './settings/App';
import Overlay from './overlay/Overlay';
import FullscreenAvatarView from './settings/FullscreenAvatarView';

// Root: routes the Electron windows (overlay | settings | fullscreen avatar viewer)
// plus the dev persona harness at #/dev/persona.
export default function App() {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  if (hash.startsWith('#/dev/persona')) return <PersonaHarness />;

  const kind = new URLSearchParams(window.location.search).get('window') ?? 'settings';
  if (kind === 'overlay') {
    return <Overlay />;
  }
  if (kind === 'fullscreen') {
    return <FullscreenAvatarView />;
  }
  return <SettingsApp />;
}
