// Curated offline STT languages (Vosk small models, Apache-2.0, official mirror)
// paired with BCP-47 tags for OS TTS voices. Free forever: models download once
// into userData and everything runs on-device (docs/CONSOLE_PLAN.md tier 1 brain
// pairs this with local Ollama chat for a fully offline assistant).
export interface VoiceLanguage {
  /** Stable id used in Settings.voiceLanguage + model filenames. */
  id: string;
  /** English label for pickers. */
  label: string;
  /** Native label shown next to the English one. */
  native: string;
  /** BCP-47 tag for speechSynthesis voice matching. */
  ttsLang: string;
  /** Official Vosk small-model zip. */
  modelUrl: string;
  /** Approximate download size (MB) for UI hints. */
  approxMb: number;
}

export const VOICE_LANGUAGES: readonly VoiceLanguage[] = [
  { id: 'en-us', label: 'English (US)', native: 'English', ttsLang: 'en-US', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip', approxMb: 40 },
  { id: 'en-in', label: 'English (India)', native: 'English (IN)', ttsLang: 'en-IN', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip', approxMb: 45 },
  { id: 'hi', label: 'Hindi', native: 'हिन्दी', ttsLang: 'hi-IN', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip', approxMb: 40 },
  { id: 'gu', label: 'Gujarati', native: 'ગુજરાતી', ttsLang: 'gu-IN', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-gu-0.42.zip', approxMb: 40 },
  { id: 'te', label: 'Telugu', native: 'తెలుగు', ttsLang: 'te-IN', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-te-0.42.zip', approxMb: 40 },
  { id: 'es', label: 'Spanish', native: 'Español', ttsLang: 'es-ES', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip', approxMb: 40 },
  { id: 'fr', label: 'French', native: 'Français', ttsLang: 'fr-FR', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip', approxMb: 40 },
  { id: 'de', label: 'German', native: 'Deutsch', ttsLang: 'de-DE', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip', approxMb: 40 },
  { id: 'it', label: 'Italian', native: 'Italiano', ttsLang: 'it-IT', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-it-0.22.zip', approxMb: 50 },
  { id: 'pt', label: 'Portuguese', native: 'Português', ttsLang: 'pt-BR', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip', approxMb: 20 },
  { id: 'ru', label: 'Russian', native: 'Русский', ttsLang: 'ru-RU', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip', approxMb: 45 },
  { id: 'ja', label: 'Japanese', native: '日本語', ttsLang: 'ja-JP', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-ja-0.22.zip', approxMb: 50 },
  { id: 'ko', label: 'Korean', native: '한국어', ttsLang: 'ko-KR', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-ko-0.22.zip', approxMb: 30 },
  { id: 'cn', label: 'Chinese', native: '中文', ttsLang: 'zh-CN', modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip', approxMb: 40 },
] as const;

export const DEFAULT_VOICE_LANGUAGE = 'en-us';

export function findVoiceLanguage(id: string | undefined): VoiceLanguage {
  return VOICE_LANGUAGES.find((l) => l.id === id) ?? VOICE_LANGUAGES[0];
}
