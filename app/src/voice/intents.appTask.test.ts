// app_task + identity intent tests (intents.ts): the composite "open an app AND
// write content into it" must parse to app_task (opencode composites keep
// routing to opencode_task), while bare notes, to-dos and plain launches keep
// their existing intents. Identity questions parse en + Hinglish + Devanagari
// and never map to a tool.
import { describe, expect, it } from 'vitest';
import { parseAppTask, parseIntent, intentToTool } from './intents';

describe('parseIntent — app_task (open an app AND write content into it)', () => {
  it('en composite table: "open X and write Y" / "launch X then type Y" / "open X, write Y"', () => {
    expect(parseIntent('open notepad and write hello world')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'hello world',
    });
    expect(parseIntent('launch calc then type 2+2')).toEqual({
      kind: 'app_task',
      app: 'calc',
      content: '2+2',
    });
    expect(parseIntent('open mspaint, write a smiley face')).toEqual({
      kind: 'app_task',
      app: 'mspaint',
      content: 'a smiley face',
    });
  });

  it('content-first table: "write Y into X" (non-notepad apps)', () => {
    expect(parseIntent('write hello world in mspaint')).toEqual({
      kind: 'app_task',
      app: 'mspaint',
      content: 'hello world',
    });
    expect(parseIntent('type 420 into calc')).toEqual({ kind: 'app_task', app: 'calc', content: '420' });
  });

  it('Hinglish tables: "X me Y likho" and "X kholo aur Y likho"', () => {
    expect(parseIntent('msword me meeting notes likho')).toEqual({
      kind: 'app_task',
      app: 'msword',
      content: 'meeting notes',
    });
    expect(parseIntent('vscode kholo aur hello world likho')).toEqual({
      kind: 'app_task',
      app: 'vscode',
      content: 'hello world',
    });
  });

  it('trailing punctuation is trimmed from the content, inner punctuation kept', () => {
    expect(parseIntent('open notepad and write buy milk!')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'buy milk',
    });
    expect(parseIntent('open notepad and write buy milk, then eggs')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'buy milk, then eggs',
    });
  });

  it('opencode composite routes to the EXISTING opencode_task intent (run_opencode_task)', () => {
    expect(parseIntent('open opencode and write a snake game')).toEqual({
      kind: 'opencode_task',
      prompt: 'a snake game',
    });
    expect(parseIntent('start opencode and write a todo app')).toEqual({
      kind: 'opencode_task',
      prompt: 'a todo app',
    });
    expect(parseIntent('opencode kholo aur snake game likho')).toEqual({
      kind: 'opencode_task',
      prompt: 'snake game',
    });
  });

  it('hand-it-a-prompt composites: "give it …" / "tell X to …" / "ask X to …" route correctly', () => {
    // The real-world miss: the verb list only had build-verbs, so the prompt
    // was dropped and the whole utterance became a mangled launch alias.
    expect(parseIntent('open opencode and give it some prompt')).toEqual({
      kind: 'opencode_task',
      prompt: 'some prompt',
    });
    expect(parseIntent('open work buddy and give it a prompt')).toEqual({
      kind: 'app_task',
      app: 'work buddy',
      content: 'a prompt',
    });
    expect(parseIntent('tell opencode to build a snake game')).toEqual({
      kind: 'opencode_task',
      prompt: 'build a snake game',
    });
    expect(parseIntent('tell work buddy to draft an email')).toEqual({
      kind: 'app_task',
      app: 'work buddy',
      content: 'draft an email',
    });
    expect(parseIntent('ask work buddy to summarize my notes')).toEqual({
      kind: 'app_task',
      app: 'work buddy',
      content: 'summarize my notes',
    });
    // send/feed/drop/dump share the same composite verbs.
    expect(parseIntent('open notepad and send the meeting notes')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'the meeting notes',
    });
    // No pronoun after the verb → the content keeps everything.
    expect(parseIntent('open notepad and give hello world')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'hello world',
    });
    // The pronoun is consumed, not typed into the app.
    expect(parseIntent('open notepad and tell it to save the file')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'to save the file',
    });
  });

  it('verb-first give shapes: "give notepad this note: buy milk" (en + Hinglish)', () => {
    expect(parseIntent('give notepad this note: buy milk')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'buy milk',
    });
    expect(parseAppTask('send slack a note: standup moved to 10')).toEqual({
      kind: 'app_task',
      app: 'slack',
      content: 'standup moved to 10',
    });
    // Hinglish ko-handoff and me-shape with the de do tail.
    expect(parseIntent('notepad ko ye note de do')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'ye note',
    });
    expect(parseIntent('notepad me ye note de do')).toEqual({
      kind: 'app_task',
      app: 'notepad',
      content: 'ye note',
    });
    // Hinglish opencode handoff keeps routing to opencode_task.
    expect(parseIntent('opencode ko ye prompt bhejo')).toEqual({
      kind: 'opencode_task',
      prompt: 'ye prompt',
    });
  });

  it('conversational give/tell/ask never becomes app_task (pronoun apps are not apps)', () => {
    expect(parseIntent('give me a haiku about cats')).toBeNull();
    expect(parseIntent('give me the weather')).toBeNull();
    expect(parseIntent('tell me a joke')).toBeNull();
    expect(parseIntent('ask me anything')).toBeNull();
    expect(parseIntent('send me the file')).toBeNull();
  });

  it('non-hijack: bare notes, to-dos, searches and plain launches keep their intents', () => {
    expect(parseIntent('note down buy milk')).toMatchObject({ kind: 'note_notepad' });
    expect(parseIntent('add milk to my todo list')).toMatchObject({ kind: 'add_todo' });
    expect(parseIntent('notepad me hello likho')).toMatchObject({ kind: 'note_notepad' });
    expect(parseIntent('write hello in notepad')).toMatchObject({ kind: 'note_notepad' });
    expect(parseIntent('open notepad')).toEqual({ kind: 'launch_app', alias: 'notepad' });
    expect(parseIntent('open chrome')).toEqual({ kind: 'launch_app', alias: 'chrome' });
    expect(parseIntent('open youtube and search lofi beats')).toMatchObject({ kind: 'youtube_search' });
  });

  it('content shorter than 3 chars falls through (no half tasks)', () => {
    // 'ab' is too short for a task → launch_app keeps the (mangled) alias, as before.
    expect(parseIntent('open notepad and write ab')).toEqual({
      kind: 'launch_app',
      alias: 'notepad and write ab',
    });
  });

  it('direct parseAppTask: strips leading articles from the app token', () => {
    expect(parseAppTask('open the calculator and write 9 times 9')).toEqual({
      kind: 'app_task',
      app: 'calculator',
      content: '9 times 9',
    });
  });

  it('intentToTool maps app_task onto the bridge tool with {app, content}', () => {
    expect(intentToTool({ kind: 'app_task', app: 'notepad', content: 'hello world' })).toEqual({
      tool: 'app_task',
      args: { app: 'notepad', content: 'hello world' },
    });
  });
});

describe('parseIntent — identity (who are you / tum kaun ho)', () => {
  it('parses en + Hinglish + Devanagari identity questions', () => {
    for (const utterance of [
      'who are you?',
      'Who are you',
      'what can you do',
      "what is your name",
      "what's your name",
      'tum kaun ho',
      'aap kaun ho',
      'tumhara naam kya hai',
      'aapka naam batao',
      'तुम कौन हो',
      'आप कौन हो',
      'आपका नाम क्या है',
    ]) {
      expect(parseIntent(utterance), utterance).toEqual({ kind: 'identity' });
    }
  });

  it('never maps to a tool (the callers answer from i18n)', () => {
    expect(intentToTool({ kind: 'identity' })).toBeNull();
  });

  it('does not fire on lookalikes', () => {
    expect(parseIntent('who is the president')).toBeNull();
    expect(parseIntent('what can you cook')).toBeNull();
  });
});
