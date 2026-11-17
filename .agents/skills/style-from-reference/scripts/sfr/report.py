"""Final stage: merge every stage's result into analysis.json and a short REPORT.md."""
from collections import Counter
from pathlib import Path

from sfr.common import load, stage_out, write_json

STAGES = ("fetch", "cuts", "frames", "audio", "stems", "transcript", "rhythm", "tags")
BLIND_SPOTS = [
    "Fonts are not identified. Name them from the frames, then confirm against a font you can license.",
    "Jump cuts and punch-ins on the same framing score low. `soft_changes` lists where to look.",
    "Sound-effect timing is the dependable part: against renders with known cue lists it found about 6 in 10 "
    "effects with almost no false detections. Quiet effects under speech and soft whooshes are missed.",
    "Sound-effect type labels are weak (about 1 in 3 right in the same check). Decide the type from the "
    "picture event first, then pitch_hz, bass_share and ring_s, and treat the label as a hint.",
    "Whether the music feels right is a listening judgement. Nothing here replaces the user's ears.",
]


def value(number, unit: str = "") -> str:
    return "not measured" if number is None else f"{number}{unit}"


def picture_lines(data: dict) -> list[str]:
    source, cuts, frames = data["fetch"], data["cuts"], data["frames"]
    post = source.get("post", {})
    sound = " / ".join(str(post[key]) for key in ("track", "artist") if post.get(key)) or "not named by the platform"
    swatches = ", ".join(f"{c['hex']} {round(c['share'] * 100)}%" for c in frames.get("palette", [])[:6])
    return [
        "## Picture",
        f"- Format: {source['width']}x{source['height']}, {source['fps']} fps, {source['duration']} s",
        f"- Sound named on the post: {sound}",
        f"- Shots: {cuts['shot_count']} (median {cuts['median_shot']} s, shortest {cuts['shortest_shot']} s, "
        f"longest {cuts['longest_shot']} s)",
        f"- Cuts per 10 s: {cuts['cuts_per_10s']}; cuts in the first 3 s: {cuts['cuts_in_first_3s']}",
        f"- Softer changes to inspect (possible jump cuts or punch-ins): {len(cuts.get('soft_changes', []))}",
        f"- Dominant colours: {swatches or 'not measured'}",
    ]


def effects_line(rhythm: dict, tags: dict, effects: list[dict], kinds: Counter) -> str:
    candidates = len(rhythm.get("sfx_candidates", []))
    if "effects" not in tags:
        return f"- Sound-effect candidates: {candidates} moments found, not named (tagging did not run)"
    named = ", ".join(f"{name} x{count}" for name, count in kinds.most_common()) or "none"
    return f"- Likely sound effects: {len(effects)} of {candidates} candidate moments ({named})"


def sound_lines(data: dict) -> list[str]:
    audio, stems, rhythm, tags = data["audio"], data["stems"], data["rhythm"], data["tags"]
    speech = data["transcript"].get("stats", {})
    beat = rhythm.get("cuts_on_beat", {})
    effects = [e for e in tags.get("effects", []) if e["is_effect"]]
    kinds = Counter(e["kit_sfx"] or e["label"] for e in effects)
    music = tags.get("music", {})
    top = lambda key: ", ".join(f"{m['label']} ({m['p']})" for m in music.get(key, [])) or "not measured"  # noqa: E731
    return [
        "## Sound",
        f"- Mix loudness: {value(audio.get('mix', {}).get('lufs'), ' LUFS')}",
        f"- Music and effects relative to the voice: {value(stems.get('bed_relative_to_voice_lu'), ' LU')}",
        f"- Ducking under speech: {value(rhythm.get('duck_db'), ' dB')}",
        f"- Tempo: {value(rhythm.get('bpm'), ' BPM')} (steadiness {value(rhythm.get('beat_steadiness'))}, "
        f"measured on the {rhythm.get('measured_on', 'n/a')})",
        f"- Cuts landing on a beat: {value(beat.get('ratio'))} (random cuts would reach {value(beat.get('chance'))})",
        f"- Music genre guess: {top('genre')}",
        f"- Music mood guess: {top('mood')}",
        effects_line(rhythm, tags, effects, kinds),
        "## Speech",
        f"- Pace: {value(speech.get('words_per_second'), ' words/s')}; first word at "
        f"{value(speech.get('first_word_at'), ' s')}; longest pause {value(speech.get('longest_pause'), ' s')}",
        f"- Opening line: \"{speech.get('hook_text', '')}\"",
    ]


def build_report(data: dict, out: Path) -> str:
    skipped = [f"- {name}: {data[name]['skipped']}" for name in STAGES if "skipped" in data[name]]
    failed = [f"- {name}: {text}" for name, text in data["errors"].items()]
    sheets = [f"- `{Path(s['sheet']).relative_to(out)}`: {s['shows']}" for s in data["frames"].get("sheets", [])]
    return "\n".join([
        "# Reference analysis",
        f"Source: {data['fetch']['input']}",
        *picture_lines(data),
        *sound_lines(data),
        "## Contact sheets to read",
        *sheets,
        "## Not run or failed",
        *(skipped + failed or ["- every stage ran"]),
        "## What this analysis cannot tell you",
        *[f"- {line}" for line in BLIND_SPOTS],
        "",
    ])


def main() -> None:
    out = stage_out()
    data = {name: load(out, name) for name in STAGES}
    data = {**data, "errors": load(out, "errors"), "options": load(out, "options")}
    write_json(out / "analysis.json", data)
    (out / "REPORT.md").write_text(build_report(data, out), encoding="utf-8")


if __name__ == "__main__":
    main()
