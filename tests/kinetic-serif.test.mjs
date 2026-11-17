// Unit tests for the Kinetic Serif Mix caption engine (style-library/03-kinetic-serif/kinetic.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLines, groupWords, planShots, timeGroups } from "../style-library/03-kinetic-serif/kinetic.mjs";

const say = (text, gap = 0.05, part = "body") => {
  let t = 0;
  return text.split(" ").map((w) => {
    const pause = w.startsWith("_") ? 0.6 : gap;
    const word = { text: w.replace(/^_/, ""), start: +(t + pause).toFixed(3), end: +(t + pause + 0.25).toFixed(3), part };
    t = word.end;
    return word;
  });
};
const texts = (groups) => groups.map((g) => g.words.map((w) => w.text).join(" "));

test("groups break at sentence ends, pauses and four words", () => {
  const words = say("What is an EMR? An EMR means electronic medical record. This _is the software");
  assert.deepEqual(texts(groupWords(words)), ["What is an EMR?", "An EMR means electronic", "medical record.", "This is the software"]);
});

test("a one-word stack is folded into a neighbour", () => {
  const forward = groupWords(say("because _the same EMR"));
  assert.deepEqual(texts(forward), ["because the same EMR"]);
  const backward = groupWords(say("to work for hospital B."));
  assert.deepEqual(texts(backward), ["to work for hospital B."]);
});

test("card words form their own group and never merge with speaker stacks", () => {
  const words = say("every EMR needs to be completely integrated into the system");
  const groups = groupWords(words, { cards: [{ from: words[2], to: words[6] }] });
  assert.deepEqual(texts(groups), ["every EMR", "needs to be completely integrated", "into the system"]);
  assert.deepEqual(groups.map((g) => g.card), [null, 0, null]);
});

test("a card needs its words in spoken order", () => {
  const words = say("one two three");
  assert.throws(() => groupWords(words, { cards: [{ from: words[2], to: words[0] }] }), /spoken order/);
});

test("timed groups never overlap and stop before the outro", () => {
  const words = say("What is an EMR? An EMR means electronic medical record.");
  const until = words.at(-1).end + 0.1;
  const timed = timeGroups(groupWords(words), until);
  timed.forEach((g, i) => {
    assert.ok(g.end > g.start);
    assert.ok(g.end <= until + 1e-9);
    if (i) assert.ok(g.start >= timed[i - 1].end);
  });
});

test("words under the outro are dropped and no group runs past it", () => {
  const words = say("one two three four. five six seven eight. nine ten");
  const until = words[5].start + 0.05;
  const timed = timeGroups(groupWords(words), until);
  assert.ok(timed.length >= 1);
  assert.ok(timed.every((g) => g.start < until && g.end <= until + 1e-9 && g.end > g.start));
});

test("a lone word after a long silence is not folded back into the previous stack", () => {
  const groups = groupWords(say("to work for hospital _B."));
  assert.deepEqual(texts(groups), ["to work for hospital", "B."]);
});

test("lines: a hero word stands alone and a style change starts a new line", () => {
  const words = say("take their vitals before");
  const classOf = (w) => ({ take: "s", their: "i", vitals: "h", before: "i" })[w.text];
  const lines = buildLines(words, classOf);
  assert.deepEqual(lines.map((l) => l.words.map((w) => w.text).join(" ")), ["take", "their", "vitals", "before"]);
  assert.deepEqual(lines.map((l) => l.hero), [false, false, true, false]);
  const joined = buildLines(say("in the"), () => "i");
  assert.equal(joined.length, 1);
});

test("shots start at sentence ends, respect the minimum, and are forced at the maximum", () => {
  const words = say("a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h");
  const groups = timeGroups(groupWords(words), words.at(-1).end + 1);
  const shots = planShots(groups, words.at(-1).end + 1, 1.6, 4.2);
  assert.ok(shots.length >= 2, "a long unbroken sentence is still cut into shots");
  shots.forEach((s, i) => {
    assert.ok(s.end - s.start >= 0.8);
    if (i) assert.equal(s.start, shots[i - 1].end);
  });
  const quick = say("One. Two. Three. Four.");
  const short = planShots(timeGroups(groupWords(quick), 5), 5, 1.6, 4.2);
  assert.equal(short.length, 1, "sentences shorter than minShot do not each get a zoom jump");
});
