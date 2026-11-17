"""Stage 6: word-level transcript of the reference, in the kit's common transcript format."""
import librosa
from faster_whisper import WhisperModel

from sfr.common import load, log, save, stage_out
from sfr.metrics import speech_stats

DEFAULT_WHISPER = "small"


def transcribe(audio_path: str, model_name: str, device: str) -> tuple[list[dict], str]:
    model = WhisperModel(model_name, device=device, compute_type="float16" if device == "cuda" else "int8")
    # Decode here and hand over samples: faster-whisper's own file reader breaks on newer PyAV releases.
    samples, _ = librosa.load(audio_path, sr=16000, mono=True)
    segments, info = model.transcribe(samples, word_timestamps=True, vad_filter=True)
    words = [
        {"text": word.word.strip(), "start": round(word.start, 3), "end": round(word.end, 3), "type": "word"}
        for segment in segments
        for word in (segment.words or [])
        if word.word.strip()
    ]
    return words, info.language


def main() -> None:
    out = stage_out()
    audio, stems, options = load(out, "audio"), load(out, "stems"), load(out, "options")
    if "wav" not in audio:
        save(out, "transcript", {"skipped": "no soundtrack to transcribe"})
        return
    # The isolated voice transcribes more reliably than voice under music.
    source = stems.get("vocals", audio["wav"])
    device = "cuda" if options.get("device") == "cuda" else "cpu"
    log("transcript: transcribing the voice")
    words, language = transcribe(source, options.get("whisper", DEFAULT_WHISPER), device)
    duration = load(out, "fetch")["duration"]
    save(out, "transcript", {
        "text": " ".join(w["text"] for w in words),
        "language": language,
        "audio_duration_secs": duration,
        "words": words,
        "stats": speech_stats(words, duration),
    })


if __name__ == "__main__":
    main()
