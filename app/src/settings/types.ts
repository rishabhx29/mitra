// Shared prop types for the settings panels (Task E).
import type { Settings } from '../shared/types';

/** Persist a validated settings patch; App shows the status.saved toast. */
export type SaveFn = (patch: Partial<Settings>) => void;

/** Which panel is open in the settings window ('home' is the landing page). */
export type SectionId =
  | 'home'
  | 'persona'
  | 'permissions'
  | 'apps'
  | 'modes'
  | 'notion'
  | 'memory'
  | 'hotkey'
  | 'language'
  | 'transcript';
