import { en } from './en';
import { hi } from './hi';

export type Lang = 'en' | 'hi';
const dicts: Record<Lang, Record<string, string>> = { en, hi };

export function t(lang: Lang, key: string): string {
  return dicts[lang][key] ?? dicts.en[key] ?? key;
}
