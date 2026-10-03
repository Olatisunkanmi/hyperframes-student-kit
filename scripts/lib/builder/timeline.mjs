// Project config, hook location, the final-timeline word list, anchor lookup and caption grouping.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const normWord = (t) => (t ?? "").toLowerCase().replace(/[^a-z0-9'-]/g, "");

/** Load <project>/video.json and fill defaults. */
export function loadProject(dir) {
  const p = join(dir, "video.json");
  if (!existsSync(p)) throw new Error(`missing ${p} (see docs/BUILDER.md)`);
  const c = JSON.parse(readFileSync(p, "utf8"));
  const need = (k) => { if (c[k] === undefined) throw new Error(`video.json: "${k}" is required`); };
  ["slug", "source", "hook", "lowerThird"].forEach(need);
  return {
    brand: "brand/brand.json",
    bodyStart: 0.12,
    bumper: 2,
    outro: { seconds: 2.5, text: "Follow for the build" },
    nameFixes: {},
    emphasis: [],
    crop4x5Y: 160,
    ...c,
    hook: { pre: 0.1, post: 0.16, ...c.hook },
  };
}

/** Spoken words of the cleaned cut (type "word" only). */
export function loadWords(dir, cfg) {
  const t = JSON.parse(readFileSync(join(dir, cfg.source.transcript), "utf8"));
  return t.words.filter((w) => (w.type ?? "word") === "word");
}

/** Find the cold-open hook range on the cleaned timeline from three spoken words. */
export function locateHook(words, hook) {
  const after = words.findIndex((w) => normWord(w.text) === normWord(hook.after));
  const first = words.findIndex((w, i) => i > after && normWord(w.text) === normWord(hook.from));
  const last = words.findIndex((w, i) => i > first && normWord(w.text) === normWord(hook.to));
  if (after < 0 || first < 0 || last < 0) throw new Error(`hook words not found in order: ${hook.after} ... ${hook.from} ... ${hook.to}`);
  return { HS: +(words[first].start - hook.pre).toFixed(3), HE: +(words[last].end + hook.post).toFixed(3) };
}

/** Words on the FINAL timeline: [hook][bumper gap][body][outro]. */
export function finalWords(srcWords, meta, cfg) {
  const { HOOK_SRC, BODY_SRC_START, H, BUMPER } = meta;
  const body = (t) => +(H + BUMPER + t - BODY_SRC_START).toFixed(3);
  const out = [];
  for (const w of srcWords) if (w.start >= HOOK_SRC[0] - 0.01 && w.end <= HOOK_SRC[1] + 0.01) out.push({ text: w.text, start: +(w.start - HOOK_SRC[0]).toFixed(3), end: +(w.end - HOOK_SRC[0]).toFixed(3), part: "hook" });
  for (const w of srcWords) if (w.start >= BODY_SRC_START) out.push({ text: cfg.nameFixes[w.text] ?? w.text, start: body(w.start), end: body(w.end), part: "body" });
  return out;
}

/** find(text, from, part): first spoken word equal to `text` (normalized) at or after `from`. Throws if missing. */
export function makeFind(words) {
  return (text, from = 0, part) => {
    const w = words.find((x) => x.start >= from && normWord(x.text) === normWord(text) && (!part || x.part === part));
    if (!w) throw new Error(`anchor not found: "${text}" after ${from}s${part ? ` in ${part}` : ""}`);
    return w;
  };
}

/** Caption groups: 3-4 words, break on part change, a pause over 320 ms, or sentence punctuation. */
export function captionGroups(words, total, maxWords = 4) {
  const groups = []; let cur = [];
  const flush = () => { if (cur.length) { groups.push(cur); cur = []; } };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && (w.part !== prev.part || w.start - prev.end > 0.32 || /[.!?:]$/.test(prev.text))) flush();
    cur.push(w); if (cur.length >= maxWords) flush();
  });
  flush();
  return groups.map((g, gi) => ({ words: g, start: g[0].start, end: Math.min(g.at(-1).end + 0.12, (groups[gi + 1]?.[0].start ?? total) - 0.02) }));
}
