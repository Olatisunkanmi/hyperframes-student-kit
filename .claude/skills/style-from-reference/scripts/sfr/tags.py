"""Stage 8: name the sounds. CLAP compares audio against text labels, so no training is needed.

Labels are scored on the music-and-effects stem. Effects still sit on top of music there, so a tag is a
lead to check against the picture, never a certainty.
"""
import librosa
import numpy as np
import torch
from transformers import ClapModel, ClapProcessor

from sfr.common import load, log, save, stage_out

# The fused checkpoint is the one published as safetensors, which loads without the pickle risk.
CLAP_MODEL = "laion/clap-htsat-fused"
SAMPLE_RATE = 48000
NO_EFFECT = "music playing with no sound effect"
# label -> the closest sound in scripts/sound-design.mjs (None = nothing equivalent in the pack)
SFX_LABELS = {
    "a whoosh or swoosh transition sound": "whoosh-up",
    "a deep bass impact hit or boom": "hit",
    "a short pop or bubble sound": "pop",
    "a click or tick sound": "tick",
    "a bell ding or notification chime": "ping",
    "a rising riser build-up sound": "riser",
    "a camera shutter sound": None,
    "a cash register ka-ching sound": None,
    "keyboard typing": None,
    "a glitch or digital static sound": None,
    "a record scratch": None,
    NO_EFFECT: None,
}
GENRES = ["lo-fi hip hop", "trap or hip hop beat", "upbeat pop", "electronic dance music", "cinematic orchestral",
          "ambient pad", "acoustic guitar", "piano", "rock", "phonk", "corporate upbeat background music"]
MOODS = ["calm and relaxed", "energetic and driving", "tense and suspenseful", "happy and playful",
         "sad and emotional", "dark and aggressive", "inspiring and uplifting"]


def scores(model: ClapModel, processor: ClapProcessor, clips: list[np.ndarray], labels: list[str]) -> np.ndarray:
    """Probability of each label for each clip (rows = clips)."""
    prompts = [f"the sound of {label}" for label in labels]
    inputs = processor(text=prompts, audio=clips, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True)
    with torch.no_grad():
        result = model(**inputs)
    return result.logits_per_audio.softmax(dim=-1).numpy()


def window(samples: np.ndarray, start: float, length: float) -> np.ndarray:
    begin = max(0, int(start * SAMPLE_RATE))
    clip = samples[begin : begin + int(length * SAMPLE_RATE)]
    return np.pad(clip, (0, max(0, SAMPLE_RATE // 2 - len(clip))))


def ranked(labels: list[str], probabilities: np.ndarray, top: int = 3) -> list[dict]:
    order = np.argsort(probabilities)[::-1][:top]
    return [{"label": labels[i], "p": round(float(probabilities[i]), 2)} for i in order]


def tag_music(model, processor, samples: np.ndarray) -> dict:
    seconds = len(samples) / SAMPLE_RATE
    clips = [window(samples, seconds * share, 10.0) for share in (0.1, 0.45, 0.8)]
    return {
        "genre": ranked(GENRES, scores(model, processor, clips, GENRES).mean(axis=0)),
        "mood": ranked(MOODS, scores(model, processor, clips, MOODS).mean(axis=0)),
    }


def tag_effects(model, processor, samples: np.ndarray, candidates: list[dict]) -> list[dict]:
    if not candidates:
        return []
    labels = list(SFX_LABELS)
    clips = [window(samples, c["t"] - 0.15, 1.0) for c in candidates]
    table = scores(model, processor, clips, labels)
    tagged = []
    for candidate, row in zip(candidates, table):
        best = labels[int(row.argmax())]
        tagged.append({
            **candidate,
            "label": best,
            "p": round(float(row.max()), 2),
            "kit_sfx": SFX_LABELS[best],
            "is_effect": best != NO_EFFECT,
        })
    return tagged


def main() -> None:
    out = stage_out()
    audio, stems, rhythm = load(out, "audio"), load(out, "stems"), load(out, "rhythm")
    if "wav" not in audio:
        save(out, "tags", {"skipped": "no soundtrack to tag"})
        return
    log("tags: naming the music and each likely sound effect")
    samples, _ = librosa.load(stems.get("no_vocals", audio["wav"]), sr=SAMPLE_RATE, mono=True)
    model = ClapModel.from_pretrained(CLAP_MODEL, use_safetensors=True).eval()
    processor = ClapProcessor.from_pretrained(CLAP_MODEL)
    save(out, "tags", {
        "model": CLAP_MODEL,
        "music": tag_music(model, processor, samples),
        "effects": tag_effects(model, processor, samples, rhythm.get("sfx_candidates", [])),
    })


if __name__ == "__main__":
    main()
