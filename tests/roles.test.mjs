// Unit tests for caption emphasis roles (scripts/lib/freeform/roles.mjs) and their use in the free-form engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyWords, isName, isNegation, isNumber, resolveRoles, validateRoles } from "../scripts/lib/freeform/roles.mjs";
import { freeform, validateSpec } from "../scripts/lib/freeform/freeform.mjs";
import { PRIMITIVES, pulse, shake } from "../scripts/lib/motion/primitives.mjs";

const SENTENCE = "We saved 37 percent but it is not about ClickUp. Never use the API without a plan. I think Nigeria matters.";
function makeCtx(text = SENTENCE) {
  let t = 0;
  const words = text.split(" ").map((w) => { const word = { text: w, start: +(t + 0.05).toFixed(3), end: +(t + 0.35).toFixed(3), part: "body" }; t += 0.4; return word; });
  const find = (text2, from = 0) => words.find((x) => x.start >= from && x.text.toLowerCase().replace(/[^a-z0-9']/g, "") === text2.toLowerCase());
  return { words, find, dir: mkdtempSync(join(tmpdir(), "roles-")), TOTAL: t + 3, OUTRO: 2.5, layout: { W: 1080, H: 1920 }, r: (n) => +n.toFixed(2) };
}
const build = (ctx, spec) => { try { return freeform(ctx, spec); } finally { rmSync(ctx.dir, { recursive: true, force: true }); } };
const names = (ctx, roles, styled) => [...classifyWords(ctx.words, roles, styled)].map(([w, role]) => `${w.text}:${role}`);

test("numbers, number words and percent are numbers; ordinary words are not", () => {
  for (const t of ["37", "$40", "3.5x", "thirty", "Hundred", "percent,"]) assert.ok(isNumber(t), t);
  for (const t of ["only", "one's", "none", "stone"]) assert.ok(!isNumber(t) || t === "one's" === false, t);
  assert.ok(!isNumber("only") && !isNumber("stone"));
});

test("the pronoun one is not a number, but one inside a quantity is", () => {
  const w = (text) => ({ text });
  assert.ok(!isNumber("one", w("another"), w("agent")), "another one");
  assert.ok(!isNumber("One,", w("the"), w("of")));
  assert.ok(isNumber("one", w("is"), w("hundred")), "one hundred");
  assert.ok(isNumber("one", w("twenty"), w("day")), "twenty one");
  assert.ok(isNumber("one", w("about"), w("percent")), "one percent");
  const ctx = makeCtx("Then I have another one. We saved one hundred.");
  const got = names(ctx, "auto");
  assert.ok(!got.some((x) => x.startsWith("one.")), "the pronoun is left alone");
  assert.ok(got.includes("one:number") && got.includes("hundred.:number"));
  rmSync(ctx.dir, { recursive: true, force: true });
});

test("negations include contractions, typographic apostrophes and trailing punctuation", () => {
  for (const t of ["not", "Never", "can’t", "don't", "without,", "nothing."]) assert.ok(isNegation(t), t);
  for (const t of ["note", "knot", "cannot's", "now"]) assert.ok(!isNegation(t), t);
});

test("acronyms, CamelCase products and mid-sentence capitals are names; sentence starts and I are not", () => {
  const w = (text) => ({ text });
  assert.ok(isName("EMR"));
  assert.ok(isName("API,"));
  assert.ok(isName("ClickUp"));
  assert.ok(isName("Nigeria", w("in")));
  assert.ok(!isName("Nigeria", w("done.")), "a capital after a full stop is just a sentence start");
  assert.ok(!isName("Nigeria"), "the first word of the video is a sentence start");
  assert.ok(!isName("I", w("and")) && !isName("I'm", w("and")));
  assert.ok(!isName("a"));
});

test("classifyWords labels the sentence, and explicit styling wins", () => {
  const ctx = makeCtx();
  const got = names(ctx, "auto");
  for (const expected of ["37:number", "percent:number", "not:negation", "ClickUp.:name", "Never:negation", "API:name", "without:negation", "Nigeria:name"]) assert.ok(got.includes(expected), expected);
  assert.ok(!got.some((x) => x.startsWith("I:") || x.startsWith("We:") || x.startsWith("matters")));
  const styled = names(ctx, "auto", new Set([ctx.find("37")]));
  assert.ok(!styled.includes("37:number"), "a marked or hero word is left alone");
  try { rmSync(ctx.dir, { recursive: true, force: true }); } catch {}
});

test("roles can be switched off individually, and explicit names are added", () => {
  const ctx = makeCtx();
  const r = resolveRoles({ negations: false, names: [ctx.find("matters")] });
  assert.deepEqual([r.numbers, r.negations, r.names, r.extraNames.length], [true, false, true, 1]);
  assert.ok(!names(ctx, { negations: false }).some((x) => x.endsWith(":negation")));
  assert.ok(names(ctx, { names: [ctx.find("matters")], numbers: false }).includes("matters.:name"));
  assert.deepEqual(resolveRoles(undefined), { numbers: false, negations: false, names: false, extraNames: [] });
  assert.deepEqual(names(ctx, undefined), []);
  rmSync(ctx.dir, { recursive: true, force: true });
});

test("bad roles specs fail with a message that says what to use", () => {
  const ctx = makeCtx();
  const inWords = (w) => ctx.words.includes(w);
  assert.throws(() => validateRoles("everything", inWords), /must be "auto" or an object/);
  assert.throws(() => validateRoles({ colours: true }, inWords), /unknown key "colours"/);
  assert.throws(() => validateRoles({ numbers: "yes" }, inWords), /numbers must be true or false/);
  assert.throws(() => validateRoles({ names: [{ text: "stray" }] }, inWords), /list of words from ctx.find/);
  assert.doesNotThrow(() => validateRoles("auto", inWords));
  assert.doesNotThrow(() => validateRoles({ names: [ctx.find("matters")] }, inWords));
  assert.throws(() => validateSpec({ roles: 5 }, ctx.words), /roles/);
  rmSync(ctx.dir, { recursive: true, force: true });
});

test("the engine styles roles in caption stacks and leaves everything alone when roles are off", () => {
  const on = build(makeCtx(), { roles: "auto" });
  assert.match(on.html, /class="kw [a-z]+ r-neg"/, "a negation gets the r-neg class");
  assert.match(on.html, /class="kw [a-z]+ mk-accent"[^>]*>37</, "a number takes the accent colour");
  assert.match(on.html, /mk-underline[^>]*>API<i class="mk"/, "an acronym gets an underline sweep");
  assert.ok(on.js.includes("{scale:1.14,"), "a number pulses");
  assert.ok(/\{x:-9,duration:\.06/.test(on.js), "a negation shakes");
  const off = build(makeCtx(), {});
  assert.ok(!off.html.includes("r-neg") && !off.js.includes("scale:1.14") && !off.js.includes("{x:-9"));
});

test("an explicit mark beats a role, and every tween still targets an element that exists", () => {
  const ctx = makeCtx();
  const out = freeform(ctx, { roles: "auto", marks: [{ word: ctx.find("api"), style: "highlight" }] });
  const ids = new Set([...out.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  for (const m of out.js.matchAll(/tl\.(?:to|set|fromTo)\('#([^']+)'/g)) if (m[1] !== "vwrap") assert.ok(ids.has(m[1]), `#${m[1]} exists`);
  assert.match(out.html, /mk-highlight[^>]*>API</);
  assert.ok(!/mk-underline[^>]*>API</.test(out.html));
  rmSync(ctx.dir, { recursive: true, force: true });
});

test("role words inside takeover and punch scenes are not restyled", () => {
  const ctx = makeCtx();
  const a = ctx.find("we"), b = ctx.find("percent");
  const out = freeform(ctx, { roles: "auto", scenes: [{ type: "card", from: a, to: b, hero: [], in: "flash" }] });
  assert.ok(!/id="fw-1"[^>]*>37<\/span>/.test(out.html) || !out.js.includes(`'#fw-1',{scale:1.14`), "no pulse on a carded number");
  rmSync(ctx.dir, { recursive: true, force: true });
});

test("too many role-styled words are flagged by the motion review", () => {
  const crowded = makeCtx("not 1 not 2 not 3 not 4 not 5 not 6 not 7 not 8 not 9 not 10 not");
  const out = build(crowded, { roles: "auto" });
  assert.ok(out.review.some((f) => f.rule === "role-density"));
  const calm = build(makeCtx("We saved 37 percent of the time on every single project we ran this year"), { roles: "auto" });
  assert.ok(!calm.review.some((f) => f.rule === "role-density"));
});

test("pulse and shake are catalogued emphasis primitives with finite, deterministic output", () => {
  assert.equal(PRIMITIVES.pulse.family, "emphasis");
  assert.equal(PRIMITIVES.shake.family, "emphasis");
  assert.equal(pulse("#a", 1), "tl.to('#a',{scale:1.14,duration:.12,ease:'power2.out'},1);tl.to('#a',{scale:1,duration:.2,ease:'power2.inOut'},1.121);");
  const code = shake("#a", 2);
  assert.equal((code.match(/tl\.to/g) ?? []).length, 4);
  assert.match(code, /\{x:0,duration:\.06,ease:'power1\.out'\},2\.183\)/, "it settles back at 0");
  const starts = [...code.matchAll(/\},([\d.]+)\);/g)].map((m) => +m[1]);
  assert.ok(starts.every((t, i) => !i || t - starts[i - 1] >= 0.06 + 0.0005), "no two shake tweens touch");
});

test("treatments.md documents roles and each role", () => {
  const doc = readFileSync(new URL("../.claude/skills/free-form/references/treatments.md", import.meta.url), "utf8");
  for (const word of ["`roles`", "number", "negation", "name", "role-density"]) assert.ok(doc.includes(word), `mentions ${word}`);
});
