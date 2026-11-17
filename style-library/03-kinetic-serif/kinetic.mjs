// Kinetic Serif Mix: the caption and camera engine for this style pack, used from a project's beats.mjs with
// scripts/build-video.mjs. It replaces the builder's brand captions, lower-third and slow camera push, so the
// project's video.json must set  "captions": false, "lowerThird": false, "camera": false.
//
//   import { kinetic } from "../../style-library/03-kinetic-serif/kinetic.mjs";
//   export default (ctx) => kinetic(ctx, { hero: [ctx.find("record")], cards: [{ from, to, glyph: "?", hero: [word] }] });
//
// What it builds (all timed from the transcript, one word at a time):
//   - word stacks placed around the speaker: semi-bold sans, italic serif for small words, one large "hero" word
//   - full-screen white text cards (black type, one red glyph) for the few lines that deserve a takeover
//   - hard zoom jumps between "shots" at sentence ends, with a slow drift inside each shot
//   - one sound cue into and out of each card (the reference has no sound on ordinary caption words)
//
// spec  { hero, serif, sans, breaks, cards, zoom, faceY, minShot }
//   hero    word objects (from ctx.find) shown large on their own line
//   serif   word objects forced to italic serif;  sans  word objects forced to sans (overrides the small-word rule)
//   breaks  word objects that must start a new stack
//   cards   [{ from, to, glyph, hero: [words] }]  spoken range shown as a white card; hero words become the big line
//   minShot / maxShot  shortest and longest shot in seconds (default 1.6 / 4.2)
//   zoom    scale levels cycled per shot (default [1.15, 1.38, 1.24, 1.32]);  faceY  % from the top where the face sits
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = "assets/style/kinetic-serif";
export const SMALL_WORDS = new Set(("a an the of to in is as that for their your and or be it it's this when if are before also should because " +
  "you we they i my our his her its on at by with from so but not all very can will into than then").split(" "));
export const SLOT_ORDER = ["low", "topL", "lowL", "topR", "low", "top", "lowR", "topL"];
export const SLOT_WIDTH = { low: 900, top: 900, topL: 640, topR: 640, lowL: 640, lowR: 640 };
const SENTENCE_END = /[.!?]$/;

export const norm = (t) => t.toLowerCase().replace(/[^a-z0-9'-]/g, "");
export const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const shown = (t) => esc(t.replace(/[.,;:!?]+$/, ""));

/** Copy the pack's fonts into the project so the composition can load them locally. */
export function copyFonts(dir) {
  mkdirSync(join(dir, FONT_DIR), { recursive: true });
  for (const f of readdirSync(join(HERE, "fonts")).filter((name) => name.endsWith(".woff2"))) copyFileSync(join(HERE, "fonts", f), join(dir, FONT_DIR, f));
}

/** The @font-face rules for the pack's three font files. */
export function fontFaces() {
  const font = (family, weight, style, file) => `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};src:url('${FONT_DIR}/${file}') format('woff2')}`;
  return [font("Poppins", 600, "normal", "poppins-600.woff2"), font("Poppins", 700, "normal", "poppins-700.woff2"), font("Playfair Display", 500, "italic", "playfair-display-500-italic.woff2")].join("\n");
}

/** Split the spoken words into stacks (speaker) and cards (takeover), in order.
 *  Not built on captionGroups in scripts/lib/builder/timeline.mjs: that one makes brand caption bars and knows
 *  nothing about card ranges, comma breaks or folding one-word stacks. */
export function groupWords(words, { cards = [], breaks = [], maxWords = 4 } = {}) {
  const cardOf = new Map();
  cards.forEach((card, ci) => {
    const a = words.indexOf(card.from), b = words.indexOf(card.to);
    if (a < 0 || b < a) throw new Error(`kinetic: card ${ci} needs from/to word objects from ctx.find, in spoken order`);
    for (let i = a; i <= b; i++) cardOf.set(words[i], ci);
  });
  const forced = new Set(breaks);
  const groups = [];
  let current = null;
  words.forEach((word, i) => {
    const prev = words[i - 1];
    const card = cardOf.has(word) ? cardOf.get(word) : null;
    const startNew = !current || card !== current.card || word.part !== prev.part || forced.has(word) ||
      (card === null && (word.start - prev.end > 0.3 || SENTENCE_END.test(prev.text) || current.words.length >= maxWords ||
        (/,$/.test(prev.text) && current.words.length >= 2)));
    if (startNew) { current = { card, words: [] }; groups.push(current); }
    current.words.push(word);
  });
  return mergeOrphans(groups);
}

/** A stack of one word reads as a stray caption: fold it into the next stack, or the previous one at a sentence end. */
function mergeOrphans(groups) {
  const out = [];
  let carry = [];
  for (const group of groups) {
    const prev = out.at(-1);
    const words = [...carry, ...group.words];
    carry = [];
    const lone = group.card === null && words.length === 1;
    const samePart = (other) => other && other.card === null && other.words[0].part === words[0].part;
    if (lone && !SENTENCE_END.test(words[0].text) && samePart(groups[groups.indexOf(group) + 1])) { carry = words; continue; }
    if (lone && samePart(prev) && !SENTENCE_END.test(prev.words.at(-1).text) && words[0].start - prev.words.at(-1).end < 0.6) { out[out.length - 1] = { ...prev, words: [...prev.words, ...words] }; continue; }
    out.push({ ...group, words });
  }
  return out;
}

/** Give every group a start and end that never overlaps the next one and stops before `until`.
 *  Words spoken at or after `until` (under the outro) are dropped. */
export function timeGroups(allGroups, until) {
  const groups = allGroups.filter((g) => g.words[0].start < until - 0.15);
  let prevEnd = 0;
  return groups.map((group, gi) => {
    const next = groups[gi + 1];
    const start = Math.max(prevEnd, group.words[0].start - 0.06);
    const hold = group.card === null ? 0.35 : 0.18;
    const end = Math.min(group.words.at(-1).end + hold, next ? next.words[0].start - 0.05 : until, until);
    prevEnd = Math.min(Math.max(end, start + 0.1), until);
    return { ...group, start: +start.toFixed(3), end: +prevEnd.toFixed(3) };
  });
}

/** Break a group's words into short lines: a hero word stands alone, and a line ends when the type style changes. */
export function buildLines(words, classOf, maxChars = 11) {
  const lines = [];
  let line = null;
  for (const word of words) {
    const cls = classOf(word);
    const chars = shown(word.text).length;
    const fits = line && !line.hero && cls !== "h" && line.cls === cls && line.chars + 1 + chars <= maxChars;
    if (fits) { line.words.push(word); line.chars += 1 + chars; continue; }
    line = { cls, hero: cls === "h", words: [word], chars };
    lines.push(line);
  }
  return lines;
}

/** Shots: a new one starts after each card and at sentence ends or long pauses, at least `minShot` seconds apart,
 *  and at the next stack once a shot has run for `maxShot` seconds. */
export function planShots(groups, until, minShot = 1.6, maxShot = 4.2) {
  const starts = [0];
  groups.forEach((group, gi) => {
    const prev = groups[gi - 1];
    if (!prev || group.card !== null) return;
    const prevLast = prev.words.at(-1);
    const boundary = prev.card !== null || SENTENCE_END.test(prevLast.text) || group.words[0].start - prevLast.end > 0.45 || group.words[0].part !== prevLast.part;
    const since = group.start - starts.at(-1);
    if (((boundary && since >= minShot) || since >= maxShot) && until - group.start >= 0.8) starts.push(group.start);
  });
  return starts.map((start, i) => ({ start, end: starts[i + 1] ?? until }));
}

export function kinetic(ctx, spec = {}) {
  const { words, TOTAL, OUTRO, layout, dir, r } = ctx;
  const until = TOTAL - OUTRO;
  const heroes = new Set(spec.hero ?? []), serifs = new Set(spec.serif ?? []), sansSet = new Set(spec.sans ?? []);
  const cards = spec.cards ?? [];
  const zoom = spec.zoom ?? [1.15, 1.38, 1.24, 1.32];
  const faceY = spec.faceY ?? 54;
  const sy = layout.H / 1920; // slot heights were designed on 1080x1920

  copyFonts(dir);

  const classOf = (word) => heroes.has(word) ? "h" : serifs.has(word) ? "i" : sansSet.has(word) ? "s" : SMALL_WORDS.has(norm(word.text)) ? "i" : "s";
  const groups = timeGroups(groupWords(words, { cards, breaks: spec.breaks }), until);
  const wordId = new Map(words.map((w, i) => [w, `kw-${i}`]));
  const span = (word, cls, style = "") => `<span class="kw ${cls}" id="${wordId.get(word)}"${style ? ` style="${style}"` : ""}>${shown(word.text)}</span>`;

  let slotIndex = 0;
  const html = [], js = [], cues = [];
  html.push(`  <div id="kscrim" class="clip" data-start="0" data-duration="${until}" data-track-index="19"></div>`);

  groups.forEach((group, gi) => {
    const duration = r(group.end - group.start);
    if (group.card === null) {
      const slot = SLOT_ORDER[slotIndex++ % SLOT_ORDER.length];
      const lines = buildLines(group.words, classOf).map((line, li) => {
        const heroSize = line.hero ? Math.min(176, Math.floor(SLOT_WIDTH[slot] / (Math.max(4, line.chars) * 0.6))) : 0;
        return `<div class="kl${li % 2 ? " odd" : ""}">${line.words.map((w) => span(w, line.cls, heroSize ? `font-size:${heroSize}px` : "")).join(" ")}</div>`;
      });
      html.push(`  <div id="kg-${gi}" class="kg ${slot} clip" data-start="${group.start}" data-duration="${duration}" data-track-index="${20 + (gi % 2)}"><div class="kgi" id="kgi-${gi}">${lines.join("")}</div></div>`);
      if (group.end - group.start >= 0.3) js.push(`tl.to('#kgi-${gi}',{opacity:0,filter:'blur(10px)',duration:.1,ease:'power1.in'},${r(group.end - 0.12)});tl.set('#kgi-${gi}',{opacity:0},${r(group.end - 0.02)});`);
    } else {
      const card = cards[group.card];
      const cardHero = new Set(card.hero ?? []);
      const lines = buildLines(group.words, (w) => (cardHero.has(w) ? "h" : "s"), 14).map((line) => {
        const size = line.hero ? Math.min(230, Math.floor(880 / (Math.max(3, line.chars) * 0.5))) : 0;
        return `<div class="kl">${line.words.map((w) => span(w, line.hero ? "cb" : "cs", size ? `font-size:${size}px` : "")).join(" ")}</div>`;
      });
      html.push(`  <div id="kg-${gi}" class="kcard clip" data-start="${group.start}" data-duration="${duration}" data-track-index="22"><div class="kblock">${card.glyph ? `<div class="kglyph" id="kgl-${gi}">${esc(card.glyph)}</div>` : ""}${lines.join("")}</div></div>`);
      if (card.glyph) js.push(`tl.fromTo('#kgl-${gi}',{opacity:0,filter:'blur(18px)',scale:.7,rotation:-14},{opacity:1,filter:'blur(0px)',scale:1,rotation:0,duration:.3,ease:'back.out(1.6)'},${r(group.start + 0.04)});`);
      if (group.start > 0.2) js.push(`tl.fromTo('#kflash',{opacity:0},{opacity:.6,duration:.07,ease:'none'},${r(group.start - 0.07)});tl.set('#kflash',{opacity:0},${group.start});`);
      cues.push({ t: Math.max(0, group.start - 0.1), sfx: "whoosh-up", gain: -12, why: `text card in: ${group.words.map((w) => w.text).join(" ")}` });
      if (group.end < until - 0.2 && groups[gi + 1]?.card === null) cues.push({ t: group.end, sfx: "tick", gain: -10, why: "text card out, back to the speaker" });
    }
    for (const word of group.words) {
      const at = r(Math.max(group.start, word.start - 0.05));
      js.push(`tl.fromTo('#${wordId.get(word)}',{opacity:0,filter:'blur(16px)',y:16,scale:1.06},{opacity:1,filter:'blur(0px)',y:0,scale:1,duration:.26,ease:'power2.out'},${at});`);
    }
  });
  html.push(`  <div id="kflash" class="clip" data-start="0" data-duration="${until}" data-track-index="23"></div>`);

  const shots = planShots(groups, until, spec.minShot, spec.maxShot);
  shots.forEach((shot, i) => {
    const z = zoom[i % zoom.length];
    js.push(`tl.set('#vwrap',{scale:${z}},${r(shot.start)});tl.to('#vwrap',{scale:${r(z + 0.03)},duration:${r(shot.end - shot.start - 0.04)},ease:'none'},${r(shot.start)});`);
  });

  const css = `
${fontFaces()}
#vwrap{transform-origin:50% ${faceY}%}
#kscrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(6,8,20,.62) 0%,rgba(6,8,20,.30) 30%,rgba(6,8,20,.14) 55%,rgba(6,8,20,.34) 72%,rgba(6,8,20,.66) 100%)}
#kflash{position:absolute;inset:0;opacity:0;background:linear-gradient(160deg,#ff2d55,#e3000f)}
.kg{position:absolute;display:flex;flex-direction:column;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.55),0 8px 40px rgba(0,0,0,.55)}
.kg.low{left:90px;width:900px;top:${Math.round(1430 * sy)}px;align-items:center;text-align:center}
.kg.top{left:90px;width:900px;bottom:${Math.round(layout.H - 600 * sy)}px;align-items:center;text-align:center}
.kg.topL{left:70px;width:640px;bottom:${Math.round(layout.H - 610 * sy)}px;align-items:flex-start}
.kg.topR{right:70px;width:640px;bottom:${Math.round(layout.H - 610 * sy)}px;align-items:flex-end;text-align:right}
.kg.lowL{left:70px;width:640px;top:${Math.round(1410 * sy)}px;align-items:flex-start}
.kg.lowR{right:70px;width:640px;top:${Math.round(1410 * sy)}px;align-items:flex-end;text-align:right}
.kgi{display:flex;flex-direction:column;align-items:inherit}
.kl{white-space:nowrap;line-height:.94}
.kg.topL .kl.odd,.kg.lowL .kl.odd{margin-left:46px}.kg.topR .kl.odd,.kg.lowR .kl.odd{margin-right:46px}
.kw{display:inline-block;will-change:transform,opacity,filter}
.kw + .kw{margin-left:.2em}
.kw.s{font-family:'Poppins',sans-serif;font-weight:600;font-size:84px;letter-spacing:-.05em}
.kw.h{font-family:'Poppins',sans-serif;font-weight:700;letter-spacing:-.055em;line-height:1}
.kw.i{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:96px;letter-spacing:-.02em;padding-right:.08em}
.kcard{position:absolute;inset:0;background:#fdfdfd;display:flex;align-items:center;justify-content:center;padding-bottom:${Math.round(240 * sy)}px}
.kblock{display:flex;flex-direction:column;align-items:flex-start;color:#0b0b0d}
.kglyph{align-self:center;font-family:'Poppins',sans-serif;font-weight:700;font-size:250px;line-height:1;color:#e3000f;margin-bottom:26px}
.kw.cs{font-family:'Poppins',sans-serif;font-weight:600;font-size:80px;letter-spacing:-.05em}
.kw.cb{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;letter-spacing:-.03em;line-height:1.02;padding-right:.08em}
`;
  return { anchors: {}, html: html.join("\n"), css, js: js.join("\n"), counters: [], cues, shots, groups };
}
