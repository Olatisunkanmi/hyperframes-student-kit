// Unit tests for the motion primitives and the free-form variety/budget review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRIMITIVES, blurOut, blurRise, blurSlide, pop, pulse, shake, slam, sweep } from "../scripts/lib/motion/primitives.mjs";
import { freeform, validateSpec } from "../scripts/lib/freeform/freeform.mjs";
import { renderMotionReview, reviewSpec, RULES } from "../scripts/lib/freeform/review.mjs";

// 80 words, 0.5 s each (0.4 s spoken), so a scene's length in seconds is easy to reason about.
function makeCtx(count = 80) {
  const words = Array.from({ length: count }, (_, i) => ({ text: `w${i}`, start: +(i * 0.5).toFixed(2), end: +(i * 0.5 + 0.4).toFixed(2), part: "body" }));
  const dir = mkdtempSync(join(tmpdir(), "motion-"));
  return { words, w: (i) => words[i], dir, TOTAL: count * 0.5 + 3, OUTRO: 2.5, layout: { W: 1080, H: 1920 }, r: (n) => +n.toFixed(2) };
}
const card = (c, a, b) => ({ type: "card", from: c.w(a), to: c.w(b), hero: [] });
const build = (c, spec) => { try { return freeform(c, spec); } finally { rmSync(c.dir, { recursive: true, force: true }); } };
const rules = (out) => out.review.map((f) => f.rule);

test("primitives emit deterministic timeline code with the documented shapes", () => {
  assert.equal(blurRise("#a", 1.5), "tl.fromTo('#a',{opacity:0,filter:'blur(16px)',y:16,scale:1.06},{opacity:1,filter:'blur(0px)',y:0,scale:1,duration:.26,ease:'power2.out'},1.5);");
  assert.match(blurSlide("#a", 2, "y:14"), /\{opacity:0,y:14,filter:'blur\(12px\)'\}/);
  assert.match(blurOut("#a", 3), /tl\.to\('#a'.*tl\.set\('#a',\{opacity:0\},3\.1\)/);
  assert.match(sweep("#a", 1), /\{scaleX:0\},\{scaleX:1,duration:\.32,ease:'power3\.out'\}/);
  assert.match(sweep("#a", 1, { axis: "y", duration: 0.55, ease: "expo.out" }), /scaleY:0.*duration:\.55,ease:'expo\.out'/);
  assert.match(slam("#a", 1), /scale:1\.7/);
  assert.match(pop("#a", 1, { scale: 0.4, rotation: -12 }), /rotation:-12.*rotation:0/);
  assert.ok(!pop("#a", 1).includes("rotation"), "rotation is optional");
});

test("a stack exit is hard-killed at the end of its clip, so it is within 0.05 s of whatever starts next", () => {
  const c = makeCtx();
  const out = build(c, { scenes: [] });
  const clips = new Map([...out.html.matchAll(/id="kg-(\d+)"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)"/g)].map((m) => [m[1], +m[2] + +m[3]]));
  const kills = [...out.js.matchAll(/tl\.set\('#kgi-(\d+)',\{opacity:0\},([\d.]+)\)/g)];
  assert.ok(kills.length > 5);
  for (const [, n, t] of kills) assert.ok(Math.abs(+t - clips.get(n)) <= 0.011, `stack ${n}: hide at ${t}, clip ends ${clips.get(n)}`);
});

test("without an explicit time an exit hides where its tween ends", () => {
  for (let k = 0; k < 400; k++) {
    const t = +(k * 0.0137 + 0.01).toFixed(2); // start times the engine produces (two decimals)
    const code = blurOut("#a", t);
    const end = +(t + 0.1).toFixed(3);
    assert.ok(code.endsWith(`{opacity:0},${end});`), `start ${t}: hide at ${end}`);
  }
});

test("every primitive is catalogued with a family, and none uses forever-repeats or wall-clock time", () => {
  const exported = { blurRise, blurSlide, blurOut, sweep, slam, pop, pulse, shake };
  assert.deepEqual(Object.keys(PRIMITIVES).sort(), Object.keys(exported).sort());
  for (const [name, fn] of Object.entries(exported)) {
    const code = fn("#x", 1);
    assert.ok(!/repeat:\s*-1|Date\.now|Math\.random/.test(code), `${name} is deterministic and finite`);
    assert.ok(["enter", "exit", "draw", "emphasis"].includes(PRIMITIVES[name].family));
  }
});

test("a varied, well-paced edit has no findings", () => {
  const c = makeCtx();
  const out = build(c, { scenes: [
    { ...card(c, 10, 17), in: "flash" },
    { type: "punch", from: c.w(24), to: c.w(28), word: c.w(26) },
    { type: "counter", from: c.w(36), to: c.w(44), value: { at: c.w(38), to: 40 }, in: "zoom" },
  ] });
  assert.deepEqual(out.review, []);
});

test("the same scene type twice in a row is an error, and so is a takeover too short to read", () => {
  const c = makeCtx();
  const out = build(c, { scenes: [{ ...card(c, 10, 17), in: "flash" }, { ...card(c, 24, 31), in: "zoom" }, { ...card(c, 40, 41), in: "wipe" }] });
  assert.ok(out.review.some((f) => f.rule === "repeat-scene" && f.level === "error"));
  assert.ok(out.review.some((f) => f.rule === "short-takeover" && f.level === "error"));
});

test("two takeovers entering the same way, or back to back, are warnings", () => {
  const c = makeCtx();
  const out = build(c, { scenes: [
    { type: "expand", from: c.w(10), to: c.w(17), parts: [{ at: c.w(12) }, { at: c.w(14) }] },
    { type: "chart", from: c.w(18), to: c.w(26), bars: [{ at: c.w(19), label: "a", value: 2 }, { at: c.w(22), label: "b", value: 1 }] },
  ] });
  assert.ok(rules(out).includes("repeat-transition"), "expand and chart both push in by default");
  assert.ok(rules(out).includes("crowded-takeovers"));
  assert.ok(out.review.every((f) => f.level === "warn"));
});

test("covering too much of the video, and an element that appears too late to read, are flagged", () => {
  const c = makeCtx();
  const out = build(c, { allow: ["repeat-scene", "repeat-transition", "crowded-takeovers"], scenes: [
    { ...card(c, 2, 24), in: "flash" }, { type: "chart", from: c.w(26), to: c.w(50), bars: [{ at: c.w(27), label: "a", value: 2 }, { at: c.w(49), label: "b", value: 1 }] },
  ] });
  assert.ok(rules(out).includes("takeover-share"));
  assert.ok(rules(out).includes("final-beat-hold"), "the second bar appears 0.4 s before the scene ends");
  assert.ok(!rules(out).includes("opens-on-takeover"), "a scene starting exactly at 1.0 s is not flagged");
});

test("a takeover in the first second is reported", () => {
  const c = makeCtx();
  assert.ok(rules(build(c, { scenes: [card(c, 0, 8)] })).includes("opens-on-takeover"));
});

test("allow silences exactly the named rule, and an unknown rule name fails the spec", () => {
  const c = makeCtx();
  const spec = { allow: ["repeat-scene"], scenes: [{ ...card(c, 10, 17), in: "flash" }, { ...card(c, 24, 31), in: "zoom" }] };
  assert.ok(!rules(build(c, spec)).includes("repeat-scene"));
  const d = makeCtx();
  try { assert.throws(() => validateSpec({ allow: ["repeat-sceen"], scenes: [] }, d.words), /unknown rule "repeat-sceen"/); }
  finally { rmSync(d.dir, { recursive: true, force: true }); }
  assert.ok(RULES.includes("repeat-scene"));
});

test("too many punch words, marks and hero words are flagged for the length of the video", () => {
  const c = makeCtx();
  const punches = [4, 12, 20, 28].map((i) => ({ type: "punch", from: c.w(i), to: c.w(i + 3), word: c.w(i + 1) }));
  const marks = [1, 2, 3, 4, 5].map((i) => ({ word: c.w(60 + i), style: "accent" }));
  const out = build(c, { scenes: punches, marks, hero: [60, 61, 62, 63, 64, 65].map((i) => c.w(i)), allow: ["repeat-scene"] });
  assert.deepEqual(rules(out).sort(), ["hero-density", "mark-density", "punch-count"]);
});

test("the review document lists errors and warnings, and says so when there are none", () => {
  const md = renderMotionReview(reviewSpec({ scenes: [] }, { until: 30, takeovers: new Set(), defaultIn: {} }));
  assert.match(md, /No findings/);
  const found = renderMotionReview([{ level: "error", rule: "repeat-scene", scene: 1, message: "m1" }, { level: "warn", rule: "takeover-share", scene: null, message: "m2" }]);
  assert.match(found, /## Errors\n- `repeat-scene`: m1/);
  assert.match(found, /## Warnings\n- `takeover-share`: m2/);
});

test("treatments.md documents every review rule and every primitive", () => {
  const doc = readFileSync(new URL("../.claude/skills/free-form/references/treatments.md", import.meta.url), "utf8");
  for (const rule of RULES) assert.ok(doc.includes(`\`${rule}\``), `treatments.md mentions ${rule}`);
  for (const name of Object.keys(PRIMITIVES)) assert.ok(doc.includes(name), `treatments.md mentions ${name}`);
});
