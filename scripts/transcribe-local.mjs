#!/usr/bin/env node
// Free, offline word-level transcription with whisper.cpp -> the kit's common JSON format.
// { text, audio_duration_secs, words: [{ text, start, end, type }] }
//
// Usage:
//   node scripts/transcribe-local.mjs <video|audio> [--output path] [--model path] [--language en] [--prompt text]
//
// Setup (already done on this machine):  brew install whisper-cpp
//   model: ~/.cache/whisper-cpp/ggml-small.en.bin  (English only; use ggml-small.bin etc. for other languages)
//   other models: https://huggingface.co/ggerganov/whisper.cpp/tree/main
//
// Notes:
//  - Nothing is uploaded. Word times come from token timestamps, so they are slightly less precise than
//    ElevenLabs Scribe. Check cuts at joins with scripts/audio-joins.mjs.
//  - A verbatim-style prompt is sent by default so "um/uh" are more likely to be kept in the text.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { argv, exit } from "node:process";

const VERBATIM_PROMPT = "Umm, let me think, like, hmm... Okay, so, uh, here's what I'm, you know, thinking.";
const args = argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("Usage: node scripts/transcribe-local.mjs <input> [--output path] [--model path] [--language en] [--prompt text]");
  exit(args.length ? 0 : 1);
}
const o = { input: null, output: null, model: join(homedir(), ".cache/whisper-cpp/ggml-small.en.bin"), language: "en", prompt: VERBATIM_PROMPT };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--output" || a === "-o") o.output = args[++i];
  else if (a === "--model") o.model = args[++i];
  else if (a === "--language" || a === "--lang") o.language = args[++i];
  else if (a === "--prompt") o.prompt = args[++i];
  else if (a.startsWith("--")) { console.error(`unknown option: ${a}`); exit(1); }
  else o.input = a;
}
const die = (m) => { console.error(m); exit(1); };
if (!o.input) die("no input file given");
const input = resolve(o.input);
if (!existsSync(input)) die(`input not found: ${input}`);
if (!existsSync(o.model)) die(`model not found: ${o.model}\nDownload one, e.g.:\n  curl -L -o ~/.cache/whisper-cpp/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`);
const which = spawnSync("which", ["whisper-cli"], { encoding: "utf8" });
if (which.status !== 0) die("whisper-cli not found. Install with: brew install whisper-cpp");

const output = resolve(o.output ?? join(dirname(input), `${basename(input, extname(input))}.json`));
const tmp = mkdtempSync(join(tmpdir(), "wcpp-"));
try {
  const wav = join(tmp, "in.wav");
  const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { encoding: "utf8" });
  if (ff.status !== 0) die(`ffmpeg failed:\n${ff.stderr}`);
  const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav], { encoding: "utf8" }).stdout.trim());

  const prefix = join(tmp, "out");
  const wargs = ["-m", o.model, "-f", wav, "-l", o.language, "-ml", "1", "-sow", "-oj", "-of", prefix, "-np"];
  if (o.prompt) wargs.push("--prompt", o.prompt);
  console.log("transcribing locally with whisper.cpp ...");
  const t0 = Date.now();
  const w = spawnSync("whisper-cli", wargs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (w.status !== 0) die(`whisper-cli failed:\n${(w.stderr ?? "").slice(-1500)}`);

  const raw = JSON.parse(readFileSync(`${prefix}.json`, "utf8"));
  const words = [];
  for (const seg of raw.transcription ?? []) {
    const text = (seg.text ?? "").trim();
    if (!text || /^[\[(].*[\])]$/.test(text)) continue; // [BLANK_AUDIO], (music) ...
    const start = seg.offsets.from / 1000, end = seg.offsets.to / 1000;
    if (words.length && !/[A-Za-z0-9]/.test(text[0])) { words.at(-1).text += text; words.at(-1).end = Math.max(words.at(-1).end, end); continue; } // glue punctuation
    words.push({ text, start: +start.toFixed(3), end: +end.toFixed(3), type: "word" });
  }
  if (!words.length) die("whisper returned no words");
  writeFileSync(output, JSON.stringify({ text: words.map((x) => x.text).join(" "), language_code: o.language, audio_duration_secs: +dur.toFixed(3), words }, null, 2));
  console.log(`ok ${((Date.now() - t0) / 1000).toFixed(1)}s | ${words.length} words | ${dur.toFixed(1)}s audio | ${output}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
