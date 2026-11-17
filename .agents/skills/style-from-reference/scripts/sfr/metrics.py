"""Pure metrics shared by the stages. Standard library only, so the unit tests run anywhere."""
from bisect import bisect_left
from statistics import mean, median, pstdev


def parse_scene_scores(text: str) -> list[tuple[float, float]]:
    """Parse ffmpeg `metadata=print` output into (time, scene_score) pairs."""
    pairs = []
    current = None
    for line in text.splitlines():
        if "pts_time:" in line:
            current = float(line.split("pts_time:")[1].split()[0])
        elif line.startswith("lavfi.scene_score=") and current is not None:
            pairs.append((current, float(line.split("=")[1])))
            current = None
    return pairs


def pick_cuts(scores: list[tuple[float, float]], threshold: float, min_gap: float = 0.2) -> list[float]:
    """Times whose scene score reaches the threshold, at least min_gap apart."""
    cuts: list[float] = []
    for time, score in scores:
        if score >= threshold and time > 0 and (not cuts or time - cuts[-1] >= min_gap):
            cuts = [*cuts, round(time, 3)]
    return cuts


def shot_stats(cuts: list[float], duration: float) -> dict:
    """Shot list and pacing numbers from cut times."""
    bounds = [0.0, *[c for c in cuts if 0 < c < duration], duration]
    shots = [
        {"start": round(a, 3), "end": round(b, 3), "length": round(b - a, 3)}
        for a, b in zip(bounds, bounds[1:])
    ]
    lengths = [s["length"] for s in shots]
    return {
        "shots": shots,
        "shot_count": len(shots),
        "mean_shot": round(mean(lengths), 2),
        "median_shot": round(median(lengths), 2),
        "shortest_shot": round(min(lengths), 2),
        "longest_shot": round(max(lengths), 2),
        "cuts_per_10s": round(len(cuts) / duration * 10, 2) if duration else 0.0,
        "cuts_in_first_3s": len([c for c in cuts if c <= 3.0]),
    }


def is_near(time: float, sorted_times: list[float], tolerance: float) -> bool:
    """True when any value in sorted_times lies within tolerance of time."""
    index = bisect_left(sorted_times, time)
    neighbours = sorted_times[max(0, index - 1) : index + 1]
    return any(abs(time - other) <= tolerance for other in neighbours)


def on_beat_ratio(cuts: list[float], beats: list[float], tolerance: float = 0.08) -> dict:
    """Share of cuts landing on a beat, with the share random cuts would reach for comparison."""
    if not cuts or len(beats) < 2:
        return {"ratio": None, "chance": None, "cuts": len(cuts)}
    hits = len([c for c in cuts if is_near(c, beats, tolerance)])
    interval = median([b - a for a, b in zip(beats, beats[1:])])
    return {
        "ratio": round(hits / len(cuts), 2),
        "chance": round(min(1.0, 2 * tolerance / interval), 2),
        "cuts": len(cuts),
    }


def stand_out(onset: dict, onsets: list[dict], window: float = 4.0) -> float:
    """How many times stronger an onset is than the typical onset around it.

    A steady drum pattern scores near 1 because its neighbours are just as loud. A one-off sound scores high.
    """
    nearby = [o["strength"] for o in onsets if 0.15 < abs(o["t"] - onset["t"]) <= window]
    pool = nearby if len(nearby) >= 3 else [o["strength"] for o in onsets]
    return onset["strength"] / (median(pool) or 1e-6)


def drop_echoes(found: list[dict], gap: float = 0.15) -> list[dict]:
    """One sound often yields two onsets a few frames apart; keep the stronger of each close pair."""
    kept: list[dict] = []
    for item in sorted(found, key=lambda s: s["t"]):
        if kept and item["t"] - kept[-1]["t"] <= gap:
            kept = [*kept[:-1], max(kept[-1], item, key=lambda s: s["stands_out"])]
        else:
            kept = [*kept, item]
    return kept


def classify_onsets(onsets: list[dict], beats: list[float], cuts: list[float], limit: int = 40) -> list[dict]:
    """Pick likely sound-effect moments: onsets that stand out from the music around them.

    onsets: [{"t": seconds, "strength": float}]. Returns the strongest `limit`, in time order.
    Beat position is reported but never used to reject: on sparse music the beat tracker locks onto
    the effects themselves, so "on the beat" says nothing there. The 1.75 threshold was set against
    renders with known cue lists: it finds about 6 in 10 effects with almost no false detections.
    Quiet effects under speech and soft whooshes are what it misses.
    """
    if not onsets:
        return []
    strengths = [o["strength"] for o in onsets]
    centre, deviation, typical = mean(strengths), pstdev(strengths) or 1.0, median(strengths)
    scored = [
        {
            "t": round(o["t"], 3),
            "z": round((o["strength"] - centre) / deviation, 2),
            "stands_out": round(stand_out(o, onsets), 1),
            "near_cut": is_near(o["t"], cuts, 0.12),
            "on_beat": is_near(o["t"], beats, 0.07),
            "loud": o["strength"] >= typical,
        }
        for o in onsets
    ]
    likely = [s for s in scored if s["stands_out"] >= 1.75 or (s["near_cut"] and s["loud"])]
    strongest = sorted(drop_echoes(likely), key=lambda s: s["stands_out"], reverse=True)[:limit]
    return [{k: v for k, v in s.items() if k != "loud"} for s in sorted(strongest, key=lambda s: s["t"])]


def speech_stats(words: list[dict], duration: float, hook_seconds: float = 3.0) -> dict:
    """Delivery pace and the opening line from word timestamps."""
    if not words:
        return {"word_count": 0, "words_per_second": 0.0, "first_word_at": None, "hook_text": ""}
    spoken = sum(w["end"] - w["start"] for w in words)
    gaps = [b["start"] - a["end"] for a, b in zip(words, words[1:])]
    span = words[-1]["end"] - words[0]["start"]
    return {
        "word_count": len(words),
        "words_per_second": round(len(words) / span, 2) if span > 0 else 0.0,
        "first_word_at": round(words[0]["start"], 2),
        "hook_text": " ".join(w["text"] for w in words if w["start"] < hook_seconds),
        "longest_pause": round(max(gaps), 2) if gaps else 0.0,
        "talk_share": round(min(1.0, spoken / duration), 2) if duration else 0.0,
    }


def spread(items: list, limit: int) -> list:
    """At most `limit` items, evenly spaced across the list."""
    if len(items) <= limit:
        return list(items)
    step = (len(items) - 1) / (limit - 1)
    return [items[round(i * step)] for i in range(limit)]


def frame_plan(shots: list[dict], cuts: list[float], duration: float, fps: float) -> dict:
    """Which timestamps to pull frames from, grouped by the question each group answers."""
    last = max(0.0, duration - 0.1)
    clamp = lambda t: round(min(max(t, 0.0), last), 3)  # noqa: E731
    mids = [clamp((s["start"] + s["end"]) / 2) for s in shots]
    step = 1 / fps if fps else 1 / 30
    around = {
        f"cut-{i + 1:02d}": [clamp(cut + k * step) for k in range(-3, 3)]
        for i, cut in enumerate(spread(cuts, 6))
    }
    return {
        "shots": spread(mids, 48),
        "hook": [clamp(i * 0.25) for i in range(12) if i * 0.25 <= last],
        "even": [clamp(duration * (i + 0.5) / 24) for i in range(24)],
        **around,
    }
