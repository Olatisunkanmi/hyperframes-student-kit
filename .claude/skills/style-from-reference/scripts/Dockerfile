# Server image for the style-from-reference analyzer. Build context: this scripts/ folder.
#   docker build -t style-ref .
#   docker run --rm -v "$PWD/runs:/runs" style-ref analyze "<url>" --out /runs/<slug>
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV STYLE_REF_HOME=/opt/style-ref \
    STYLE_REF_TORCH=cpu \
    PIP_NO_CACHE_DIR=1

WORKDIR /opt/style-from-reference
COPY . .

# WARM=1 bakes the models into the image (works offline); WARM=0 downloads them on first use.
ARG WARM=1
RUN if [ "$WARM" = "1" ]; then bash ./setup.sh; else bash ./setup.sh --no-models; fi

ENTRYPOINT ["bash", "/opt/style-from-reference/style-ref"]
