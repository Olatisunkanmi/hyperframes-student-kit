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

Takeovers accept `in`: `cut`, `flash`, `push`, `zoom`, `wipe` (defaults: card `flash`, expand and
versus `push`) and `out`: `cut` (default) or `push`. A takeover that starts in the first 0.2 s cuts in.

Slots for stacks and `list`: `low`, `top`, `topL`, `topR`, `lowL`, `lowR`.

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
- No B-roll, charts, or screen recordings. Say so in the plan when the content needs one.
- Lint reports "track too dense" warnings: one clip per stack is by design.
