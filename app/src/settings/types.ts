// Shared prop types for the settings panels (Task E).
import type { Settings } from '../shared/types';

/** Persist a validated settings patch; App shows the status.saved toast. */
export type SaveFn = (patch: Partial<Settings>) => void;

/** Which panel is open in the settings window. */
export type SectionId =
  | 'persona'
  | 'permissions'
  | 'apps'
  | 'notion'
  | 'hotkey'
  | 'language'
  | 'transcript';
