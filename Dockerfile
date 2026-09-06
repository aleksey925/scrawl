# build stage runs on the native arch of the builder and cross-compiles for
# TARGETARCH, so `buildx --platform linux/amd64,linux/arm64` needs no QEMU
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build

ARG TARGETOS
ARG TARGETARCH
ARG GIT_BRANCH
ARG GITHUB_SHA
ARG CI

ENV CGO_ENABLED=0

RUN apk add --no-cache git

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# .dockerignore drops .git, so the git branch is only taken when the image is
# built from a checkout that kept it
RUN \
    if [ -n "$CI" ]; then \
      version="${GIT_BRANCH}-${GITHUB_SHA:0:7}-$(date -u +%Y%m%dT%H%M%S)"; \
    elif git rev-parse --git-dir >/dev/null 2>&1; then \
      version="$(git rev-parse --abbrev-ref HEAD)-$(git log -1 --format=%h)-$(date -u +%Y%m%dT%H%M%S)"; \
    else \
      version="local-$(date -u +%Y%m%dT%H%M%S)"; \
    fi && \
    echo "version=$version" && \
    GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build \
      -trimpath -buildvcs=false \
      -ldflags "-X main.revision=${version} -s -w" \
      -o /build/mdserver .

# alpine rather than scratch: Synology's Container Manager reports container
# health from HEALTHCHECK, and a healthcheck needs a shell and an http client.
# the extra layer is ~8MB and buys /ping monitoring plus a usable exec shell.
FROM alpine:3.22

LABEL org.opencontainers.image.source="https://github.com/aleksey925/mdserver"
LABEL org.opencontainers.image.description="markdown knowledge base server"
LABEL org.opencontainers.image.licenses="MIT"

# mailcap ships /etc/mime.types, used when serving raw attachments
RUN apk add --no-cache ca-certificates tzdata wget mailcap && \
    adduser -s /bin/sh -D -u 1001 app && \
    mkdir -p /kb && chown app:app /kb

ENV TZ=UTC

COPY --from=build /build/mdserver /srv/mdserver

WORKDIR /srv
USER app

EXPOSE 8080

# /kb is the documented mount point for the knowledge base, mount it from the
# host (`-v /volume1/docs/knowledge-base:/kb`). no VOLUME on purpose: an
# anonymous volume would silently swallow writes when the mount is forgotten.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --spider --tries=1 http://127.0.0.1:8080/ping || exit 1

ENTRYPOINT ["/srv/mdserver"]
CMD ["--listen=:8080", "--root=/kb"]
