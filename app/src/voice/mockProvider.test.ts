// Logic-only unit tests for the mock voice brain (plan Task D "Verify").
// Pure parser + flow tests with stubbed fetch and injected clocks — no DOM,
// no jsdom, no WebGL, no electron. rAF is absent in node, so the synthetic
// amplitude envelope stays flat (asserted below) and no timers hang.
import { describe, expect, it } from 'vitest';
import type { SessionState, TranscriptEntry, WorkspaceMode } from '../shared/types';
import { t } from '../i18n';
import {
  MockProvider,
  bareSearchQuery,
  failureReply,
  intentToTool,
  matchWorkspaceMode,
  parseIntent,
  type MockProviderDeps,
} from './mockProvider';

// ---------------------------------------------------------------------------
// parseIntent — en / hi (Devanagari) / Hinglish
// ---------------------------------------------------------------------------

describe('parseIntent — add_todo', () => {
  it('parses the English "add X to my (todo )?list" family', () => {
    expect(parseIntent('add milk to my list')).toEqual({ kind: 'add_todo', text: 'milk' });
    expect(parseIntent('Add buy groceries to my todo list.')).toEqual({
      kind: 'add_todo',
      text: 'buy groceries',
    });
    expect(parseIntent('add ship the demo to the task list')).toEqual({
      kind: 'add_todo',
      text: 'ship the demo',
    });
    expect(parseIntent('add call mom to list')).toEqual({ kind: 'add_todo', text: 'call mom' });
  });

  it('parses "list me X"', () => {
    expect(parseIntent('list me call the plumber')).toEqual({
      kind: 'add_todo',
      text: 'call the plumber',
    });
  });

  it('parses Hinglish "X add karo" and "meri list me X jodo"', () => {
    expect(parseIntent('milk add karo')).toEqual({ kind: 'add_todo', text: 'milk' });
    expect(parseIntent('meri list me doodh jodo')).toEqual({ kind: 'add_todo', text: 'doodh' });
    expect(parseIntent('list me reply to rahul jodo')).toEqual({
      kind: 'add_todo',
      text: 'reply to rahul',
    });
  });

  it('parses Devanagari Hindi', () => {
    expect(parseIntent('मेरी लिस्ट में दूध जोड़ो')).toEqual({ kind: 'add_todo', text: 'दूध' });
    expect(parseIntent('दूध जोड़ो')).toEqual({ kind: 'add_todo', text: 'दूध' });
  });
});

describe('parseIntent — launch_app', () => {
  it('parses "open X" and strips leading articles', () => {
    expect(parseIntent('open notepad')).toEqual({ kind: 'launch_app', alias: 'notepad' });
    expect(parseIntent('open the calculator')).toEqual({ kind: 'launch_app', alias: 'calculator' });
    expect(parseIntent('launch spotify')).toEqual({ kind: 'open_url', url: 'https://open.spotify.com' });
    expect(parseIntent('open vscode')).toEqual({ kind: 'launch_app', alias: 'vscode' });
  });

  it('parses Hinglish "X kholo" and Devanagari', () => {
    expect(parseIntent('notepad kholo')).toEqual({ kind: 'launch_app', alias: 'notepad' });
    expect(parseIntent('browser khol do')).toEqual({ kind: 'launch_app', alias: 'browser' });
    expect(parseIntent('notepad खोलो')).toEqual({ kind: 'launch_app', alias: 'notepad' });
  });

  it('does not hijack "open opencode and build …" into launch_app', () => {
    const intent = parseIntent('open opencode and build a snake game');
    expect(intent).toEqual({ kind: 'opencode_task', prompt: 'a snake game' });
  });
});

describe('parseIntent — opencode_task', () => {
  it('parses the spec form "open opencode and build/deso/banao …"', () => {
    expect(parseIntent('open opencode and build a snake game')).toEqual({
      kind: 'opencode_task',
      prompt: 'a snake game',
    });
    expect(parseIntent('open opencode and deso a landing page')).toEqual({
      kind: 'opencode_task',
      prompt: 'a landing page',
    });
    expect(parseIntent('open opencode aur banao todo app')).toEqual({
      kind: 'opencode_task',
      prompt: 'todo app',
    });
  });

  it('parses Hinglish variants', () => {
    expect(parseIntent('opencode me todo app banao')).toEqual({
      kind: 'opencode_task',
      prompt: 'todo app',
    });
    expect(parseIntent('opencode build a cli tool')).toEqual({
      kind: 'opencode_task',
      prompt: 'a cli tool',
    });
  });
});

describe('parseIntent — open_url', () => {
  it('detects absolute and bare URLs, including after "open"', () => {
    expect(parseIntent('open github.com')).toEqual({ kind: 'open_url', url: 'https://github.com' });
    expect(parseIntent('https://docs.bolna.ai/docs?x=1')).toEqual({
      kind: 'open_url',
      url: 'https://docs.bolna.ai/docs?x=1',
    });
    expect(parseIntent('www.example.com/path')).toEqual({
      kind: 'open_url',
      url: 'https://www.example.com/path',
    });
    expect(parseIntent('youtube.com kholo')).toEqual({ kind: 'open_url', url: 'https://youtube.com' });
  });
});

describe('parseIntent — stop + language_switch', () => {
  it('parses stop in en/hi/hinglish as full-utterance only', () => {
    expect(parseIntent('stop')).toEqual({ kind: 'stop' });
    expect(parseIntent('ruko!')).toEqual({ kind: 'stop' });
    expect(parseIntent('band karo')).toEqual({ kind: 'stop' });
    expect(parseIntent('बंद करो')).toEqual({ kind: 'stop' });
    // Not a stop: longer sentence containing "stop".
    expect(parseIntent('stop the music')).not.toEqual({ kind: 'stop' });
  });

  it('parses language switches both ways', () => {
    expect(parseIntent('speak hindi')).toEqual({ kind: 'language_switch', language: 'hi' });
    expect(parseIntent('ab hindi me bolo')).toEqual({ kind: 'language_switch', language: 'hi' });
    expect(parseIntent('hindi me bolo')).toEqual({ kind: 'language_switch', language: 'hi' });
    expect(parseIntent('हिंदी में बोलो')).toEqual({ kind: 'language_switch', language: 'hi' });
    expect(parseIntent('speak english')).toEqual({ kind: 'language_switch', language: 'en' });
    expect(parseIntent('ab english me bolo')).toEqual({ kind: 'language_switch', language: 'en' });
  });
});

describe('parseIntent — unknown input', () => {
  it('returns null so the caller replies with a clarification', () => {
    expect(parseIntent("what's the weather today")).toBeNull();
    expect(parseIntent('tell me a joke yaar')).toBeNull();
    expect(parseIntent('')).toBeNull();
    expect(parseIntent('   ')).toBeNull();
    expect(parseIntent('open')).toBeNull(); // launch requires a target
  });
});

// ---------------------------------------------------------------------------
// parseIntent — real-world tools (docs/DECISION_TIER_PLAN.md §2)
// ---------------------------------------------------------------------------

describe('parseIntent — note_notepad', () => {
  it('en table: "note this: X", "note that X", "add X to my notepad", "X in notepad", bare "note X"', () => {
    expect(parseIntent('note this: buy milk')).toEqual({ kind: 'note_notepad', text: 'buy milk' });
    expect(parseIntent('note that the wifi password is 1234')).toEqual({
      kind: 'note_notepad',
      text: 'the wifi password is 1234',
    });
    expect(parseIntent('add buy milk to my notepad')).toEqual({ kind: 'note_notepad', text: 'buy milk' });
    expect(parseIntent('buy milk in notepad')).toEqual({ kind: 'note_notepad', text: 'buy milk' });
    expect(parseIntent('note buy milk')).toEqual({ kind: 'note_notepad', text: 'buy milk' });
  });

  it('hinglish table: "notepad me X add karo" / "X notepad me likho" / "notepad X likho"', () => {
    expect(parseIntent('notepad me call mom add karo')).toEqual({ kind: 'note_notepad', text: 'call mom' });
    expect(parseIntent('call mom notepad me likho')).toEqual({ kind: 'note_notepad', text: 'call mom' });
    expect(parseIntent('notepad call mom likho')).toEqual({ kind: 'note_notepad', text: 'call mom' });
  });

  it('Devanagari table: "नोट करो X" / "X नोट करो" / "नोटपैड में X लिखो"', () => {
    expect(parseIntent('नोट करो दूध लेना है')).toEqual({ kind: 'note_notepad', text: 'दूध लेना है' });
    expect(parseIntent('दूध लेना है नोट करो')).toEqual({ kind: 'note_notepad', text: 'दूध लेना है' });
    expect(parseIntent('नोटपैड में दूध लिखो')).toEqual({ kind: 'note_notepad', text: 'दूध' });
  });

  it('add-todo to a LIST still wins its own shape (no cross-steal)', () => {
    expect(parseIntent('add milk to my list')).toEqual({ kind: 'add_todo', text: 'milk' });
    expect(parseIntent('milk add karo')).toEqual({ kind: 'add_todo', text: 'milk' });
  });
});

describe('parseIntent — web_search (spoken forms)', () => {
  it('look up X / search up X route to web_search', () => {
    expect(parseIntent('look up quantum computing')).toEqual({
      kind: 'web_search',
      query: 'quantum computing',
    });
    expect(parseIntent('looking up mitra assistant')).toEqual({
      kind: 'web_search',
      query: 'mitra assistant',
    });
    expect(parseIntent('search up best laptops 2026')).toEqual({
      kind: 'web_search',
      query: 'best laptops 2026',
    });
    expect(parseIntent('google weather today')).toEqual({
      kind: 'web_search',
      query: 'weather today',
    });
  });
});

describe('bareSearchQuery — route-tier fallback when the Laya sidecar is down', () => {
  it('extracts the query from bare search shapes', () => {
    expect(bareSearchQuery('search lofi beats')).toBe('lofi beats');
    expect(bareSearchQuery('search for cat videos')).toBe('cat videos');
    expect(bareSearchQuery('look up rust vs go')).toBe('rust vs go');
    expect(bareSearchQuery('please find cheap flights')).toBe('cheap flights');
    expect(bareSearchQuery('search')).toBeNull();
    // not a bare search: youtube is named → deterministic youtube_search wins
    expect(bareSearchQuery('search cat videos on youtube')).toBeNull();
  });
});

describe('parseIntent — youtube_search', () => {
  it('SPOKEN forms: "youtube search X" (STT rarely emits par/pe) + Devanagari', () => {
    expect(parseIntent('youtube search lofi beats')).toEqual({
      kind: 'youtube_search',
      query: 'lofi beats',
    });
    expect(parseIntent('youtube find cat videos')).toEqual({
      kind: 'youtube_search',
      query: 'cat videos',
    });
    expect(parseIntent('यूट्यूब सर्च lofi beats')).toEqual({
      kind: 'youtube_search',
      query: 'lofi beats',
    });
  });

  it('en table: "open youtube and search X" / "search X on youtube" / "play X on youtube"', () => {
    expect(parseIntent('open youtube and search lofi beats')).toEqual({
      kind: 'youtube_search',
      query: 'lofi beats',
    });
    expect(parseIntent('open youtube and play despacito')).toEqual({
      kind: 'youtube_search',
      query: 'despacito',
    });
    expect(parseIntent('search cat videos on youtube')).toEqual({
      kind: 'youtube_search',
      query: 'cat videos',
    });
    expect(parseIntent('find quantum computing on youtube.')).toEqual({
      kind: 'youtube_search',
      query: 'quantum computing',
    });
    expect(parseIntent('play despacito on youtube')).toEqual({
      kind: 'youtube_search',
      query: 'despacito',
    });
  });

  it('hinglish + Devanagari table: "youtube par X search karo" / "youtube pe X chalao" / "X youtube par search karo"', () => {
    expect(parseIntent('youtube par cricket highlights search karo')).toEqual({
      kind: 'youtube_search',
      query: 'cricket highlights',
    });
    expect(parseIntent('youtube pe old songs chalao')).toEqual({
      kind: 'youtube_search',
      query: 'old songs',
    });
    expect(parseIntent('cricket highlights youtube par search karo')).toEqual({
      kind: 'youtube_search',
      query: 'cricket highlights',
    });
    expect(parseIntent('यूट्यूब पर ड्रम कवर चलाओ')).toEqual({
      kind: 'youtube_search',
      query: 'ड्रम कवर',
    });
  });

  it('bare "search X" and bare "open youtube" stay OUT of the deterministic tier', () => {
    // Bare search → null here; the bridge route tier (Laya) may name
    // youtube_search, and pickArgs' bare-search shape extracts the query.
    expect(parseIntent('search quantum computing')).toBeNull();
    // Well-known sites now open as SITES (user direction): youtube is open_url.
    expect(parseIntent('open youtube')).toEqual({ kind: 'open_url', url: 'https://www.youtube.com' });
  });
});

describe('parseIntent — agenda_today', () => {
  it('en table: "what(s) due today" / "what do I have to do today" / "anything on my calendar today"', () => {
    expect(parseIntent("what's due today")).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('whats due today?')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('what is due today')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('what do I have to do today')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('anything on my calendar today')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('is there anything due today')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent("what's on my calendar today")).toEqual({ kind: 'agenda_today' });
  });

  it('hinglish + Devanagari table: "aaj kya karna hai" / "aaj ka schedule batao" / "आज क्या करना है"', () => {
    expect(parseIntent('aaj kya karna hai')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('aaj ka schedule batao')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('mera aaj ka schedule')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('आज मुझे क्या करना है')).toEqual({ kind: 'agenda_today' });
    expect(parseIntent('आज का स्केड्यूल बताओ')).toEqual({ kind: 'agenda_today' });
  });

  it('near-miss questions stay non-agenda (memory keeps its own shapes)', () => {
    expect(parseIntent("what's the weather today")).toBeNull();
    expect(parseIntent('what do you remember')).toEqual({ kind: 'memory_recall_all' });
  });
});

// ---------------------------------------------------------------------------
// parseIntent — Ultron-port intents (rows 1,2,4,5,6): workspace_mode,
// set_reminder, lock_workstation, status_briefing, memory
// ---------------------------------------------------------------------------

/** Stand-in for Settings.workspaceModes (same shape as DEFAULT_SETTINGS). */
const MODE_FIXTURE: WorkspaceMode[] = [
  {
    id: 'coding',
    name: 'Coding',
    aliases: ['coding', 'coding mode', 'dev mode', 'कोडिंग', "let's code"],
    apps: ['terminal'],
    urls: ['https://github.com'],
  },
  {
    id: 'study',
    name: 'Study',
    aliases: ['study', 'study mode', 'पढ़ाई'],
    apps: ['notepad'],
    urls: [],
  },
  {
    id: 'chill',
    name: 'Chill',
    aliases: ['chill', 'movie time', 'movie', 'मूवी'],
    apps: [],
    urls: ['https://www.youtube.com'],
  },
];

describe('parseIntent — workspace_mode (alias match against current settings)', () => {
  it('matches English, Hinglish and Devanagari aliases and resolves the mode name', () => {
    expect(parseIntent('coding mode chalu karo', MODE_FIXTURE)).toEqual({
      kind: 'workspace_mode',
      mode: 'Coding',
    });
    expect(parseIntent('कोडिंग', MODE_FIXTURE)).toEqual({ kind: 'workspace_mode', mode: 'Coding' });
    expect(parseIntent('padhai karni hai', [
      { id: 'study', name: 'Study', aliases: ['padhai karni hai', 'पढ़ाई'], apps: [], urls: [] },
    ])).toEqual({ kind: 'workspace_mode', mode: 'Study' });
    expect(parseIntent('movie time', MODE_FIXTURE)).toEqual({
      kind: 'workspace_mode',
      mode: 'Chill',
    });
  });

  it("normalizes apostrophes so \u2018let's code\u2019 and \u2018lets code\u2019 both hit", () => {
    expect(parseIntent("let's code", MODE_FIXTURE)).toEqual({ kind: 'workspace_mode', mode: 'Coding' });
    expect(parseIntent('lets code', MODE_FIXTURE)).toEqual({ kind: 'workspace_mode', mode: 'Coding' });
  });

  it('matches aliases as whole words only, in order (no substring/reorder hits)', () => {
    const gameMode: WorkspaceMode[] = [
      { id: 'game', name: 'Game', aliases: ['game'], apps: [], urls: [] },
    ];
    // "gaming" is a different word than the alias "game" → launch_app, not the mode
    expect(parseIntent('gaming kholo', gameMode)).toEqual({ kind: 'launch_app', alias: 'gaming' });
    // a multi-word alias must appear in order ("deep work", not "work deep")
    const deepWork: WorkspaceMode[] = [
      { id: 'deep', name: 'Deep Work', aliases: ['deep work'], apps: [], urls: [] },
    ];
    expect(parseIntent('deep work now', deepWork)).toEqual({
      kind: 'workspace_mode',
      mode: 'Deep Work',
    });
    expect(parseIntent('work deep now', deepWork)).toBeNull();
  });

  it('is off without modes and stays specific-tool-first otherwise', () => {
    expect(parseIntent('coding mode chalu karo', [])).toBeNull();
    // a reminder beats the alias ("study" inside the reminder text)
    expect(parseIntent('remind me in 10 minutes to study', MODE_FIXTURE)).toEqual({
      kind: 'set_reminder',
      minutes: 10,
      text: 'study',
    });
    // a URL beats a mode whose alias shares the token
    expect(parseIntent('open movie.com', MODE_FIXTURE)).toEqual({
      kind: 'open_url',
      url: 'https://movie.com',
    });
    // add-todo beats the alias
    expect(parseIntent('add coding to my list', MODE_FIXTURE)).toEqual({
      kind: 'add_todo',
      text: 'coding',
    });
  });
});

describe('matchWorkspaceMode — direct', () => {
  it('returns the first settings mode whose alias appears as whole words', () => {
    expect(matchWorkspaceMode('dev mode on karo', MODE_FIXTURE)?.id).toBe('coding');
    expect(matchWorkspaceMode('चलो मूवी देखें', MODE_FIXTURE)?.id).toBe('chill');
    expect(matchWorkspaceMode('nothing matches here', MODE_FIXTURE)).toBeNull();
  });

  it('prefers the earlier mode when two modes share an alias (settings order wins)', () => {
    const both: WorkspaceMode[] = [
      { id: 'a', name: 'A', aliases: ['focus'], apps: [], urls: [] },
      { id: 'b', name: 'B', aliases: ['focus'], apps: [], urls: [] },
    ];
    expect(matchWorkspaceMode('focus mode', both)?.id).toBe('a');
  });
});

describe('parseIntent — set_reminder (duration parsing)', () => {
  it('parses the English "remind me in/after N minutes" family', () => {
    expect(parseIntent('remind me in 10 minutes to drink water')).toEqual({
      kind: 'set_reminder',
      minutes: 10,
      text: 'drink water',
    });
    expect(parseIntent('Remind me in 10 minutes.')).toEqual({
      kind: 'set_reminder',
      minutes: 10,
      text: '',
    });
    expect(parseIntent('remind me after 2 minutes')).toEqual({
      kind: 'set_reminder',
      minutes: 2,
      text: '',
    });
    expect(parseIntent('remind me in 2m')).toEqual({ kind: 'set_reminder', minutes: 2, text: '' });
    expect(parseIntent('remind me in 1 minute to stretch')).toEqual({
      kind: 'set_reminder',
      minutes: 1,
      text: 'stretch',
    });
  });

  it('parses "N minute ka timer" with an optional message', () => {
    expect(parseIntent('5 minute ka timer')).toEqual({ kind: 'set_reminder', minutes: 5, text: '' });
    expect(parseIntent('10 minute ka timer for chai')).toEqual({
      kind: 'set_reminder',
      minutes: 10,
      text: 'chai',
    });
  });

  it('parses Devanagari digits and मिनट', () => {
    expect(parseIntent('४ मिनट का टाइमर')).toEqual({ kind: 'set_reminder', minutes: 4, text: '' });
    expect(parseIntent('५ मिनट का टाइमर कि दूध उबालना')).toEqual({
      kind: 'set_reminder',
      minutes: 5,
      text: 'दूध उबालना',
    });
    expect(parseIntent('10 मिनट बाद पानी पीना याद दिलाओ')).toEqual({
      kind: 'set_reminder',
      minutes: 10,
      text: 'पानी पीना',
    });
    expect(parseIntent('2 मिनट बाद')).toEqual({ kind: 'set_reminder', minutes: 2, text: '' });
  });

  it('rejects nonsense durations instead of scheduling them', () => {
    expect(parseIntent('remind me in 0 minutes')).toBeNull();
    expect(parseIntent('remind me in 5000 minutes')).toBeNull();
    expect(parseIntent('remind me')).toBeNull();
  });
});

describe('parseIntent — lock_workstation', () => {
  it('parses en/hinglish lock phrases', () => {
    expect(parseIntent('lock my computer')).toEqual({ kind: 'lock_workstation' });
    expect(parseIntent('Lock My Screen')).toEqual({ kind: 'lock_workstation' });
    expect(parseIntent('lock the pc')).toEqual({ kind: 'lock_workstation' });
    expect(parseIntent('screen lock karo')).toEqual({ kind: 'lock_workstation' });
    expect(parseIntent('computer lock')).toEqual({ kind: 'lock_workstation' });
    expect(parseIntent('lockdown')).toEqual({ kind: 'lock_workstation' });
    expect(parseIntent('lock')).toEqual({ kind: 'lock_workstation' });
  });

  it('parses Devanagari lock phrases', () => {
    expect(parseIntent('स्क्रीन लॉक करो')).toEqual({ kind: 'lock_workstation' });
    expect(parseIntent('कंप्यूटर लॉक')).toEqual({ kind: 'lock_workstation' });
  });

  it('does not fire on lookalikes', () => {
    expect(parseIntent('unlock my computer')).toBeNull();
    expect(parseIntent('block my screen')).toBeNull();
  });
});

describe('parseIntent — status_briefing', () => {
  it('parses status asks in en/hinglish', () => {
    expect(parseIntent('status')).toEqual({ kind: 'status_briefing' });
    expect(parseIntent('Status batao')).toEqual({ kind: 'status_briefing' });
    expect(parseIntent('battery status')).toEqual({ kind: 'status_briefing' });
    expect(parseIntent('status?')).toEqual({ kind: 'status_briefing' });
  });

  it('parses how-are-you greetings in en/hinglish/devanagari', () => {
    expect(parseIntent('how are you doing')).toEqual({ kind: 'status_briefing' });
    expect(parseIntent('how are you')).toEqual({ kind: 'status_briefing' });
    expect(parseIntent('kaise ho')).toEqual({ kind: 'status_briefing' });
    expect(parseIntent('kaise ho bhai')).toEqual({ kind: 'status_briefing' });
    expect(parseIntent('कैसे हो')).toEqual({ kind: 'status_briefing' });
    expect(parseIntent('sab kaisa hai')).toEqual({ kind: 'status_briefing' });
  });

  it('does not fire on unrelated phrasing', () => {
    expect(parseIntent('ye kaise ho gaya')).toBeNull();
    // specific tools beat the status word
    expect(parseIntent('add status to my list')).toEqual({ kind: 'add_todo', text: 'status' });
    expect(parseIntent('remind me in 5 minutes for the status call')).toEqual({
      kind: 'set_reminder',
      minutes: 5,
      text: 'the status call',
    });
  });
});

describe('parseIntent — memory (remember / recall)', () => {
  it('parses "remember that …" and Hinglish/Devanagari store phrasing', () => {
    expect(parseIntent('remember that I love chai')).toEqual({
      kind: 'memory_remember',
      text: 'i love chai', // captures are lowercased like every other intent
    });
    expect(parseIntent('remember buy milk tomorrow')).toEqual({
      kind: 'memory_remember',
      text: 'buy milk tomorrow',
    });
    expect(parseIntent('yaad rakho ki mujhe doodh lena hai')).toEqual({
      kind: 'memory_remember',
      text: 'mujhe doodh lena hai',
    });
    expect(parseIntent('याद रखो कि दवा लेनी है')).toEqual({
      kind: 'memory_remember',
      text: 'दवा लेनी है',
    });
  });

  it('parses recall-all as an exact utterance', () => {
    expect(parseIntent('what do you remember')).toEqual({ kind: 'memory_recall_all' });
    expect(parseIntent('what all do you remember?')).toEqual({ kind: 'memory_recall_all' });
    expect(parseIntent('kya yaad hai')).toEqual({ kind: 'memory_recall_all' });
    expect(parseIntent('क्या याद है')).toEqual({ kind: 'memory_recall_all' });
  });

  it('parses recall-with-query in en/hinglish/devanagari', () => {
    expect(parseIntent('what do you remember about rahul')).toEqual({
      kind: 'memory_recall',
      query: 'rahul',
    });
    expect(parseIntent('kya yaad hai chai ke baare me')).toEqual({
      kind: 'memory_recall',
      query: 'chai',
    });
    expect(parseIntent('chai ke baare me kya yaad hai')).toEqual({
      kind: 'memory_recall',
      query: 'chai',
    });
    expect(parseIntent('kya yaad hai chai')).toEqual({ kind: 'memory_recall', query: 'chai' });
    expect(parseIntent('चाय के बारे में क्या याद है')).toEqual({
      kind: 'memory_recall',
      query: 'चाय',
    });
  });

  it('needs content after the verb', () => {
    expect(parseIntent('remember')).toBeNull();
    expect(parseIntent('yaad rakho ki')).toBeNull();
  });
});

describe('intentToTool — Ultron-port mappings', () => {
  it('maps every new intent onto its bridge tool with the ledger args', () => {
    expect(intentToTool({ kind: 'workspace_mode', mode: 'Coding' })).toEqual({
      tool: 'workspace_mode',
      args: { name: 'Coding' },
    });
    expect(intentToTool({ kind: 'set_reminder', minutes: 10, text: 'drink water' })).toEqual({
      tool: 'set_reminder',
      args: { minutes: 10, text: 'drink water' },
    });
    expect(intentToTool({ kind: 'lock_workstation' })).toEqual({
      tool: 'lock_workstation',
      args: {},
    });
    expect(intentToTool({ kind: 'status_briefing' })).toEqual({ tool: 'status_briefing', args: {} });
    expect(intentToTool({ kind: 'memory_remember', text: 'I love chai' })).toEqual({
      tool: 'memory',
      args: { action: 'remember', text: 'I love chai' },
    });
    expect(intentToTool({ kind: 'memory_recall_all' })).toEqual({
      tool: 'memory',
      args: { action: 'list' },
    });
    expect(intentToTool({ kind: 'memory_recall', query: 'chai' })).toEqual({
      tool: 'memory',
      args: { action: 'recall', text: 'chai' },
    });
    expect(intentToTool({ kind: 'note_notepad', text: 'buy milk' })).toEqual({
      tool: 'note_notepad',
      args: { text: 'buy milk' },
    });
    expect(intentToTool({ kind: 'youtube_search', query: 'lofi beats' })).toEqual({
      tool: 'youtube_search',
      args: { query: 'lofi beats' },
    });
    expect(intentToTool({ kind: 'agenda_today' })).toEqual({ tool: 'agenda_today', args: {} });
  });
});

// ---------------------------------------------------------------------------
// failureReply — permission-denial shape (mirrors the bridge 403 body)
// ---------------------------------------------------------------------------

describe('failureReply', () => {
  it('maps each gate to a localized apology + Settings hint', () => {
    for (const gate of ['notion', 'launcher', 'terminal', 'browser'] as const) {
      expect(failureReply('en', `Permission denied: ${gate}`)).toBe(t('en', `voice.denied.${gate}`));
      expect(failureReply('hi', `Permission denied: ${gate}`)).toBe(t('hi', `voice.denied.${gate}`));
    }
  });

  it('falls back to the generic denial for an unknown gate, and apology+summary otherwise', () => {
    expect(failureReply('en', 'Permission denied: whatever')).toBe(t('en', 'voice.denied'));
    expect(failureReply('en', 'Unknown tool: x')).toBe(
      `${t('en', 'voice.apology')} Unknown tool: x`,
    );
  });
});

// ---------------------------------------------------------------------------
// MockProvider flow — stubbed fetch (permission denial + happy path)
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init?: { method?: string; body?: string } };

function makeProvider(
  fetchImpl: (url: string, init?: { method?: string; body?: string }) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>,
  overrides: Partial<MockProviderDeps> = {},
): { provider: MockProvider; calls: FetchCall[]; states: SessionState[]; transcripts: TranscriptEntry[] } {
  const calls: FetchCall[] = [];
  const wrapped = Object.assign(
    (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    }) as unknown as typeof fetch,
    { calls },
  );
  const provider = new MockProvider({
    bridgeBase: 'http://127.0.0.1:8765',
    fetchImpl: wrapped,
    delay: async () => undefined, // no sleeps in tests
    random: () => 0.5,
    idFactory: () => 'test-id',
    ...overrides,
  });
  const states: SessionState[] = [];
  const transcripts: TranscriptEntry[] = [];
  provider.onState((s) => states.push(s));
  provider.onTranscript((entry) => transcripts.push(entry));
  return { provider, calls, states, transcripts };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('MockProvider flow', () => {
  it('start() → listening + greeting; no network', async () => {
    const { provider, calls, states, transcripts } = makeProvider(async () => {
      throw new Error('network must not be used');
    });
    await provider.start({ language: 'en' });
    expect(states).toEqual(['listening']);
    expect(transcripts[0]?.role).toBe('agent');
    expect(transcripts[0]?.text).toBe(t('en', 'voice.greeting'));
    expect(calls).toHaveLength(0);
  });

  it('add-todo → POSTs the ToolRequest to the bridge and speaks the returned summary', async () => {
    const { provider, calls, states, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: true, summary: 'Added to Notion (mock board): "milk"' }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('add milk to my list');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/tools/notion_add_todo');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'notion_add_todo',
      args: { text: 'milk' },
    });

    expect(states).toEqual(['listening', 'thinking', 'speaking', 'listening']);
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe('Added to Notion (mock board): "milk"');
    // Envelope ends at 0 after speaking (rAF absent in node → flat all along).
    expect(provider.syntheticAmplitude.current).toBe(0);
  });

  it('permission denial (HTTP 403 carrying a ToolResult body) → apology + Settings hint, tool still "spoke" gracefully', async () => {
    const { provider, calls, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: false, summary: 'Permission denied: notion' }, 403),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('add milk to my list');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/tools/notion_add_todo');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.denied.notion'));
  });

  it('other ok:false results → apology + the bridge summary', async () => {
    const { provider, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'x', ok: false, summary: 'Unknown alias "skype". Available: notepad, terminal' }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('open skype');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(
      `${t('en', 'voice.apology')} Unknown alias "skype". Available: notepad, terminal`,
    );
  });

  it('bridge unreachable (fetch throws) → localized apology, never throws', async () => {
    const { provider, transcripts } = makeProvider(async () => {
      throw new Error('ECONNREFUSED');
    });
    await provider.start({ language: 'hi' });
    await provider.submitText('मेरी लिस्ट में दूध जोड़ो');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('hi', 'voice.bridgeUnreachable'));
  });

  it('unknown input → the route tier is tried, then clarification (never throws)', async () => {
    const { provider, calls, transcripts } = makeProvider(async () => {
      throw new Error('must not be called');
    });
    await provider.start({ language: 'en' });
    await provider.submitText("what's the weather today");
    // The decision tier (docs/DECISION_TIER_PLAN.md §1) POSTs /api/brain/route
    // once; the bridge being down degrades to the pre-existing clarify.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/brain/route');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.clarify'));
  });

  it('stop → speaks the goodbye and ends the session in idle', async () => {
    const { provider, states, transcripts } = makeProvider(async () => {
      throw new Error('must not be called');
    });
    await provider.start({ language: 'en' });
    await provider.submitText('ruko');
    expect(states[states.length - 1]).toBe('idle');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.stopReply'));
  });

  it('language switch → confirmation in the NEW language, later replies follow it', async () => {
    const { provider, transcripts } = makeProvider(async () => {
      throw new Error('must not be called');
    });
    await provider.start({ language: 'en' });
    await provider.submitText('ab hindi me bolo');
    let agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('hi', 'voice.langSwitched.hi'));

    await provider.submitText('blah blah blah');
    agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('hi', 'voice.clarify'));
  });

  it('stop() → idle from any active state (mid-session abort, Review Focus #4)', async () => {
    const { provider, states } = makeProvider(async () => jsonResponse({ id: 'x', ok: true, summary: 'ok' }));
    await provider.start({ language: 'en' });
    const pending = provider.submitText('add milk to my list'); // in flight
    await provider.stop();
    expect(states[states.length - 1]).toBe('idle');
    await pending;
  });
});

// ---------------------------------------------------------------------------
// MockProvider flow — Ultron-port tools (same bridge path as every other intent)
// ---------------------------------------------------------------------------

describe('MockProvider flow — Ultron-port tools', () => {
  it('workspace_mode → POSTs the CURRENT mode name and speaks the tool summary', async () => {
    const { provider, calls, transcripts } = makeProvider(
      async () => jsonResponse({ id: 'test-id', ok: true, summary: 'Coding mode launched: terminal, github.com' }),
      { getWorkspaceModes: () => MODE_FIXTURE },
    );
    await provider.start({ language: 'en' });
    await provider.submitText('coding mode chalu karo');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/tools/workspace_mode');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'workspace_mode',
      args: { name: 'Coding' },
    });
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe('Coding mode launched: terminal, github.com');
  });

  it('workspace_mode follows live panel edits (no provider rebuild needed)', async () => {
    let modes: WorkspaceMode[] = [];
    const { provider, calls } = makeProvider(
      async () => jsonResponse({ id: 'x', ok: true, summary: 'launched' }),
      { getWorkspaceModes: () => modes },
    );
    await provider.start({ language: 'en' });

    await provider.submitText('movie time'); // no modes configured yet
    // No deterministic hit → the decision tier (POST /api/brain/route) is
    // attempted once; this fake's body carries no tool, so no tool POST.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/brain/route');

    modes = MODE_FIXTURE; // the Modes panel just saved
    await provider.submitText('movie time');
    expect(calls).toHaveLength(2); // deterministic hit → straight to the tool, no route call
    expect(calls[1]?.url).toBe('http://127.0.0.1:8765/api/tools/workspace_mode');
  });

  it('memory remember/recall → POSTs the memory tool with row-5 action args', async () => {
    const { provider, calls } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: true, summary: 'Stored.' }),
    );
    await provider.start({ language: 'en' });

    await provider.submitText('remember that I love chai');
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/tools/memory');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'memory',
      args: { action: 'remember', text: 'i love chai' },
    });

    await provider.submitText('what do you remember about chai');
    expect(JSON.parse(calls[1]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'memory',
      args: { action: 'recall', text: 'chai' },
    });

    await provider.submitText('kya yaad hai');
    expect(JSON.parse(calls[2]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'memory',
      args: { action: 'list' },
    });
  });

  it('reminder, lock and status hit their bridge tools with the ledger args', async () => {
    const { provider, calls } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: true, summary: 'done' }),
    );
    await provider.start({ language: 'en' });

    await provider.submitText('remind me in 10 minutes to drink water');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'set_reminder',
      args: { minutes: 10, text: 'drink water' },
    });

    await provider.submitText('5 minute ka timer');
    expect(JSON.parse(calls[1]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'set_reminder',
      args: { minutes: 5, text: '' },
    });

    await provider.submitText('lock my computer');
    expect(JSON.parse(calls[2]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'lock_workstation',
      args: {},
    });

    await provider.submitText('battery status');
    expect(JSON.parse(calls[3]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'status_briefing',
      args: {},
    });
  });

  it('unknown tool (server half not landed yet) → apology + summary, never throws', async () => {
    const { provider, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'x', ok: false, summary: 'Unknown tool: lock_workstation' }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('lock my computer');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(
      `${t('en', 'voice.apology')} Unknown tool: lock_workstation`,
    );
  });

  it('workspace_mode permission denial → localized launcher-gate apology', async () => {
    const { provider, transcripts } = makeProvider(
      async () => jsonResponse({ id: 'x', ok: false, summary: 'Permission denied: launcher' }, 403),
      { getWorkspaceModes: () => MODE_FIXTURE },
    );
    await provider.start({ language: 'en' });
    await provider.submitText('coding mode chalu karo');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.denied.launcher'));
  });
});

// ---------------------------------------------------------------------------
// MockProvider flow — real-world tools (docs/DECISION_TIER_PLAN.md §2):
// deterministic intents hit their bridge tools with extracted args.
// ---------------------------------------------------------------------------

describe('MockProvider flow — real-world tools', () => {
  it('note_notepad intent → POSTs {text} and speaks the tool summary', async () => {
    const { provider, calls, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: true, summary: 'Note saved to mitra-notes.txt and opened in Notepad' }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('note this: buy milk');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/tools/note_notepad');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'note_notepad',
      args: { text: 'buy milk' },
    });
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe('Note saved to mitra-notes.txt and opened in Notepad');
  });

  it('youtube_search intent → POSTs the URL-encoded-later query', async () => {
    const { provider, calls } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: true, summary: 'Searching YouTube for "lofi beats"' }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('play lofi beats on youtube');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'youtube_search',
      args: { query: 'lofi beats' },
    });
  });

  it('agenda_today intent → POSTs empty args and speaks the board summary', async () => {
    const { provider, calls, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: true, summary: 'You have 2 items on your board: "buy milk", "call the dentist"' }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('aaj kya karna hai');
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/tools/agenda_today');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'agenda_today',
      args: {},
    });
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe('You have 2 items on your board: "buy milk", "call the dentist"');
  });
});

// ---------------------------------------------------------------------------
// MockProvider flow — decision tier (docs/DECISION_TIER_PLAN.md §1): when the
// deterministic parser misses, the provider asks POST /api/brain/route once
// (1.5s cap) and runs a returned tool; any failure degrades to clarify.
// ---------------------------------------------------------------------------

/** fetchImpl that answers by URL suffix (route vs tools) and records calls. */
function routedFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (url: unknown, init?: { method?: string; body?: string }) => {
    const target = String(url);
    for (const [suffix, body] of Object.entries(routes)) {
      if (target.endsWith(suffix)) return jsonResponse(body);
    }
    throw new Error(`unexpected fetch: ${target}`);
  }) as unknown as typeof fetch;
}

describe('MockProvider flow — decision tier (bridge route)', () => {
  it('no intent + bridge routes to a tool → runs it and speaks the summary', async () => {
    const { provider, calls, transcripts } = makeProvider(
      routedFetch({
        '/api/brain/route': { tool: 'youtube_search', args: { query: 'lofi beats' }, confidence: 0.9, via: 'laya' },
        '/api/tools/youtube_search': { id: 'x', ok: true, summary: 'Searching YouTube for "lofi beats"' },
      }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('search lofi beats');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/brain/route');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({ text: 'search lofi beats' });
    expect(calls[1]?.url).toBe('http://127.0.0.1:8765/api/tools/youtube_search');
    expect(JSON.parse(calls[1]?.init?.body ?? '{}')).toMatchObject({
      tool: 'youtube_search',
      args: { query: 'lofi beats' },
    });
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe('Searching YouTube for "lofi beats"');
  });

  it('no intent + route says via:"none" → clarification (chat owns the rest server-side)', async () => {
    const { provider, calls, transcripts } = makeProvider(
      routedFetch({ '/api/brain/route': { confidence: 0, via: 'none' } }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('tell me a joke yaar');
    expect(calls).toHaveLength(1); // the route call only — no tool POST
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.clarify'));
  });

  it('routed tool denial (403 carrying a ToolResult) → localized apology', async () => {
    const { provider, transcripts } = makeProvider(
      routedFetch({
        '/api/brain/route': { tool: 'note_notepad', args: { text: 'x' }, confidence: 0.9, via: 'laya' },
        '/api/tools/note_notepad': { id: 'x', ok: false, summary: 'Permission denied: launcher' },
      }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('jot down something random');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.denied.launcher'));
  });
});
