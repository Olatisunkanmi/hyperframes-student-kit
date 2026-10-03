#!/usr/bin/env node
// Transcribe a video/audio file with OpenAI Whisper (whisper-1) -> word-level JSON
// in the kit's common format: { text, audio_duration_secs, words: [{ text, start, end, type }] }.
//
// Usage:
//   node scripts/transcribe-openai.mjs <input> [options]
//
// Defaults:
//   --output   <input-without-ext>.json next to the source
//   --language en
//   --chunk-minutes 20   audio is split so each upload stays under the 25 MB API limit;
//                        chunk offsets are added back so times match the source.
//   audio extraction: mono 16 kHz mp3 @ 64 kbps via ffmpeg (temp files deleted).
//
// Whisper tends to omit "um"/"uh". A short verbatim-style prompt is sent by default to
// keep them in the transcript so find-fillers.mjs can see them. Override with --prompt "".
//
// Reads OPENAI_API_KEY from process.env or the workspace .env file.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, openAsBlob, readdirSync } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { argv, exit, env } from "node:process";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const VERBATIM_PROMPT = "Umm, let me think, like, hmm... Okay, so, uh, here's what I'm, you know, thinking.";

const die = (msg, code = 1) => { console.error(msg); exit(code); };

const args = argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/transcribe-openai.mjs <input> [--output path] [--language en] [--chunk-minutes 20] [--prompt text]");
  exit(args.length === 0 ? 1 : 0);
}
const opts = { input: null, output: null, language: "en", chunkMinutes: 20, prompt: VERBATIM_PROMPT };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--output" || a === "-o") opts.output = args[++i];
  else if (a === "--language" || a === "--lang") opts.language = args[++i];
  else if (a === "--chunk-minutes") opts.chunkMinutes = Number(args[++i]);
  else if (a === "--prompt") opts.prompt = args[++i];
  else if (a.startsWith("--")) die(`unknown option: ${a}`);
  else if (!opts.input) opts.input = a;
  else die(`unexpected argument: ${a}`);
}
if (!opts.input) die("no input file given");
if (!(opts.chunkMinutes > 0)) die("--chunk-minutes must be a positive number");

const inputPath = resolve(opts.input);
if (!existsSync(inputPath)) die(`input not found: ${inputPath}`);
const outputPath = resolve(opts.output ?? join(dirname(inputPath), `${basename(inputPath, extname(inputPath))}.json`));

let apiKey = env.OPENAI_API_KEY;
if (!apiKey && existsSync(join(WORKSPACE_ROOT, ".env"))) {
  for (const line of readFileSync(join(WORKSPACE_ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) { apiKey = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
if (!apiKey) die("OPENAI_API_KEY not set (env or workspace .env)");

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inputPath], { encoding: "utf8" });
const duration = Number(probe.stdout.trim());
if (probe.status !== 0 || !(duration > 0)) die("ffprobe could not read the input duration");

const tmp = mkdtempSync(join(tmpdir(), "whisper-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true })); // die() exits without running finally
try {
  const chunkSecs = Math.round(opts.chunkMinutes * 60);
  console.log(`extracting audio (${duration.toFixed(1)}s) in ${chunkSecs}s chunks ...`);
  const ff = spawnSync("ffmpeg", [
    "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k",
    "-f", "segment", "-segment_time", String(chunkSecs), "-reset_timestamps", "1", join(tmp, "chunk-%03d.mp3"),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  if (ff.status !== 0) die(`ffmpeg failed:\n${ff.stderr?.toString() ?? ""}`, ff.status ?? 1);

  const chunks = readdirSync(tmp).filter((f) => f.startsWith("chunk-")).sort();
  const words = [];
  const texts = [];
  const t0 = Date.now();
  for (let c = 0; c < chunks.length; c++) {
    const file = join(tmp, chunks[c]);
    const offset = c * chunkSecs;
    console.log(`uploading chunk ${c + 1}/${chunks.length} to OpenAI ...`);
    const form = new FormData();
    form.append("file", await openAsBlob(file), chunks[c]);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    if (opts.language) form.append("language", opts.language);
    if (opts.prompt) form.append("prompt", opts.prompt);
    const res = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    if (!res.ok) die(`HTTP ${res.status} on chunk ${c + 1}\n${await res.text()}`);
    const json = await res.json();
    texts.push(json.text ?? "");
    for (const w of json.words ?? []) {
      words.push({ text: w.word, start: Number((w.start + offset).toFixed(3)), end: Number((w.end + offset).toFixed(3)), type: "word" });
    }
  }
  if (words.length === 0) die("OpenAI returned no word timestamps");
  writeFileSync(outputPath, JSON.stringify({ text: texts.join(" ").trim(), language_code: opts.language, audio_duration_secs: Number(duration.toFixed(3)), words }, null, 2));
  console.log(`ok ${((Date.now() - t0) / 1000).toFixed(1)}s | ${words.length} words | ${duration.toFixed(1)}s audio | ${outputPath}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
