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
