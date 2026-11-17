"""Stage 7: tempo, beat grid, whether cuts land on beats, likely sound-effect moments, and ducking."""
import librosa
import numpy as np

from sfr.common import load, log, save, stage_out
from sfr.metrics import classify_onsets, on_beat_ratio

SAMPLE_RATE = 22050
AUDIBLE_DB = -45.0


def level_db(samples: np.ndarray) -> np.ndarray:
    return 20 * np.log10(librosa.feature.rms(y=samples)[0] + 1e-9)


def speaking_mask(frame_times: np.ndarray, words: list[dict]) -> np.ndarray:
    """True for frames inside a spoken word (padded slightly so breaths between words count)."""
    mask = np.zeros(len(frame_times), dtype=bool)
    for word in words:
        mask = mask | ((frame_times >= word["start"] - 0.15) & (frame_times <= word["end"] + 0.15))
    return mask


def ducking(db: np.ndarray, frame_times: np.ndarray, words: list[dict]) -> float | None:
    """How many dB the bed drops under speech. Positive = it ducks. None when it cannot be told."""
    audible = db > AUDIBLE_DB
    speaking = speaking_mask(frame_times, words)
    under, between = db[audible & speaking], db[audible & ~speaking]
    if len(under) < 20 or len(between) < 20:
        return None
    return round(float(np.median(between) - np.median(under)), 1)


def detect_onsets(samples: np.ndarray) -> list[dict]:
    envelope = librosa.onset.onset_strength(y=samples, sr=SAMPLE_RATE)
    frames = librosa.onset.onset_detect(onset_envelope=envelope, sr=SAMPLE_RATE)
    times = librosa.frames_to_time(frames, sr=SAMPLE_RATE)
    return [{"t": float(t), "strength": float(envelope[f])} for t, f in zip(times, frames)]


def describe(samples: np.ndarray, time: float) -> dict:
    """Measured character of one sound: pitch of the energy it adds, share of bass, and how long it rings.

    Rough guide: a high bass share is an impact, a long ring is a chime or riser, short and bright is a
    tick or pop. Music bleeds into these numbers, so read them together with the picture.
    """
    start = max(0, int((time - 0.02) * SAMPLE_RATE))
    before = samples[max(0, start - int(0.25 * SAMPLE_RATE)) : max(1, start - int(0.03 * SAMPLE_RATE))]
    spectrum = np.abs(librosa.stft(samples[start : start + int(0.12 * SAMPLE_RATE)], n_fft=1024, hop_length=256)).mean(axis=1)
    floor = np.abs(librosa.stft(before, n_fft=1024, hop_length=256)).mean(axis=1) if len(before) > 1024 else 0
    added = np.maximum(spectrum - floor, 0)
    freqs = librosa.fft_frequencies(sr=SAMPLE_RATE, n_fft=1024)
    total = float(added.sum()) + 1e-9
    level = librosa.feature.rms(y=samples[start : start + int(0.8 * SAMPLE_RATE)], frame_length=512, hop_length=128)[0]
    peak = int(level.argmax())
    faded = np.where(level[peak:] < level[peak] * 0.25)[0]
    return {
        "pitch_hz": int(round(float((added * freqs).sum()) / total, -1)),
        "bass_share": round(float(added[freqs < 200].sum()) / total, 2),
        "ring_s": round(float(faded[0] * 128 / SAMPLE_RATE), 2) if len(faded) else 0.8,
    }


def main() -> None:
    out = stage_out()
    audio, stems = load(out, "audio"), load(out, "stems")
    if "wav" not in audio:
        save(out, "rhythm", {"skipped": "no soundtrack to analyse"})
        return
    separated = "no_vocals" in stems
    log("rhythm: tempo, beats and sound-effect moments")
    samples, _ = librosa.load(stems.get("no_vocals", audio["wav"]), sr=SAMPLE_RATE, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=samples, sr=SAMPLE_RATE)
    beats = [round(float(t), 3) for t in librosa.frames_to_time(beat_frames, sr=SAMPLE_RATE)]
    gaps = np.diff(beats) if len(beats) > 2 else np.array([])
    db = level_db(samples)
    frame_times = librosa.frames_to_time(np.arange(len(db)), sr=SAMPLE_RATE)
    cuts = load(out, "cuts").get("cuts", [])
    words = load(out, "transcript").get("words", [])
    save(out, "rhythm", {
        "measured_on": "music and effects stem" if separated else "full mix (voice included, less reliable)",
        "bpm": round(float(np.atleast_1d(tempo)[0]), 1),
        "beats": beats,
        # 1.0 = perfectly even beats. Low values mean no steady music, so treat bpm as unreliable.
        "beat_steadiness": round(float(1 - gaps.std() / gaps.mean()), 2) if len(gaps) else None,
        "bed_audible_share": round(float((db > AUDIBLE_DB).mean()), 2),
        "cuts_on_beat": on_beat_ratio(cuts, beats),
        "duck_db": ducking(db, frame_times, words) if separated and words else None,
        "sfx_candidates": [
            {**found, **describe(samples, found["t"])}
            for found in classify_onsets(detect_onsets(samples), beats, cuts)
        ],
    })


if __name__ == "__main__":
    main()
