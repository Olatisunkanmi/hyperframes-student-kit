// Variety and budget review for a free-form spec: the "Budget" table in
// .claude/skills/free-form/references/editorial-intuition.md, enforced in code instead of left as prose.
//
// reviewSpec(spec, { until, takeovers, defaultIn }) -> [{ level: "error" | "warn", rule, scene, message }]
//   error  a "never" rule or something that cannot be read; the build stops unless the spec lists the rule in `allow`
//   warn   a guide value that was exceeded; read it, fix it or keep it on purpose
//
// A project opts out of one rule with  allow: ["repeat-transition"]  in the spec, with the reason in PLAN.md.
//
// Rules: repeat-scene, repeat-transition, short-takeover, takeover-share, takeover-count, crowded-takeovers,
// opens-on-takeover, final-beat-hold, punch-count, mark-density, hero-density, role-density.

export const RULES = Object.freeze(["repeat-scene", "repeat-transition", "short-takeover", "takeover-share", "takeover-count", "crowded-takeovers", "opens-on-takeover", "final-beat-hold", "punch-count", "mark-density", "hero-density", "role-density"]);

export const LIMITS = Object.freeze({
  minTakeover: 1.2, // seconds: shorter cannot be read
  maxShare: 0.35, // of the runtime
  takeoversPer60: 6,
  punchPer60: 3,
  markEvery: 12, // seconds per mark
  heroEvery: 10, // seconds per hero word
  roleEvery: 3, // seconds per role-styled caption word
  minGap: 1.0, // speaker time between two takeovers
  firstSecond: 1.0, // the face owns the first second
  minHold: 0.9, // the last item to appear needs this long on screen
});

/** How many of something a video of `until` seconds may hold at `per60` per minute, never below `floor`. */
const allowance = (per60, until, floor) => Math.max(floor, Math.ceil((per60 * until) / 60));
const round = (x) => +x.toFixed(2);

/** The word that makes the scene's last element appear, or null for scenes with nothing staged. */
function lastBeat(scene) {
  const pick = { list: scene.items, chart: scene.bars, timeline: scene.steps, expand: scene.parts }[scene.type];
  if (pick?.length) return pick.at(-1).at;
  if (scene.type === "versus") return scene.sides[1].items.at(-1).at;
  if (scene.type === "counter") return scene.value.at;
  return null;
}

export function reviewSpec(spec, { until, takeovers, defaultIn, roleCount = 0 }) {
  const findings = [];
  const add = (level, rule, scene, message) => findings.push({ level, rule, scene, message });
  const scenes = (spec.scenes ?? []).map((scene, index) => ({ scene, index })).sort((a, b) => a.scene.from.start - b.scene.from.start);
  const label = ({ scene, index }) => `scene ${index} (${scene.type} at "${scene.from.text}")`;
  const seconds = ({ scene }) => scene.to.end - scene.from.start;
  const isTakeover = ({ scene }) => takeovers.has(scene.type);
  const takeoverList = scenes.filter(isTakeover);

  scenes.forEach((entry, i) => {
    const prev = scenes[i - 1];
    if (prev && prev.scene.type === entry.scene.type) add("error", "repeat-scene", entry.index, `${label(entry)} repeats the ${prev.scene.type} before it; the same scene type twice in a row reads as a template`);
    if (isTakeover(entry) && seconds(entry) < LIMITS.minTakeover) add("error", "short-takeover", entry.index, `${label(entry)} is on screen ${round(seconds(entry))}s; under ${LIMITS.minTakeover}s cannot be read`);
    if (isTakeover(entry) && entry.scene.from.start < LIMITS.firstSecond) add("warn", "opens-on-takeover", entry.index, `${label(entry)} covers the speaker in the first second; open on the face unless the hook is the graphic`);
    const beat = lastBeat(entry.scene);
    if (beat) {
      const hold = entry.scene.to.end - beat.start;
      if (hold < LIMITS.minHold) add("warn", "final-beat-hold", entry.index, `${label(entry)}: the last element appears ${round(hold)}s before the scene ends; it needs ${LIMITS.minHold}s to be read`);
    }
  });

  takeoverList.forEach((entry, i) => {
    const prev = takeoverList[i - 1];
    if (!prev) return;
    const was = prev.scene.in ?? defaultIn[prev.scene.type];
    const now = entry.scene.in ?? defaultIn[entry.scene.type];
    if (was === now) add("warn", "repeat-transition", entry.index, `${label(entry)} enters with "${now}", the same as the takeover before it`);
    const gap = entry.scene.from.start - prev.scene.to.end;
    if (gap < LIMITS.minGap) add("warn", "crowded-takeovers", entry.index, `${label(entry)} starts ${round(Math.max(0, gap))}s after the previous takeover; give the speaker ${LIMITS.minGap}s between them`);
  });

  const covered = takeoverList.reduce((sum, entry) => sum + seconds(entry), 0);
  if (until > 0 && covered / until > LIMITS.maxShare) add("warn", "takeover-share", null, `takeovers cover ${Math.round((covered / until) * 100)}% of the video; the guide is at most ${LIMITS.maxShare * 100}%, the speaker is the video`);
  const maxTakeovers = allowance(LIMITS.takeoversPer60, until, 4);
  if (takeoverList.length > maxTakeovers) add("warn", "takeover-count", null, `${takeoverList.length} takeovers in ${round(until)}s; the guide is about ${maxTakeovers} at most`);
  const punches = scenes.filter(({ scene }) => scene.type === "punch").length;
  const maxPunch = allowance(LIMITS.punchPer60, until, 3);
  if (punches > maxPunch) add("warn", "punch-count", null, `${punches} punch words; each spends attention, the guide is ${maxPunch} at most for ${round(until)}s`);
  const maxMarks = Math.max(1, Math.ceil(until / LIMITS.markEvery));
  if ((spec.marks ?? []).length > maxMarks) add("warn", "mark-density", null, `${spec.marks.length} marks; about 1 per ${LIMITS.markEvery}s (${maxMarks}) keeps them meaning something`);
  const maxHero = Math.max(1, Math.ceil(until / LIMITS.heroEvery));
  if ((spec.hero ?? []).length > maxHero) add("warn", "hero-density", null, `${spec.hero.length} hero words; about 1 per ${LIMITS.heroEvery}s (${maxHero}) is the guide`);

  const maxRoles = Math.max(2, Math.ceil(until / LIMITS.roleEvery));
  if (roleCount > maxRoles) add("warn", "role-density", null, `${roleCount} caption words get a role style; about 1 per ${LIMITS.roleEvery}s (${maxRoles}) keeps them standing out. Turn off a role (roles: { negations: false }) or use fewer`);

  const allowed = new Set(spec.allow ?? []);
  return findings.filter((f) => !allowed.has(f.rule));
}

/** Markdown for review/motion-review.md. */
export function renderMotionReview(findings) {
  if (!findings.length) return "# Motion review\n\nNo findings: variety and budget rules all pass.\n";
  const rows = (level) => findings.filter((f) => f.level === level).map((f) => `- \`${f.rule}\`: ${f.message}`);
  return ["# Motion review", "", "Fix errors before rendering. A warning is a guide value that was exceeded: fix it or keep it on purpose and say why in PLAN.md.", "",
    "## Errors", ...(rows("error").length ? rows("error") : ["None."]), "", "## Warnings", ...(rows("warn").length ? rows("warn") : ["None."]), ""].join("\n");
}
