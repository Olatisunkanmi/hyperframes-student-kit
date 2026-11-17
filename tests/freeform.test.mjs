// Unit tests for the free-form engine (scripts/lib/freeform/freeform.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freeform, validateSpec } from "../scripts/lib/freeform/freeform.mjs";
import { fitScale } from "../scripts/lib/freeform/data-scenes.mjs";

const TEXT = "that is only half of the job. What is an EMR? An EMR means electronic medical record. In hospital A take vitals then doctor. In hospital B vitals in the office. This is very crucial because it works.";
function makeCtx() {
  let t = 0;
  const words = TEXT.split(" ").map((text, i) => {
    const word = { text, start: +(t + 0.05).toFixed(3), end: +(t + 0.3).toFixed(3), part: i < 7 ? "hook" : "body" };
    t = word.end;
    return word;
  });
  const find = (text, from = 0) => {
    const w = words.find((x) => x.start >= from && x.text.toLowerCase().replace(/[^a-z]/g, "") === text);
    if (!w) throw new Error(`not found: ${text}`);
    return w;
  };
  const dir = mkdtempSync(join(tmpdir(), "freeform-"));
  return { words, find, dir, TOTAL: t + 3, OUTRO: 2.5, layout: { W: 1080, H: 1920 }, r: (n) => +n.toFixed(2) };
}
function fullSpec({ find }) {
  const half = find("half"), what = find("what"), emr = find("emr", what.start);
  const an = find("an", emr.start), electronic = find("electronic"), medical = find("medical"), record = find("record");
  const inA = find("in", record.start), vitalsA = find("vitals", inA.start), doctor = find("doctor");
  const inB = find("in", doctor.start), vitalsB = find("vitals", inB.start), office = find("office");
  const thisIs = find("this", office.start), crucial = find("crucial"), works = find("works");
  return {
    marks: [{ word: works, style: "highlight" }],
    scenes: [
      { type: "punch", from: find("that"), to: find("job"), word: half },
      { type: "card", from: what, to: emr, glyph: "?", hero: [emr], in: "zoom" },
      { type: "expand", from: an, to: record, parts: [{ at: electronic }, { at: medical }, { at: record }], out: "push" },
      { type: "versus", from: inA, to: office, sides: [
        { label: "Hospital A", items: [{ at: vitalsA, text: "Vitals first" }, { at: doctor, text: "Then the doctor" }] },
        { label: "Hospital B", from: inB, items: [{ at: vitalsB, text: "Vitals taken" }, { at: office, text: "In the office" }] },
      ] },
      { type: "punch", from: thisIs, to: crucial, word: crucial },
    ],
  };
}

test("builds every scene type with unique ids and non-overlapping clips per track", () => {
  const ctx = makeCtx();
  try {
    const out = freeform(ctx, fullSpec(ctx));
    const ids = [...out.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, "ids are unique");
    for (const cls of ["t-card", "t-expand", "t-versus", "kg low pn", "mk-highlight"]) assert.ok(out.html.includes(cls), `has ${cls}`);
    const byTrack = {};
    for (const m of out.html.matchAll(/data-start="([\d.]+)" data-duration="([\d.]+)" data-track-index="(\d+)"/g)) (byTrack[m[3]] ??= []).push([+m[1], +m[1] + +m[2]]);
    for (const clips of Object.values(byTrack)) clips.sort((a, b) => a[0] - b[0]).forEach((c, i) => { if (i) assert.ok(c[0] >= clips[i - 1][1] - 1e-6, "clips on one track do not overlap"); });
    assert.ok(existsSync(join(ctx.dir, out.fontDir, "poppins-700.woff2")), "fonts copied into the project");
  } finally { rmSync(ctx.dir, { recursive: true, force: true }); }
});

test("every tween targets an element that exists, and exits never sit on a clip element", () => {
  const ctx = makeCtx();
  try {
    const out = freeform(ctx, fullSpec(ctx));
    const ids = new Set([...out.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const clipIds = new Set([...out.html.matchAll(/<div id="([^"]+)" class="[^"]*\bclip\b/g)].map((m) => m[1]));
    for (const m of out.js.matchAll(/tl\.(?:to|set|fromTo)\('#([^']+)'/g)) {
      if (m[1] === "vwrap") continue;
      assert.ok(ids.has(m[1]), `tween target #${m[1]} exists`);
      if (!["kflash"].includes(m[1])) assert.ok(!clipIds.has(m[1]), `#${m[1]} is not a clip element`);
    }
  } finally { rmSync(ctx.dir, { recursive: true, force: true }); }
});

test("cues follow picture events and stay inside the video", () => {
  const ctx = makeCtx();
  try {
    const out = freeform(ctx, fullSpec(ctx));
    const kinds = out.cues.map((c) => c.sfx);
    assert.equal(kinds.filter((k) => k === "hit").length, 2, "one hit per punch");
    assert.equal(kinds.filter((k) => k === "whoosh-down").length, 1, "second side of the versus");
    assert.ok(out.cues.every((c) => c.t >= 0 && c.t <= ctx.TOTAL - ctx.OUTRO));
  } finally { rmSync(ctx.dir, { recursive: true, force: true }); }
});

test("a takeover ends the camera shot; an overlay is filmed like ordinary speech", () => {
  const ctx = makeCtx();
  try {
    const out = freeform(ctx, fullSpec(ctx));
    const starts = out.shots.map((s) => s.start);
    const versus = out.groups.find((g) => g.card === 3), after = out.groups[out.groups.indexOf(versus) + 1];
    assert.equal(after.card, 4, "the punch follows the versus");
    assert.ok(starts.includes(after.start), "a new shot starts when the takeover ends, even though an overlay follows");
    for (const g of out.groups.filter((x) => [1, 2, 3].includes(x.card))) assert.ok(!starts.includes(g.start), "no camera move is spent under a takeover");
  } finally { rmSync(ctx.dir, { recursive: true, force: true }); }
});

test("bad specs fail with the scene number", () => {
  const ctx = makeCtx();
  try {
    const { find, words } = ctx;
    const a = find("what"), b = find("emr", a.start);
    assert.throws(() => validateSpec({ scenes: [{ type: "montage", from: a, to: b }] }, words), /scene 0 .*unknown type/);
    assert.throws(() => validateSpec({ scenes: [{ type: "card", from: a, to: b, in: "spin" }] }, words), /unknown "in" transition/);
    assert.throws(() => validateSpec({ scenes: [{ type: "punch", from: a, to: b, word: find("crucial") }] }, words), /word inside the scene/);
    assert.throws(() => validateSpec({ scenes: [{ type: "list", from: a, to: b, items: [{ at: a, text: "one" }] }] }, words), /2\+ items/);
    assert.throws(() => validateSpec({ scenes: [{ type: "punch", from: a, to: b, word: b, in: "push" }] }, words), /overlay/);
    assert.throws(() => validateSpec({ scenes: [{ type: "versus", from: a, to: b, sides: [{ label: "A", items: [{ at: a, text: "x" }] }] }] }, words), /two sides/);
    assert.throws(() => validateSpec({ marks: [{ word: a, style: "glow" }] }, words), /mark 0/);
    assert.throws(() => validateSpec({ scenes: [{ type: "card", from: find("that"), to: b }] }, words), /not span both/);
    assert.throws(() => validateSpec({ scenes: [{ type: "card", from: a, to: b }, { type: "card", from: b, to: find("means") }] }, words), /overlaps/);
    assert.throws(() => validateSpec({ scenes: [{ type: "card", from: a, to: b, variant: "neon" }] }, words), /unknown variant/);
    assert.throws(() => validateSpec({ palette: { accent: undefined } }, words), /palette.accent/);
    assert.throws(() => validateSpec({ palette: { accent: "red;}" } }, words), /hex colour/);
  } finally { rmSync(ctx.dir, { recursive: true, force: true }); }
});

test("expand escapes its initial and rejects a part with nothing to show", () => {
  const ctx = makeCtx();
  try {
    const { find, words } = ctx;
    const an = find("an", find("emr").start), electronic = find("electronic"), medical = find("medical"), record = find("record");
    electronic.text = "<b>lectronic";
    const out = freeform(ctx, { scenes: [{ type: "expand", from: an, to: record, parts: [{ at: electronic }, { at: medical }] }] });
    assert.ok(out.html.includes('">&lt;</span>') && out.html.includes("b&gt;lectronic"), "the initial is escaped whole, not split inside an entity");
    medical.text = "?";
    assert.throws(() => validateSpec({ scenes: [{ type: "expand", from: an, to: record, parts: [{ at: electronic }, { at: medical }] }] }, words), /no letters/);
  } finally { rmSync(ctx.dir, { recursive: true, force: true }); }
});

function dataSpec({ find }) {
  const half = find("half"), what = find("what"), emr = find("emr", what.start);
  const an = find("an", emr.start), electronic = find("electronic"), medical = find("medical"), record = find("record");
  const inA = find("in", record.start), vitals = find("vitals", inA.start), doctor = find("doctor"), office = find("office");
  return { scenes: [
    { type: "counter", from: find("that"), to: find("job"), value: { at: half, to: 50, suffix: "%" }, label: "of the job" },
    { type: "timeline", from: an, to: record, title: "The steps", steps: [{ at: electronic, label: "Electronic" }, { at: medical, label: "Medical", caption: "the clinical part" }, { at: record, label: "Record" }] },
    { type: "chart", from: inA, to: office, bars: [{ at: vitals, label: "Hospital A", value: 12, display: "12 min" }, { at: doctor, label: "Hospital B", value: 4, display: "4 min" }] },
  ] };
}

test("counter, chart and timeline build as takeovers with valid targets, counters and cues", () => {
  const ctx = makeCtx();
  try {
    const out = freeform(ctx, dataSpec(ctx));
    for (const cls of ["t-counter", "t-timeline", "t-chart"]) assert.ok(out.html.includes(cls), `has ${cls}`);
    const ids = new Set([...out.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    assert.equal(ids.size, [...out.html.matchAll(/ id="([^"]+)"/g)].length, "ids are unique");
    for (const m of out.js.matchAll(/tl\.(?:to|set|fromTo)\('#([^']+)'/g)) if (m[1] !== "vwrap") assert.ok(ids.has(m[1]), `tween target #${m[1]} exists`);
    assert.equal(out.counters.length, 1);
    const c = out.counters[0];
    assert.ok(ids.has(c.id) && c.to === 50 && c.suffix === "%" && c.duration >= 0.4 && c.start >= 0, "counter entry matches an element the builder can fill");
    assert.ok(!out.js.includes("Math.round"), "the counting tween is left to the builder so it gets tick sound");
    assert.equal(out.cues.filter((q) => q.why.startsWith("timeline step")).length, 3);
    assert.equal(out.cues.filter((q) => q.why.startsWith("chart bar")).length, 2);
    assert.ok(out.cues.every((q) => q.t >= 0 && q.t <= ctx.TOTAL - ctx.OUTRO));
    const starts = out.shots.map((s) => s.start);
    for (const g of out.groups.filter((x) => x.card !== null && x.start > 0.2)) assert.ok(!starts.includes(g.start), "no camera move is spent under a data takeover");
    const chart = out.html.match(/id="cb-\d+-0" style="width:([\d.]+)%/)[1];
    assert.equal(chart, "72.0", "the largest bar takes the full track share");
  } finally { rmSync(ctx.dir, { recursive: true, force: true }); }
});

test("data scenes escape their text and reject specs that cannot be drawn", () => {
  const ctx = makeCtx();
  try {
    const { find, words } = ctx;
    const a = find("what"), b = find("emr", a.start), an = find("an", b.start), rec = find("record");
    const out = freeform(ctx, { scenes: [{ type: "chart", from: an, to: rec, bars: [{ at: find("electronic"), label: "<img src=x>", value: 3 }, { at: find("medical"), label: "B & C", value: 1 }] }] });
    assert.ok(out.html.includes("&lt;img src=x&gt;") && out.html.includes("B &amp; C"));
    const bad = (scene, re) => assert.throws(() => validateSpec({ scenes: [{ from: a, to: b, ...scene }] }, words), re);
    bad({ type: "counter", value: { at: a, to: 3.5 } }, /whole numbers/);
    bad({ type: "counter", value: { at: a, from: 9, to: 4 } }, /whole numbers/);
    bad({ type: "counter", value: { at: find("crucial"), to: 4 } }, /inside the scene/);
    bad({ type: "counter", value: { at: a, to: 4, suffix: "percent" } }, /value.suffix/);
    bad({ type: "chart", bars: [{ at: a, label: "one", value: 1 }] }, /2 to 6 bars/);
    bad({ type: "chart", bars: [{ at: a, label: "one", value: 0 }, { at: b, label: "two", value: 0 }] }, /above 0/);
    bad({ type: "chart", bars: [{ at: a, label: "x".repeat(30), value: 1 }, { at: b, label: "two", value: 1 }] }, /label must be/);
    bad({ type: "timeline", steps: [{ at: b, label: "late" }, { at: a, label: "early" }] }, /spoken order/);
    bad({ type: "timeline", in: "spin", steps: [{ at: a, label: "x" }, { at: b, label: "y" }] }, /unknown "in"/);
  } finally { rmSync(ctx.dir, { recursive: true, force: true }); }
});

test("tall data scenes scale down to fit 4:5 and are left at full size on 9:16", () => {
  assert.equal(fitScale(900, 1920), 1);
  assert.ok(fitScale(1400, 1350) < 0.85, "a dense chart shrinks on the shorter frame");
  assert.ok(fitScale(1400, 1920) === 1, "the same chart needs no scaling on 9:16");
  const bars = (c) => ["that", "is", "only", "half", "of", "the"].slice(0, 6).map((w, i) => ({ at: c.find(w), label: `Bar ${i}`, value: 10 - i }));
  const build = (H) => {
    const ctx = makeCtx(); ctx.layout = { W: 1080, H };
    try { return freeform(ctx, { scenes: [{ type: "chart", from: ctx.find("that"), to: ctx.find("the"), title: "Six bars", bars: bars(ctx) }] }).html; }
    finally { rmSync(ctx.dir, { recursive: true, force: true }); }
  };
  assert.match(build(1350), /class="dwrap" style="transform:scale\(0\.\d+\)"/);
  assert.ok(!/class="dwrap" style=/.test(build(1920)));
});

test("the skill documents every scene type and transition the engine accepts", () => {
  const doc = readFileSync(new URL("../.claude/skills/free-form/references/treatments.md", import.meta.url), "utf8");
  for (const name of ["card", "expand", "versus", "list", "punch", "counter", "chart", "timeline", "flash", "push", "zoom", "wipe", "underline", "highlight", "whip"]) assert.ok(doc.includes(`\`${name}\``), `treatments.md mentions ${name}`);
});
