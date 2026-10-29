// Intent parsing layer — the pure, DOM-free half of the voice brain, split out
// of mockProvider.ts so the MAIN-process side (server/bridge.ts →
// server/router.ts pickArgs) can share the exact same regexes without pulling
// requestAnimationFrame/DOM types into tsconfig.node.json. Everything here is
// pure logic (en / Hindi-Devanagari / Hinglish), unit-tested across all three.
//
// NOTE: mockProvider.ts re-exports this module's public surface, so existing
// `from './mockProvider'` / `from '../voice'` imports keep working.
import type { ToolName, WorkspaceMode } from '../shared/types';
import type { MockIntent } from './types';
import { t, type Lang } from '../i18n';

/** Strip trailing punctuation + collapse whitespace; keep inner dots (URLs). */
export function normalizeUtterance(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,!?;:"'’।]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanupCapture(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// 1) stop / end the session — full-utterance matches only ("stop the music" is NOT stop).
const STOP_RE =
  /^(?:stop|stop it|shut up|exit|quit|bye|goodbye|alvida|ruko|ruk ja|ruk jao|band karo|bandh karo|chup|chup ho jao|बंद करो|रुको|रुक जाओ|चुप|अलविदा)$/;

// 2) language switch — "speak hindi" / "ab hindi me bolo" / "हिंदी में बोलो" (+english).
const LANG_HI_RE =
  /\b(?:speak|talk)\s+(?:in\s+)?hindi\b|\bab\s+(?:se\s+)?hindi\b|\bhindi\b\s*(?:me(?:in)?)?\s*(?:bolo|bol|baat)\b|हिंदी\s*(?:में)?\s*(?:बोलो|बात करो)/;
const LANG_EN_RE =
  /\b(?:speak|talk)\s+(?:in\s+)?english\b|\bab\s+(?:se\s+)?english\b|\benglish\b\s*(?:me(?:in)?)?\s*(?:bolo|bol|baat)\b|अंग्रेज़?ी\s*(?:में)?\s*(?:बोलो|बात करो)/;

// 2b) identity — "who are you" / "what can you do" / "tum kaun ho" (+ Devanagari).
//     Checked EARLY (right after stop/language) so the console's own hint chip
//     ("who are you?") always gets a real self-introduction instead of the
//     clarify fallback when the chat brain is slow or absent.
const IDENTITY_RE =
  /\b(?:who\s+are\s+you|what\s+can\s+you\s+do|what(?:'s|\s+is)\s+your\s+name|tum\s+kaun\s+ho|aap\s+kaun\s+ho|tumhara\s+naam|aapka\s+naam)\b|तुम\s*कौन\s*हो|आप\s*कौन\s*हो|तुम्हारा\s*नाम|आपका\s*नाम/;

// 3) opencode task — BEFORE launch-app so "open opencode and build …" routes to the tool.
const OPENCODE_RES: RegExp[] = [
  /^open\s+opencode\s+(?:and|aur|or|phir|then)?\s*(?:please\s+)?(?:build|design|deso|make|banao|bana|likho|run|chalu|chala)\b[\s:,-]*(.+)$/,
  /^opencode\s+(?:me|mein|par|pe)\s+(.+?)\s+(?:banao|bana|likho|build)$/,
  /^opencode\s+(?:build|design|deso|make|banao|bana|likho|run)\b[\s:,-]*(.+)$/,
];

// 4) add-todo — "add X to my (todo )?list" / "list me X" / "X add karo" / "meri list me X jodo" (+ Devanagari).
// Order matters: the "…me X jodo" variant runs before bare "list me X" so the
// verb ending is consumed, not captured into the to-do text.
const ADD_RES: RegExp[] = [
  /^add\s+(.+?)\s+to\s+(?:(?:my|the|meri)\s+)?(?:todo|to-do|to\s?do|task)?\s*list$/,
  /^(?:meri\s+)?list\s+(?:me|mein|may)\s+(.+?)\s+(?:jodo|jod do|daal do|daalo|add karo)$/,
  /^(.+?)\s+add\s+karo$/,
  /^(.+?)\s+(?:jodo|daal do|daalo)$/,
  /^list\s+(?:me\s+|up\s+)?(.+?)(?:\s+(?:on|to|in)\s+(?:(?:my|the)\s+)?list)?$/,
  /^(?:मेरी\s+)?लिस्ट\s*(?:में|मे)\s*(.+?)\s*(?:जोड़ो|जोड़ दो|डालो|ऐड करो)$/,
  /^(.+?)\s+(?:जोड़ो|जोड़ दो|डालो)$/,
];

// 5) open-url — URL-shaped input ("open github.com", "https://…", "www.…").
const ABSOLUTE_URL_RE = /(?:https?:\/\/|www\.)[^\s]+/i;
const BARE_DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|ai|dev|in|co|app|xyz|me|gov|edu)(?:\/[^\s]*)?/i;

// 6) launch-app — "open X" / "X kholo" (+ Devanagari).
const LAUNCH_RES: RegExp[] = [
  /^(?:open|launch|start|run|khol|kholo|khol do|chalu karo|shuru karo)\s+(.+)$/,
  /^(.+?)\s+khol(?:o| do)?$/,
  /^(.+?)\s+खोल(?:ो| दो)?$/,
  /^खोल(?:ो)?\s+(.+)$/,
  /^(.+?)\s+चालू करो$/,
];

// 6b) app_task — open an app AND write/type specific content into it ("open
//     notepad and write hello", "msword me note likho", "vscode kholo aur X
//     likho"). Checked AFTER note_notepad/add-todo (so bare "note down X" /
//     "X daalo" keep their own tools) and just BEFORE launch_app (which would
//     otherwise swallow the whole composite as a mangled alias). Every shape
//     must yield BOTH an app token and a >2-char content remainder — a bare
//     "open notepad" falls through to launch_app unchanged. Named groups keep
//     the content-first table row readable.
export const APP_TASK_RES: RegExp[] = [
  // en composite: "open notepad and write hello" / "launch calc, type 2+2"
  /^(?:open|launch|start)\s+(?<app>.{1,40}?)\s*(?:,|\s+(?:and|aur|then|phir)\s+)\s*(?:write|type|note|add|paste|put|enter)\s+(?<content>.+)$/,
  // en content-first: "write hello into mspaint" (notepad variants stay note_notepad)
  /^(?:write|type|note|put)\s+(?<content>.+?)\s+(?:in|into|on|to)\s+(?<app>.{1,40}?)$/,
  // Hinglish app-first: "msword me note likho" (the notepad variant = note_notepad)
  /^(?<app>.{1,40}?)\s*(?:mein|me|main)\s*(?<content>.+?)\s*(?:likho|likh\s+do|type\s+karo|daalo|daal\s+do|add\s+karo)$/,
  // Hinglish kholo composite: "vscode kholo aur hello world likho"
  /^(?<app>.{1,40}?)\s+kholo\s*(?:aur|and)?\s*(?<content>.+?)\s*(?:likho|likh\s+do|type\s+karo)$/,
];

/** App tokens that route to their own richer tool instead of plain app_task. */
const OPENCODE_APP_RE = /^opencode$/;

/**
 * Parse an app_task composite ("open notepad and write hello") into its app +
 * content, or null when no shape matches / the content is too short to be a
 * real task (≤2 chars → the caller falls through, eventually to launch_app).
 * An opencode app token returns the existing opencode_task intent so the
 * composite runs run_opencode_task (which already knows how to drive it).
 * Exported for the bridge router's pickArgs (Laya names the tool, regexes
 * parameterize it — same contract as the other shared parsers).
 */
export function parseAppTask(text: string): MockIntent | null {
  for (const re of APP_TASK_RES) {
    const m = re.exec(text);
    if (!m || !m.groups) continue;
    const app = cleanupCapture((m.groups['app'] ?? '').replace(/^(?:the|a|an|mera|meri|apna)\s+/, ''));
    // Trim trailing punctuation from the content; require a real task (>2 chars).
    const content = cleanupCapture((m.groups['content'] ?? '').replace(/[.,!?;:"'’।]+$/, ''));
    if (!app || content.length <= 2) continue;
    if (OPENCODE_APP_RE.test(app.toLowerCase())) return { kind: 'opencode_task', prompt: content };
    return { kind: 'app_task', app, content };
  }
  return null;
}

// 7) set_reminder — Ultron port rows 2–3 (clean-room phrasing). Minutes-only
//    scope per the ledger; Devanagari digits are mapped to ASCII first and
//    मिनट is accepted as the unit word. Patterns run on the digit-normalized
//    text and yield {minutes, text} (text optional).
const REMIND_ME_RES: RegExp[] = [
  /^(?:please\s+)?remind me (?:in|after)\s+(\d+) ?(?:m\b|mins?\b|minutes?\b|मिनट)\s*(?:(?:to|for|ki)\s+(.+))?$/,
];
const TIMER_RES: RegExp[] = [
  /^(\d+) ?(?:minutes?|mins?|मिनट) ka timer\s*(?:(?:to|for|ki)\s+(.+))?$/,
  /^(\d+) मिनट का टाइमर\s*(?:(?:कि|ki)\s+(.+))?$/,
  /^(\d+) मिनट बाद(?:\s+(.+?))?\s*(?:याद दिलाओ|याद दिलाना|रिमाइंडर दो|रिमाइंडर)?$/,
];

/** Minutes window for reminders: ≥1 and ≤ a day (nonsense values clarify instead). */
const MIN_REMINDER_MINUTES = 1;
const MAX_REMINDER_MINUTES = 24 * 60;

/** Devanagari digits → ASCII so "४ मिनट" parses like "4 मिनट". */
function normalizeDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)));
}

/** Parse the reminder duration shapes (exported for the bridge router's pickArgs). */
export function parseReminder(text: string): { minutes: number; text: string } | null {
  const norm = normalizeDigits(text);
  const attempt = (res: RegExp[]): { minutes: number; text: string } | null => {
    for (const re of res) {
      const m = re.exec(norm);
      if (!m) continue;
      const minutes = Number.parseInt(m[1] ?? '', 10);
      if (!Number.isFinite(minutes) || minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES) {
        continue; // out-of-range nonsense → try the next shape / fall through
      }
      return { minutes, text: cleanupCapture(m[2] ?? '') };
    }
    return null;
  };
  return attempt(REMIND_ME_RES) ?? attempt(TIMER_RES);
}

// 8) memory — Ultron port row 5 (Cerebro-lite). Recall-all first (exact), then
//    recall-with-query, then remember. Our own en/Hinglish/Devanagari phrasing.
const MEMORY_RECALL_ALL_RES = [
  /^(?:what do you remember|what all do you remember|kya yaad hai|kya yaad rakha hai|क्या याद है)$/,
];
const MEMORY_RECALL_RES: RegExp[] = [
  /^(?:what do you remember|what do you know)\s+about\s+(.+)$/,
  /^(.+?)\s+ke baare me(?:in)?\s+kya yaad hai$/,
  /^(?:kya\s+)?yaad hai\s+(.+?)(?:\s+ke baare me(?:in)?)?$/,
  /^(.+?)\s+के बारे में क्या याद है$/,
  /^(?:क्या\s+)?याद है\s+(.+?)(?:\s+के बारे में)?$/,
];
const MEMORY_REMEMBER_RES: RegExp[] = [
  /^remember\s+(?:that\s+|this\s+|it\s+)?(.+)$/,
  /^yaad rakho(?:\s+(?:ki|ke))?\s+(.+)$/,
  /^yaad rakhna(?:\s+ki)?\s+(.+)$/,
  /^याद रख(?:ो|ना|िए)(?:\s+कि)?\s+(.+)$/,
];

/**
 * A capture that is only a connector word means the regex backtracked past a
 * dangling "remember that" / "yaad rakho ki" — that is no memory, that is a
 * clarify. (firstCapture cannot express this, so memory gets its own matcher.)
 */
const MEMORY_CONNECTOR_WORDS = new Set(['that', 'this', 'it', 'ki', 'ke', 'कि']);

/** Well-known site tokens -> canonical URLs (checked before app aliases). */
const WELL_KNOWN_SITES: Readonly<Record<string, string>> = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  github: 'https://github.com',
  reddit: 'https://www.reddit.com',
  netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  instagram: 'https://www.instagram.com',
  whatsapp: 'https://web.whatsapp.com',
  facebook: 'https://www.facebook.com',
  chatgpt: 'https://chatgpt.com',
  amazon: 'https://www.amazon.in',
  flipkart: 'https://www.flipkart.com',
  linkedin: 'https://www.linkedin.com',
};

/** "open youtube" / "youtube kholo" / "go to github" -> canonical URL, else null. */
export function matchWellKnownSite(text: string): string | null {
  const t = text.toLowerCase();
  const hasVerb = /\b(open|kholo|go\s+to|visit|launch)\b/.test(t);
  if (!hasVerb) return null;
  for (const [token, url] of Object.entries(WELL_KNOWN_SITES)) {
    if (new RegExp(`\\b${token}\\b`).test(t)) return url;
  }
  return null;
}

function parseMemory(text: string): MockIntent | null {
  if (MEMORY_RECALL_ALL_RES.some((re) => re.test(text))) return { kind: 'memory_recall_all' };
  for (const re of MEMORY_RECALL_RES) {
    const m = re.exec(text);
    const query = m ? cleanupCapture(m[1] ?? '') : '';
    if (query && !MEMORY_CONNECTOR_WORDS.has(query)) return { kind: 'memory_recall', query };
  }
  for (const re of MEMORY_REMEMBER_RES) {
    const m = re.exec(text);
    const memo = m ? cleanupCapture(m[1] ?? '') : '';
    if (memo && !MEMORY_CONNECTOR_WORDS.has(memo)) return { kind: 'memory_remember', text: memo };
  }
  return null;
}

// 9) lock_workstation — Ultron port row 4 (Windows LockWorkStation).
const LOCK_RES: RegExp[] = [
  /^lock(?:\s+(?:my|the|mera|meri))?\s+(?:computer|pc|laptop|screen|workstation|system)$/,
  /^(?:computer|pc|laptop|screen|workstation|system)\s+lock(?:\s+(?:karo|kar do))?$/,
  /^lockdown$/,
  /^lock(?:\s+(?:karo|kar do))?$/,
  /^(?:स्क्रीन|कंप्यूटर|लैपटॉप|सिस्टम)\s*लॉक(?:\s*करो)?$/,
  /^लॉक(?:\s*करो)?$/,
];

// 10) status_briefing — Ultron port row 6. A standalone `status` word (battery
//     status, status batao, …) or a how-are-you greeting triggers the briefing.
const STATUS_WORD_RE = /(?:^|\s)status(?:\s|$)/;
// Anchored so "ye kaise ho gaya" is not a greeting; small prefix/suffix sets
// keep the natural forms ("kaise ho bhai", "sab kaisa hai").
const STATUS_HOW_RES: RegExp[] = [
  /^how are you(?:\s+doing(?:\s+today)?)?(?:\s+today)?$/,
  /^(?:tum\s+|aap\s+|bhai\s+)?kaise ho(?:\s+(?:bhai|yaar))?$/,
  /^(?:sab\s+)?kaisa hai(?:\s+(?:bhai|yaar|sab))?$/,
  /^(?:tum\s+|aap\s+|भाई\s+)?कैसे हो(?:\s+(?:भाई|आप))?$/,
  /^(?:सब\s+)?कैसा है(?:\s+(?:भाई|सब))?$/,
];

// 11) note_notepad — real-world tools (docs/DECISION_TIER_PLAN.md §2). Shared
//     with the bridge router's pickArgs (server/router.ts): deterministic
//     intents and Laya-routed runs extract the note text with the SAME regexes.
//     Order matters: specific shapes ("note this: X") before the bare "note X".
export const NOTE_ARG_RES: RegExp[] = [
  /^note\s+(?:this|that)\s*[:\-]\s*(.+)$/,
  /^note\s+(?:this|that)\s+(.+)$/,
  /^add\s+(.+?)\s+(?:to|in)\s+(?:(?:my|the|meri)\s+)?(?:todo\s+)?notepad$/,
  /^(.+?)\s+(?:to|in)\s+(?:my\s+|meri\s+)?notepad$/,
  /^notepad\s+(?:me\s+|mein\s+|में\s*)?(.+?)\s+(?:add\s+karo|likho|likh\s+do|daalo|daal\s+do)$/,
  /^(.+?)\s+(?:notepad\s+(?:me|mein)|नोटपैड\s*में)\s+(?:add\s+karo|likho|likh\s+do|daalo|daal\s+do)$/,
  /^नोट\s*करो\s*[:\-]?\s*(.+)$/,
  /^(.+?)\s+नोट\s*करो$/,
  /^नोटपैड\s*में\s*(.+?)\s*(?:लिखो|डालो|ऐड\s*करो)$/,
  /^note\s+(.+)$/, // bare "note X" — LAST: "note this: X" must win first
];

// 12) youtube_search — shared with router pickArgs. The final bare "search X"
//     entry is pickArgs-ONLY: deterministic routing for bare "search …" would
//     steal generic queries away from chat; it applies only after Laya has
//     already named youtube_search.
export const YOUTUBE_ARG_RES: RegExp[] = [
  /^open\s+youtube(?:\s+(?:and|aur|or|phir|then|फिर))?\s+(?:search|find|play)\s+(?:for\s+)?(.+)$/,
  /^(?:search|find)\s+(?:for\s+)?(.+?)\s+on\s+youtube$/,
  /^play\s+(.+?)\s+on\s+youtube$/,
  /^(.+?)\s+youtube\s+(?:par|pe)\s+search(?:\s+(?:karo|kare))?$/,
  /^youtube\s+(?:par|pe)\s+(.+?)\s+search(?:\s+(?:karo|kare))?$/,
  /^(.+?)\s+youtube\s+(?:par|pe)\s+(?:chalao|chala(?:o|\s+do)?|laga(?:o|\s+do)?|play|bajao)$/,
  /^youtube\s+(?:par|pe)\s+(.+?)\s+(?:chalao|chala(?:o|\s+do)?|laga(?:o|\s+do)?|play|bajao)$/,
  /^यूट्यूब\s*(?:पर|पे)\s*(.+?)\s*(?:सर्च\s*करो|चलाओ|लगाओ)$/,
  /^(.+?)\s+यूट्यूब\s*(?:पर|पे)\s+(?:सर्च\s*करो|चलाओ)$/,
  /^(?:search|find)\s+(?:for\s+)?(.+)$/, // bare "search X" — pickArgs-only (see above)
];
/** Deterministic youtube_search shapes: everything except the bare-search tail. */
const YOUTUBE_INTENT_RES: RegExp[] = YOUTUBE_ARG_RES.slice(0, YOUTUBE_ARG_RES.length - 1);

// 13) agenda_today — full-utterance matches only (no args). en + Hinglish +
//     Devanagari, per docs/DECISION_TIER_PLAN.md §2.
export const AGENDA_RES: RegExp[] = [

  /^what(?:'s| is|s)?\s+due\s+today$/,
  /^what\s+do\s+i\s+have\s+to\s+do\s+today$/,
  /^(?:is\s+there\s+)?anything\s+(?:on\s+(?:my\s+)?calendar|due)\s+today$/,
  /^what(?:'s| is|s)?\s+on\s+(?:my\s+)?calendar\s+today$/,
  /^aaj\s+(?:kya\s+karna\s+hai|ka\s+kya\s+karna\s+hai|kya\s+kaam\s+hai)$/,
  /^(?:mera\s+)?aaj\s+ka\s+(?:schedule|kaam)(?:\s+bata(?:o|a))?$/,
  /^aaj\s+kya\s+schedule\s+hai$/,
  /^आज\s+क्या\s+करना\s+है$/,
  /^आज\s+मुझे\s+क्या\s+करना\s+है$/,
  /^(?:मेरा\s+)?आज\s+का\s+(?:स्केड्यूल|काम)(?:\s+बताओ)?$/,
];

// §2b general app control + web search (en / hi / Hinglish).
export const CLOSE_APP_RES: RegExp[] = [
  /close\s+(?:the\s+)?(.{2,40}?)\s*(?:app|application)?\s*(?:now|please)?[.?!]?$/,
  /quit\s+(?:the\s+)?(.{2,40}?)[.?!]?$/,
  /band\s+karo\s+(.{2,40}?)[.?!]?$/,
  /(.{2,40}?)\s+band\s+karo[.?!]?$/,
];
export const WEB_SEARCH_RES: RegExp[] = [
  /^google\s+(.{2,80}?)[.?!]?$/,
  /^search\s+(?:the\s+)?web\s+for\s+(.{2,80}?)[.?!]?$/,
  /^web(?:par|pe)?\s+(.{2,80}?)\s+dhundo[.?!]?$/,
  /^web\s+search\s+(.{2,80}?)[.?!]?$/,
];

/** URL-shaped token extraction (exported for the bridge router's pickArgs). */
export function extractUrl(text: string): string | null {
  const trimTail = (s: string): string => s.replace(/[.,;:!?)\]}'"]+$/, '');
  const absolute = ABSOLUTE_URL_RE.exec(text);
  if (absolute) return toUrl(trimTail(absolute[0]));
  const domain = BARE_DOMAIN_RE.exec(text);
  if (domain) return toUrl(trimTail(domain[0]));
  return null;
}

function toUrl(s: string): string {
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** First capture group of the first matching regex, or null. */
function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const captured = m.length > 1 ? (m[1] ?? '') : m[0];
      const value = cleanupCapture(captured);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Tokenize for workspace-mode alias matching: lowercase, apostrophes removed
 * (so "let's code" and "lets code" agree), other punctuation becomes a space
 * (Devanagari letters are \p{L} and survive). Word-boundary matching avoids
 * substring false hits like a short alias inside "status".
 */
function tokenizeUtterance(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Does the utterance contain one of the mode's aliases (as whole words, in
 * order)? Modes are checked in settings order, aliases in listed order — the
 * first hit wins, so a user can prioritize by reordering in the panel.
 */
export function matchWorkspaceMode(raw: string, modes: WorkspaceMode[]): WorkspaceMode | null {
  const tokens = tokenizeUtterance(raw);
  if (tokens.length === 0) return null;
  for (const mode of modes) {
    for (const alias of mode.aliases) {
      const aliasTokens = tokenizeUtterance(alias);
      if (aliasTokens.length === 0 || aliasTokens.length > tokens.length) continue;
      let hit = false;
      for (let i = 0; i + aliasTokens.length <= tokens.length; i++) {
        let ok = true;
        for (let j = 0; j < aliasTokens.length; j++) {
          if (tokens[i + j] !== aliasTokens[j]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          hit = true;
          break;
        }
      }
      if (hit) return mode;
    }
  }
  return null;
}

/**
 * Launch-app alias extraction, shared with the bridge router's pickArgs:
 * the text after "open/launch/start/…" minus the leading article. Null when
 * nothing launch-shaped remains.
 */
export function parseLaunchAlias(text: string): string | null {
  const app = firstCapture(text, LAUNCH_RES);
  if (!app) return null;
  return cleanupCapture(app.replace(/^(?:the|a|an|mera|meri|apna)\s+/, '')) || null;
}

/**
 * Parse one utterance into a MockIntent, or null when nothing matched
 * (the caller replies with a friendly clarification instead).
 * Checks run in priority order: stop → language → identity → opencode →
 * note_notepad → add-todo → youtube_search → agenda_today → reminder → memory
 * → lock → status → url → workspace-mode → web → well-known-site → app_task →
 * launch-app.
 * Specific tools beat the broad alias match (so "remind me to study in 10
 * minutes" stays a reminder even when a mode aliases "study"), and a URL
 * beats a mode whose alias shares the domain ("open movie.com" stays a link).
 * `modes` is the CURRENT settings.workspaceModes (empty → mode matching off).
 */
export function parseIntent(raw: string, modes: WorkspaceMode[] = []): MockIntent | null {
  if (!raw || !raw.trim()) return null;
  const text = normalizeUtterance(raw);

  if (STOP_RE.test(text)) return { kind: 'stop' };

  if (LANG_HI_RE.test(text)) return { kind: 'language_switch', language: 'hi' };
  if (LANG_EN_RE.test(text)) return { kind: 'language_switch', language: 'en' };

  // Identity questions answer conversationally (no tool) — before everything
  // else so the console hint chip never degrades to the clarify fallback.
  if (IDENTITY_RE.test(text)) return { kind: 'identity' };

  const oc = firstCapture(text, OPENCODE_RES);
  if (oc) return { kind: 'opencode_task', prompt: oc };

  // note_notepad BEFORE add-todo: every note shape carries a note/notepad token,
  // so it can never steal a list utterance — but the reverse is not true
  // ("notepad me X add karo" would otherwise hit ADD_RES's "X add karo" tail).
  const note = firstCapture(text, NOTE_ARG_RES);
  if (note) return { kind: 'note_notepad', text: note };

  const add = firstCapture(text, ADD_RES);
  if (add) return { kind: 'add_todo', text: add };

  const yt = firstCapture(text, YOUTUBE_INTENT_RES);
  if (yt) return { kind: 'youtube_search', query: yt };

  if (AGENDA_RES.some((re) => re.test(text))) return { kind: 'agenda_today' };

  const reminder = parseReminder(text);
  if (reminder) {
    return reminder.text
      ? { kind: 'set_reminder', minutes: reminder.minutes, text: reminder.text }
      : { kind: 'set_reminder', minutes: reminder.minutes, text: '' };
  }

  const memory = parseMemory(text);
  if (memory) return memory;

  if (LOCK_RES.some((re) => re.test(text))) return { kind: 'lock_workstation' };

  if (STATUS_WORD_RE.test(text) || STATUS_HOW_RES.some((re) => re.test(text))) {
    return { kind: 'status_briefing' };
  }

  const url = extractUrl(text);
  if (url) return { kind: 'open_url', url };

  if (modes.length > 0) {
    const mode = matchWorkspaceMode(text, modes);
    if (mode) return { kind: 'workspace_mode', mode: mode.name };
  }

  // §2b: web search before open_url ("google X" is not a domain).
  const web = firstCapture(text, WEB_SEARCH_RES);
  if (web) return { kind: 'web_search', query: web };

  // Well-known sites: "open youtube/netflix/github..." opens the SITE, not an
  // app alias (the #1 deterministic miss users hit).
  const site = matchWellKnownSite(text);
  if (site) return { kind: 'open_url', url: site };

  // app_task just BEFORE launch_app: "open notepad and write hello" must TYPE
  // the text, not open Notepad with a mangled "notepad and write hello" alias.
  // It needs BOTH an app token and a >2-char remainder, so a bare "open
  // notepad" falls through to launch_app exactly as before.
  const appTask = parseAppTask(text);
  if (appTask) return appTask;

  const app = parseLaunchAlias(text);
  if (app) return { kind: 'launch_app', alias: app };

  // §2b: close after launch (the mirror verb; "close X" must not be eaten by
  // the open-parse) — and it must not shadow "band karo" stop forms, which the
  // STOP_RE already handled above.
  const closeName = firstCapture(text, CLOSE_APP_RES);
  if (closeName && !/^(?:it|that|this|the app|mitra)$/i.test(closeName)) {
    return { kind: 'close_app', name: closeName };
  }

  return null;
}

/** Map a tool-bound intent onto the bridge's tool name + args. */
export function intentToTool(
  intent: MockIntent,
): { tool: ToolName; args: Record<string, unknown> } | null {
  switch (intent.kind) {
    case 'add_todo':
      return { tool: 'notion_add_todo', args: { text: intent.text } };
    case 'launch_app':
      return { tool: 'launch_app', args: { alias: intent.alias } };
    case 'app_task':
      return { tool: 'app_task', args: { app: intent.app, content: intent.content } };
    case 'identity':
      // Conversational — answered from i18n by the caller (like stop/language).
      return null;
    case 'open_any_app':
      return { tool: 'open_any_app', args: { name: intent.name } };
    case 'close_app':
      return { tool: 'close_app', args: { name: intent.name } };
    case 'web_search':
      return { tool: 'web_search', args: { query: intent.query } };
    case 'opencode_task':
      return { tool: 'run_opencode_task', args: { prompt: intent.prompt } };
    case 'open_url':
      return { tool: 'open_url', args: { url: intent.url } };
    case 'workspace_mode':
      return { tool: 'workspace_mode', args: { name: intent.mode } };
    case 'set_reminder':
      return { tool: 'set_reminder', args: { minutes: intent.minutes, text: intent.text } };
    case 'lock_workstation':
      return { tool: 'lock_workstation', args: {} };
    case 'status_briefing':
      return { tool: 'status_briefing', args: {} };
    case 'memory_remember':
      return { tool: 'memory', args: { action: 'remember', text: intent.text } };
    case 'memory_recall_all':
      // The memory tool requires a query for `recall`; "what do you remember"
      // wants EVERYTHING → the `list` action (server contract, tools/index).
      return { tool: 'memory', args: { action: 'list' } };
    case 'memory_recall':
      return { tool: 'memory', args: { action: 'recall', text: intent.query } };
    case 'note_notepad':
      return { tool: 'note_notepad', args: { text: intent.text } };
    case 'youtube_search':
      return { tool: 'youtube_search', args: { query: intent.query } };
    case 'agenda_today':
      return { tool: 'agenda_today', args: {} };
    default:
      return null;
  }
}

const PERMISSION_GATES = ['notion', 'launcher', 'terminal', 'browser'] as const;

/**
 * A spoken reply for an ok:false ToolResult. Permission denials get an apology
 * + a Settings hint localized per gate ("Permission denied: <gate>" — the exact
 * 403 shape from src/server/acl.ts); every other failure gets apology + summary.
 */
export function failureReply(lang: Lang, summary: string): string {
  if (/permission denied/i.test(summary)) {
    const gate = summary.split(':').pop()?.trim().toLowerCase() ?? '';
    const key = (PERMISSION_GATES as readonly string[]).includes(gate)
      ? `voice.denied.${gate}`
      : 'voice.denied';
    return t(lang, key);
  }
  return `${t(lang, 'voice.apology')} ${summary || t(lang, 'voice.toolError')}`.trim();
}

// ---------------------------------------------------------------------------
// Decision tier (docs/DECISION_TIER_PLAN.md §1): when the deterministic parser
// misses, the Local Bridge's POST /api/brain/route decides (parseIntent again
// server-side, then the optional Laya sidecar). Kept tiny: 1.5s AbortSignal,
// never throws — any failure returns null and the caller falls through to the
// pre-existing path (clarify / chat).
// ---------------------------------------------------------------------------

/** Timeout for POST /api/brain/route ("the fast path stays fast" — plan §1). */
export const ROUTE_TIMEOUT_MS = 1500;

/** Defensive subset of the bridge route response: a tool name + its args. */
export interface RouteDecisionLite {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Ask the bridge which tool should run this utterance, if any. Returns null
 * when the bridge is down, the route endpoint is absent (old bridge), or the
 * response shape deviates (via:'none') — mock-mode rule: degrade, never throw.
 */
export async function fetchRouteDecision(deps: {
  bridgeBase: string;
  fetchImpl: typeof fetch;
  text: string;
  timeoutMs?: number;
}): Promise<RouteDecisionLite | null> {
  const { bridgeBase, fetchImpl, text } = deps;
  if (!text.trim()) return null;
  try {
    const res = await fetchImpl(`${bridgeBase}/api/brain/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? ROUTE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { tool?: unknown; args?: unknown } | null;
    if (!body || typeof body !== 'object' || typeof body['tool'] !== 'string' || !body['tool']) {
      return null; // via:'none' or garbage → fall through
    }
    const rawArgs = body['args'];
    const args =
      rawArgs !== null && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    return { tool: body['tool'], args };
  } catch {
    return null;
  }
}
