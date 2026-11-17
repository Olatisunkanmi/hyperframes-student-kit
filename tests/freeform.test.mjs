// Unit tests for the free-form engine (scripts/lib/freeform/freeform.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freeform, validateSpec } from "../scripts/lib/freeform/freeform.mjs";

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

test("the skill documents every scene type and transition the engine accepts", () => {
  const doc = readFileSync(new URL("../.claude/skills/free-form/references/treatments.md", import.meta.url), "utf8");
  for (const name of ["card", "expand", "versus", "list", "punch", "flash", "push", "zoom", "wipe", "underline", "highlight", "whip"]) assert.ok(doc.includes(`\`${name}\``), `treatments.md mentions ${name}`);
});
