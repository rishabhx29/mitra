// Dev-only bootstrap for /dev/harness.html (see that file's header).
import { createRoot } from 'react-dom/client';
import PersonaHarness from './PersonaHarness';
import '../index.css';

createRoot(document.getElementById('root')!).render(<PersonaHarness />);
