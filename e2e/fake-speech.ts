export type ScriptLine = string | { text: string; wordMs: number }

export type FakeSpeechOptions = {
  mode: 'echo' | 'garble' | 'silent' | 'script' | 'lines'

  denyMicrophone?: boolean | number

  denyError?: 'not-allowed' | 'service-not-allowed'

  script?: Record<string, string[]>

  answerDelayMs?: number

  lines?: readonly ScriptLine[]
  wordMs?: number
  pauseMs?: number

  autoStopMs?: number

  appVoice?: 'no-key' | 'network'

  chunks?: 'one' | 'safari'

  speakMs?: number
}

export function fakeSpeechScript(options: FakeSpeechOptions): string {
  return `(() => {
  const options = ${JSON.stringify(options)};
  const spoken = [];
  // running: a recognizer is listening now (started and not yet stopped or ended).
  const state = { listens: 0, lines: 0, running: false };
  window.__fakeSpeech = { spoken, state, options };

  const events = [];
  window.__fakeSpeech.events = events;
  let playing = null;
  const endLine = () => {
    const line = playing;
    if (!line) return;
    playing = null;
    synth.speaking = false;
    clearTimeout(line.timer);
    events.push({ type: 'speak-end', text: line.utterance.text });
    line.utterance.onend && line.utterance.onend(new Event('end'));
  };
  const synth = {
    speaking: false,
    getVoices: () => [{ name: 'Samantha (Enhanced)', lang: 'en-US', default: true, localService: true, voiceURI: 'samantha' }],
    cancel: () => { if (options.speakMs) endLine(); },
    speak: (utterance) => {
      spoken.push(utterance.text);
      if (options.speakMs && utterance.text) {
        endLine();
        events.push({ type: 'speak-start', text: utterance.text });
        synth.speaking = true;
        playing = { utterance, timer: setTimeout(endLine, options.speakMs) };
        return;
      }
      setTimeout(() => utterance.onend && utterance.onend(new Event('end')), 0);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.lang = 'en-US'; } };

  // The app's voice: what it asked /api/tts for, and the keyless server's answer.
  const voiceAsked = [];
  window.__fakeSpeech.voiceAsked = voiceAsked;
  // The reports of lines said by the fake synthesizer instead.
  const fallbacks = [];
  window.__fakeSpeech.fallbacks = fallbacks;
  const isFallbackReport = (url) => url.origin === location.origin && url.pathname === '/api/tts/fallback';
  const keepReport = (body) => {
    try { fallbacks.push(JSON.parse(String(body))); } catch { fallbacks.push(null); }
  };
  if (options.appVoice !== 'network') {
    const realBeacon = typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon.bind(navigator) : null;
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (target, data) => {
        if (isFallbackReport(new URL(String(target), location.href))) {
          keepReport(data);
          return true;
        }
        return realBeacon ? realBeacon(target, data) : false;
      },
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      if (isFallbackReport(url)) {
        keepReport(init && init.body);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.origin === location.origin && (url.pathname === '/api/tts' || url.pathname.startsWith('/api/tts/'))) {
        let text = null;
        try { text = JSON.parse(String(init && init.body)).text; } catch {}
        voiceAsked.push(text);
        return Promise.resolve(new Response(JSON.stringify({ error: 'no-key', fallback: 'system-voice' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }));
      }
      return realFetch(input, init);
    };
  }

  function heard() {
    if (options.mode === 'silent') return '';
    if (options.mode === 'script') {
      const marked = document.querySelector('[data-screen]');
      const screen = marked ? marked.getAttribute('data-screen') || '' : '';
      const lines = (options.script && options.script[screen]) || [];
      return lines.length > 0 ? lines.shift() : '';
    }
    const card = document.querySelector('[data-text-style="title-l"]');
    const text = card ? card.textContent || '' : '';
    if (options.mode === 'echo') return text;
    return 'um something else entirely';
  }

  // One result per chunk (Safari's later chunks carry no leading space); every chunk before the
  // last is final.
  function emitChunks(recognition, chunks, isFinal) {
    const list = chunks.map((text, i) => {
      const alternative = { transcript: text, confidence: 0.9 };
      const done = isFinal || i < chunks.length - 1;
      return Object.assign([alternative], { isFinal: done, length: 1, item: (k) => alternative });
    });
    const results = Object.assign(list, { length: list.length, item: (i) => list[i] });
    recognition.onresult && recognition.onresult({ resultIndex: 0, results });
  }

  function emit(recognition, text, isFinal) {
    emitChunks(recognition, [text], isFinal);
  }

  // A scripted answer as it is heard: Safari's chunks ("||" parts, no leading space), or one.
  function emitAnswer(recognition, text) {
    if (options.chunks === 'safari') {
      emitChunks(recognition, text.split('||').map((part) => part.trim()).filter(Boolean), true);
    } else {
      emit(recognition, text.replace(/\\s*\\|\\|\\s*/g, ' '), true);
    }
  }

  // The learner's tap on Stop recording, ms from now, if this listen is still going (a practice
  // ends only on their tap). Taps a guarded button again until it takes.
  function tapStop(recognition, session, ms) {
    setTimeout(() => {
      if (!recognition.running || recognition.session !== session) return;
      const stop = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Stop recording');
      if (stop) stop.click();
      tapStop(recognition, session, 1000);
    }, ms);
  }

  // Mode 'lines': says one line a word at a time; stops as soon as listening stops.
  function sayLine(recognition, session, entry) {
    const line = typeof entry === 'string' ? entry : entry.text;
    const wordMs = (typeof entry === 'string' ? options.wordMs : entry.wordMs) || 250;
    const pauseMs = options.pauseMs || 1500;
    // The words heard so far, by chunk ("||" part).
    const said = [];
    let at = 0;
    const steps = [];
    line.split('||').forEach((part, chunk) => {
      const words = part.trim().split(/\\s+/).filter(Boolean);
      for (const word of words) { at += wordMs; steps.push({ at, word, chunk }); }
      at += pauseMs - wordMs;
    });
    // A line ending in "[stop]" is the learner's tap on Stop recording at that moment, not a word (a mic
    // practice ends only on the learner's tap).
    const last = steps.length > 0 && steps[steps.length - 1].word === '[stop]' ? steps.pop() : null;
    steps.forEach((step, i) => {
      setTimeout(() => {
        if (!recognition.running || recognition.session !== session) return;
        (said[step.chunk] = said[step.chunk] || []).push(step.word);
        const chunks = said.filter(Boolean).map((words) => words.join(' '));
        if (options.chunks === 'safari') emitChunks(recognition, chunks, i === steps.length - 1);
        else emit(recognition, chunks.join(' '), i === steps.length - 1);
      }, step.at);
    });
    if (last) tapStop(recognition, session, last.at);
  }

  class FakeRecognition {
    constructor() { this.continuous = false; this.interimResults = false; this.lang = 'en-US'; this.running = false; this.session = 0; }
    start() {
      if (this.running) throw new DOMException('already started', 'InvalidStateError');
      this.running = true;
      state.running = true;
      this.session += 1;
      const session = this.session;
      state.listens += 1;
      events.push({ type: 'listen-start' });
      const marked = document.querySelector('[data-screen]');
      const answering = marked && marked.getAttribute('data-screen') === 'card';
      setTimeout(() => {
        if (options.mode === 'lines' && (!this.running || this.session !== session)) return;
        if (options.denyMicrophone === true || (typeof options.denyMicrophone === 'number' && state.listens >= options.denyMicrophone)) {
          this.onerror && this.onerror({ error: options.denyError || 'not-allowed', message: '' });
          this.running = false;
          state.running = false;
          this.onend && this.onend(new Event('end'));
          return;
        }
        this.onstart && this.onstart(new Event('start'));
        if (options.autoStopMs) {
          setTimeout(() => {
            if (!this.running || this.session !== session) return;
            this.running = false;
            state.running = false;
            this.onend && this.onend(new Event('end'));
          }, options.autoStopMs);
        }
        if (options.mode === 'lines') {
          const line = (options.lines || [])[state.lines] || '';
          state.lines += 1;
          if (line) sayLine(this, session, line);
          return;
        }
        const said = heard();
        // A final "[stop]" is the learner's tap on Stop recording once the words are heard.
        const stops = /\\s*\\[stop\\]$/.test(said);
        const text = said.replace(/\\s*\\[stop\\]$/, '');
        if (text) emitAnswer(this, text);
        if (stops) tapStop(this, session, 1500);
      }, answering && options.answerDelayMs ? options.answerDelayMs : 10);
    }
    stop() { if (!this.running) return; this.running = false; state.running = false; setTimeout(() => this.onend && this.onend(new Event('end')), 0); }
    abort() { this.stop(); }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
})();`
}
