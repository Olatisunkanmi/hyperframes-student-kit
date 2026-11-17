// Transcript-driven moment selection: pure logic (no I/O) behind scripts/select-moments.mjs.
// A "pick" is a spoken range chosen from a long recording: { slug, from, to, reason, hook? } in source seconds.
// Picks are snapped to word boundaries, linted for clean starts and ends, and retimed onto the output timeline.
import { createHash } from "node:crypto";

export const DEFAULTS = Object.freeze({
  padIn: 0.08, // seconds kept before the first word
  padOut: 0.2, // seconds kept after the last word
  tol: 0.15, // tolerance when snapping a typed time onto a word boundary
  sentenceGap: 0.9, // a pause this long also ends a "sentence" (for transcripts without punctuation)
  minSeconds: 6,
  maxSeconds: 60,
  fade: 0.012, // audio fade at each stitched join, avoids clicks
});

const SENTENCE_END = /[.?!]["')\]]*$/;
export const endsSentence = (text) => SENTENCE_END.test(String(text ?? "").trim());
const r3 = (n) => Number(n.toFixed(3));

/** Timed words only, as plain objects. */
export function loadWords(transcript) {
  if (!Array.isArray(transcript?.words)) throw new Error("transcript has no words array");
  const words = transcript.words
    .filter((w) => (w.type ? w.type === "word" : true))
    .filter((w) => Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
    .map((w) => ({ text: String(w.text), start: Number(w.start), end: Number(w.end) }));
  if (!words.length) throw new Error("transcript has no timed words");
  return words;
}

/** Split words into sentences at terminal punctuation or a long pause. */
export function sentences(words, opts = {}) {
  const gap = opts.sentenceGap ?? DEFAULTS.sentenceGap;
  const out = [];
  let from = 0;
  words.forEach((w, i) => {
    const next = words[i + 1];
    const last = i === words.length - 1;
    if (last || endsSentence(w.text) || next.start - w.end > gap) {
      const slice = words.slice(from, i + 1);
      out.push({ index: out.length, start: slice[0].start, end: w.end, firstWord: from, lastWord: i, text: slice.map((x) => x.text).join(" ") });
      from = i + 1;
    }
  });
  return out;
}

/** Snap a typed [from, to] onto word boundaries and add speech padding that never reaches a neighbouring word. */
export function resolvePick(words, pick, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!Number.isFinite(pick.from) || !Number.isFinite(pick.to) || pick.to <= pick.from) {
    throw new Error(`pick "${pick.slug}": from/to must be numbers with to > from`);
  }
  const first = words.findIndex((w) => w.start >= pick.from - o.tol);
  let last = -1;
  words.forEach((w, i) => { if (w.end <= pick.to + o.tol) last = i; });
  if (first === -1 || last === -1 || last < first) throw new Error(`pick "${pick.slug}": no spoken words between ${pick.from}s and ${pick.to}s`);
  const prev = words[first - 1];
  const next = words[last + 1];
  const start = Math.max(0, prev ? Math.max(words[first].start - o.padIn, (prev.end + words[first].start) / 2) : words[first].start - o.padIn);
  const end = next ? Math.min(words[last].end + o.padOut, (words[last].end + next.start) / 2) : words[last].end + o.padOut;
  const text = words.slice(first, last + 1).map((w) => w.text).join(" ");
  return {
    slug: pick.slug,
    reason: pick.reason,
    hook: pick.hook ?? null,
    firstWord: first,
    lastWord: last,
    start: r3(start),
    end: r3(end),
    seconds: r3(end - start),
    text,
  };
}

/** Problems with one resolved pick. "error" blocks approval; "warn" is shown to the reviewer. */
export function lintPick(words, pick, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const issues = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pick.slug ?? "")) issues.push({ level: "error", message: "slug must be lowercase kebab-case" });
  if (!pick.reason || String(pick.reason).trim().length < 8) issues.push({ level: "error", message: "needs a reason (why this moment, in one sentence)" });
  const prev = words[pick.firstWord - 1];
  if (prev && !endsSentence(prev.text) && words[pick.firstWord].start - prev.end < o.sentenceGap) {
    issues.push({ level: "warn", message: `starts mid-sentence (after "${prev.text}")` });
  }
  if (!endsSentence(words[pick.lastWord].text)) issues.push({ level: "warn", message: `ends without closing the thought ("${words[pick.lastWord].text}")` });
  if (pick.seconds < o.minSeconds) issues.push({ level: "warn", message: `short: ${pick.seconds}s (< ${o.minSeconds}s)` });
  if (pick.seconds > o.maxSeconds) issues.push({ level: "warn", message: `long: ${pick.seconds}s (> ${o.maxSeconds}s)` });
  if (pick.lastWord - pick.firstWord + 1 < 4) issues.push({ level: "error", message: "fewer than 4 words" });
  return issues;
}

/** Resolve and lint a whole selection. Overlapping picks are errors; out-of-order picks are noted. */
export function resolveSelection(words, selection, opts = {}) {
  const picks = selection?.picks;
  if (!Array.isArray(picks) || !picks.length) throw new Error("selection needs a non-empty picks array");
  const slugs = new Set();
  const resolved = picks.map((p) => {
    const r = resolvePick(words, p, opts);
    const issues = lintPick(words, r, opts);
    if (slugs.has(r.slug)) issues.push({ level: "error", message: "duplicate slug" });
    slugs.add(r.slug);
    return { ...r, issues };
  });
  const byTime = resolved.map((r, i) => ({ r, i })).sort((a, b) => a.r.start - b.r.start);
  const withOverlap = resolved.map((r) => ({ ...r, issues: [...r.issues] }));
  for (let k = 1; k < byTime.length; k++) {
    const a = byTime[k - 1];
    const b = byTime[k];
    if (b.r.start < a.r.end) {
      withOverlap[a.i].issues.push({ level: "error", message: `overlaps "${b.r.slug}"` });
      withOverlap[b.i].issues.push({ level: "error", message: `overlaps "${a.r.slug}"` });
    }
  }
  const inOrder = withOverlap.every((r, i) => i === 0 || r.start >= withOverlap[i - 1].start);
  const total = r3(withOverlap.reduce((s, r) => s + r.seconds, 0));
  const errors = withOverlap.flatMap((r) => r.issues.filter((x) => x.level === "error"));
  return { picks: withOverlap, totalSeconds: total, sourceOrder: inOrder, errorCount: errors.length };
}

/** Stable hash of the resolved ranges: approval is bound to this, so editing a pick after approval invalidates it. */
export function picksHash(picks) {
  const key = picks.map((p) => [p.slug, p.start, p.end]);
  return createHash("sha1").update(JSON.stringify(key)).digest("hex").slice(0, 12);
}

/** Words of the given ranges moved onto a new timeline. mode "stitch": ranges butt together; "separate": each starts at 0. */
export function retime(words, ranges, mode) {
  let cursor = 0;
  return ranges.map((range) => {
    const offset = mode === "stitch" ? cursor : 0;
    const shift = offset - range.start;
    const kept = words
      .filter((w) => w.start >= range.start && w.end <= range.end)
      .map((w) => ({ text: w.text, start: r3(w.start + shift), end: r3(w.end + shift), source_start: w.start, source_end: w.end, type: "word" }));
    cursor += range.end - range.start;
    return { slug: range.slug, offset: r3(offset), seconds: r3(range.end - range.start), words: kept };
  });
}

/** ffmpeg filtergraph that trims each range and joins them; audio gets a tiny fade at each join. */
export function buildFilter(ranges, opts = {}) {
  const fade = opts.fade ?? DEFAULTS.fade;
  const lines = ranges.map((r, i) => {
    const d = r.end - r.start;
    const f = ranges.length > 1 ? `,afade=t=in:d=${fade},afade=t=out:st=${r3(Math.max(0, d - fade))}:d=${fade}` : "";
    return `[0:v]trim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];` +
      `[0:a]atrim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},asetpts=PTS-STARTPTS${f}[a${i}]`;
  });
  const join = ranges.length === 1
    ? "[v0]null[v];[a0]anull[a]"
    : `${ranges.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${ranges.length}:v=1:a=1[v][a]`;
  return `${lines.join(";\n")};\n${join}`;
}

const stamp = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

/** The review document the user approves. */
export function renderSelectionMd({ source, sourceSeconds, result, hash }) {
  const lines = [
    "# Selection plan",
    "",
    `Source: \`${source}\` (${stamp(sourceSeconds)})`,
    `Picks: ${result.picks.length}, ${result.totalSeconds}s total (${((result.totalSeconds / sourceSeconds) * 100).toFixed(0)}% of the source)`,
    `Plan id: \`${hash}\` (approval is tied to this; any change to the ranges needs a fresh approval)`,
    result.sourceOrder ? "" : "Picks are not in source order. Stitch mode will play them in the order listed.",
    "",
  ];
  result.picks.forEach((p, i) => {
    lines.push(`## ${i + 1}. ${p.slug}: ${stamp(p.start)} to ${stamp(p.end)} (${p.seconds}s)`, "");
    if (p.hook) lines.push(`**Hook:** ${p.hook}`, "");
    lines.push(`**Why:** ${p.reason}`, "", `> ${p.text}`, "");
    p.issues.forEach((x) => lines.push(`- ${x.level === "error" ? "ERROR" : "warn"}: ${x.message}`));
    if (p.issues.length) lines.push("");
  });
  lines.push("## To approve", "", "Say which picks to keep, drop or adjust, and whether to stitch them into one short or make one short per pick.");
  return `${lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n")}\n`;
}
