# Treatments (engine API)

Engine: `scripts/lib/freeform/freeform.mjs`. Base look and fonts: `style-library/03-kinetic-serif`.
A project's `beats.mjs` returns `freeform(ctx, spec)`. Every word reference is a word object from
`ctx.find(text, afterSeconds, part)`; find them in spoken order so repeated words resolve correctly.

```js
import { freeform } from "../../scripts/lib/freeform/freeform.mjs";

export default function beats(ctx) {
  const { find, H } = ctx;
  const what = find("what", H, "body"), emr = find("emr", what.start, "body");
  return freeform(ctx, {
    palette: { accent: "#e3000f" },
    hero: [],
    marks: [],
    scenes: [{ type: "card", from: what, to: emr, glyph: "?", hero: [emr] }],
  });
}
```

`video.json` needs `"captions": false, "lowerThird": false, "camera": false`.

## Spec

| Field | Meaning |
| --- | --- |
| `palette` | `{ paper, ink, fg, accent }`. Defaults: near-white, near-black, white, red |
| `hero` | Words shown large on their own line inside ordinary stacks |
| `marks` | `[{ word, style }]`: `underline` (accent line sweeps under), `highlight` (accent block sweeps behind), `accent` (word in the accent colour) |
| `serif`, `sans` | Force a word's type style. Small words are italic serif by default |
| `breaks` | Words that must start a new stack |
| `scenes` | Spoken ranges with their own treatment (below). Must not overlap |
| `camera` | `{ zoom: [1.15, 1.38, 1.24, 1.32], moves: ["jump", "whip"], minShot: 1.6, maxShot: 4.2, faceY: 54 }` |
| `roles` | `"auto"`, or `{ numbers, negations, names }` (each `true`/`false`; `names` may also be a list of words from `ctx.find`). Caption emphasis by what a word is, see below |
| `allow` | Rule names from the motion review (below) this edit breaks on purpose. Give the reason in `PLAN.md` |

Camera `moves` cycle per shot: `jump` is a hard change of framing, `whip` adds a 0.2 s blur on the change.
A takeover ends the shot; overlays do not.

Everything not inside a scene becomes caption stacks: 2 to 5 words that blur in on their spoken times
and rotate through six positions around the speaker.

## Scenes

Each scene has `type`, `from`, `to` (first and last spoken word, inclusive).

| Type | Kind | Fields | What it shows |
| --- | --- | --- | --- |
| `card` | takeover | `glyph?`, `hero: [word]`, `variant?: "paper" \| "ink" \| "accent"` | The spoken words on a full screen: small sans lines, hero word large in italic serif, one glyph |
| `expand` | takeover | `parts: [{ at: word }]` (2+), `variant?` (default `ink`) | Lead-in words small; each part's word on its own row with a large accent initial, revealed as spoken |
| `versus` | takeover | `sides: [{ label, items }, { label, from: word, items }]`, items `[{ at: word, text }]` | Side one fills the screen; when `sides[1].from` is spoken it halves and side two pushes in under a "vs" badge |
| `list` | overlay | `items: [{ at, text }]` (2+), `title?`, `slot?` | Numbered points appear beside the speaker as spoken |
| `punch` | overlay | `word` | The scene's other words small; `word` slams in at full width with an underline sweep |
| `counter` | takeover | `value: { at: word, to, from?, prefix?, suffix? }`, `label?`, `title?`, `variant?` | One big whole number counts up as `at` is spoken, then pulses on landing. Tick sound and landing ping come from the builder |
| `chart` | takeover | `bars: [{ at: word, label, value, display? }]` (2 to 6), `title?`, `variant?` | Horizontal bars grow as each is spoken, lengths proportional to `value`, largest in the accent colour. `display` is the printed value ("12 min") |
| `timeline` | takeover | `steps: [{ at: word, label, caption? }]` (2 to 5), `title?`, `variant?` | Numbered steps appear as spoken; a line draws from each step to the next |

Data scene limits: counters are whole numbers (a decimal goes in a `card`, or a chart `display`). Text
lengths are validated: bar label 24, step label 22, step caption 36, counter label 40, title 26 characters.
Tall content (6 bars, 5 steps) scales down to fit shorter formats such as 4:5. Defaults: `counter` zooms in on ink, `chart` and `timeline` push in on paper. Use a data scene only for a
number, comparison or sequence the speaker actually states; do not invent figures.

Takeovers accept `in`: `cut`, `flash`, `push`, `zoom`, `wipe` (defaults: card `flash`, expand and
versus `push`) and `out`: `cut` (default) or `push`. A takeover that starts in the first 0.2 s cuts in.

Slots for stacks and `list`: `low`, `top`, `topL`, `topR`, `lowL`, `lowR`.

## Caption roles

Without `roles`, every caption word is styled alike apart from `hero`, `serif`, `sans` and `marks`. With
`roles: "auto"`, words are styled by what they are, in caption stacks only (takeover and punch scenes have their own treatment):

| Role | Detected | Style |
| --- | --- | --- |
| `number` | digits, `$40`, number words (`thirty`, `hundred`), `percent`; `one` only inside a quantity (`one hundred`, `twenty one`), never as a pronoun | accent colour and a small pulse as it is said |
| `negation` | `not`, `never`, `no`, `without`, contractions (`can't`, `don't`) | bold uppercase and a short shake |
| `name` | acronyms (`EMR`), CamelCase products (`ClickUp`), capitalised words mid-sentence | accent underline sweeps under it |

A word the spec already marks (`marks`) or makes a `hero` keeps that styling. Switch one role off with
`roles: { negations: false }`; add words the detector misses with `roles: { names: [find("ola")] }`.
Names are guessed from capitals, and transcripts capitalise unevenly: check the stills, and pass `names: false` plus an explicit list when the guess is wrong.
Use `roles: "auto"` by default for new edits. Too many role words dilute each other: the `role-density` rule warns past about 1 per 3 s.

## Motion review (variety and budget, enforced)

Every `freeform()` call checks the spec against the budget table in `editorial-intuition.md` and returns the
findings. `build-video` prints them at the compose stage and writes `review/motion-review.md`. Errors fail the
stage and block `--stages render`; warnings are for you to read, fix or keep on purpose.

| Rule | Level | Fires when |
| --- | --- | --- |
| `repeat-scene` | error | The same scene type twice in a row |
| `short-takeover` | error | A takeover is on screen under 1.2 s |
| `repeat-transition` | warn | Two takeovers in a row enter the same way |
| `crowded-takeovers` | warn | Under 1 s of speaker between two takeovers |
| `takeover-share` | warn | Takeovers cover over 35% of the video |
| `takeover-count` | warn | More than about 6 takeovers per 60 s |
| `opens-on-takeover` | warn | A takeover covers the speaker in the first second |
| `final-beat-hold` | warn | The last list item, bar, step or part appears under 0.9 s before its scene ends |
| `punch-count` | warn | More than 3 punch words per 60 s |
| `mark-density`, `hero-density` | warn | More than 1 mark per 12 s or 1 hero word per 10 s |
| `role-density` | warn | More than about 1 role-styled caption word per 3 s |

To keep a rule broken on purpose (a deliberate callback repeating a transition, for example), list it in
`allow` and record why in `PLAN.md`. Limits live in `scripts/lib/freeform/review.mjs`.

## Motion primitives

Entrances, exits, sweeps, slams and pops are shared recipes in `scripts/lib/motion/primitives.mjs`
(`blurRise`, `blurSlide`, `blurOut`, `sweep`, `slam`, `pop`, `pulse`, `shake`). Use them in a new scene instead of hand-writing
the tween, so timing and easing stay consistent across scenes.

## Sound cues the engine adds

| Event | Sound | Gain |
| --- | --- | --- |
| Takeover in | `whoosh-up` | -12 |
| Takeover out to the speaker | `tick` | -10 |
| `expand` part, `list` item, `versus` item | `tick` | -10 |
| `versus` second side | `whoosh-down` | -13 |
| `punch` word | `hit` | -18 |

Build with `--sfx` to mount them. Add `--music` only with a track the user has licensed or approved.

## Limits

- Tuned on 1080x1920 with a centred speaker. 4:5 is scaled from those numbers; check it on stills.
- Long words: a hero word is fitted to its slot, but list and versus items are not. Keep items to four
  words and check the stills.
- While a takeover with authored text (`versus`, `list`) is on screen the spoken words are not captioned.
- No B-roll, screen recordings, line or pie charts, or maps (`chart` is horizontal bars only). Say so in the plan when the content needs one.
- Like `versus` and `list`, data scenes show authored text, so the spoken words are not captioned while they are on screen.
- Lint reports "track too dense" warnings: one clip per stack is by design.
