"""Download every model once, so later runs work offline (useful when baking a server image)."""
from demucs.pretrained import get_model
from faster_whisper import WhisperModel
from transformers import ClapModel, ClapProcessor

from sfr.common import log
from sfr.tags import CLAP_MODEL
from sfr.transcript import DEFAULT_WHISPER


def main() -> None:
    log("warm: demucs htdemucs (stem separation)")
    get_model("htdemucs")
    log(f"warm: {CLAP_MODEL} (sound tagging)")
    ClapModel.from_pretrained(CLAP_MODEL, use_safetensors=True)
    ClapProcessor.from_pretrained(CLAP_MODEL)
    log(f"warm: whisper {DEFAULT_WHISPER} (transcript)")
    WhisperModel(DEFAULT_WHISPER, device="cpu", compute_type="int8")
    log("warm: all models cached")


if __name__ == "__main__":
    main()
