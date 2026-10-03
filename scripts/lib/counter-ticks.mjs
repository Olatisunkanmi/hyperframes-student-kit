// Counter-tick timing: when does a count-up animation show each new whole number?
//
// Count-up graphics must have sound. Derive the tick times from the SAME numbers the GSAP tween uses
// (start, duration, ease, from, to) so picture and sound cannot drift apart. The composition tween rounds
// the value (Math.round), so a number k first appears when the eased value reaches k - 0.5.
//
//   counterTimes({ start: 0.1, duration: 0.78, from: 0, to: 37, ease: "power2.out" })
//     -> { ticks: [{ t, value }...], landing: <time the final value is reached> }
//
// `minGap` thins ticks that would arrive closer together than the ear can separate (default 30 ms), so a
// fast 0 -> 37 roll sounds like a fast rolling counter instead of a smear.

// GSAP naming: power1 = quadratic, power2 = cubic, power3 = quartic. f maps progress -> eased value, inv is its inverse.
const out = (n) => ({ f: (p) => 1 - (1 - p) ** n, inv: (x) => 1 - (1 - x) ** (1 / n) });
const EASE = {
  none: { f: (p) => p, inv: (x) => x },
  linear: { f: (p) => p, inv: (x) => x },
  "power1.out": out(2),
  "power2.out": out(3),
  "power3.out": out(4),
  "power4.out": out(5),
};

export function counterTimes({ start, duration, from = 0, to, ease = "power2.out", minGap = 0.03 }) {
  const e = EASE[ease];
  if (!e) throw new Error(`unknown ease "${ease}" (known: ${Object.keys(EASE).join(", ")})`);
  if (!(to > from) || !(duration > 0)) throw new Error("counterTimes needs to > from and duration > 0");
  const ticks = [];
  let last = -Infinity;
  for (let k = from + 1; k <= to; k++) {
    const x = Math.min(1, Math.max(0, (k - 0.5 - from) / (to - from)));
    const t = start + e.inv(x) * duration;
    if (t - last >= minGap || k === to) { ticks.push({ t: +t.toFixed(3), value: k }); last = t; }
  }
  return { ticks, landing: +(start + duration).toFixed(3) };
}
