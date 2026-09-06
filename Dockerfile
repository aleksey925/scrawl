# build stage runs on the native arch of the builder and cross-compiles for
# TARGETARCH, so the slow part of `buildx --platform linux/amd64,linux/arm64`
# never runs under emulation. the final stage still does, because of its apk
# call, so a multi-arch build needs binfmt on the host (docker/setup-qemu in CI)
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

# .dockerignore drops .git, so the version arrives as a build arg: CI passes it
# from the workflow, `make docker` from the Makefile. the git branch below is
# the fallback for a build context that kept .git
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
      -o /build/scrawl .

# alpine rather than scratch: Synology's Container Manager reports container
# health from HEALTHCHECK, and a healthcheck needs a shell and an http client.
# the extra layer is ~8MB and buys /ping monitoring plus a usable exec shell.
FROM alpine:3.22

LABEL org.opencontainers.image.source="https://github.com/aleksey925/scrawl"
LABEL org.opencontainers.image.description="markdown notes server"
LABEL org.opencontainers.image.licenses="MIT"

# mailcap ships /etc/mime.types, which is where net/http finds the types its
# own small table lacks. /raw/ has its own allowlist and never consults it, but
# the embedded assets are served by http.ServeFileFS, and without it the katex
# .woff2 faces would go out as application/octet-stream.
# /data is 1777 like /tmp: a bind mounted notes directory forces `user:` in
# compose onto the uid of the host share, and that uid still has to be able to
# write the session key. the sticky bit keeps one uid from removing another's.
RUN apk add --no-cache ca-certificates tzdata wget mailcap && \
    adduser -s /bin/sh -D -u 1001 app && \
    mkdir -p /notes /data && chown app:app /notes /data && chmod 1777 /data

ENV TZ=UTC

COPY --from=build /build/scrawl /srv/scrawl

WORKDIR /srv
USER app

EXPOSE 8080

# /notes is the documented mount point for your notes, mount it from the
# host (`-v /volume1/docs/notes:/notes`). no VOLUME on purpose: an
# anonymous volume would silently swallow writes when the mount is forgotten.
# /data holds the generated session key and wants a small named volume; it is
# deliberately outside /notes, so the key never lands in the tree or in a backup.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --spider --tries=1 http://127.0.0.1:8080/ping || exit 1

# no default CMD: go-flags lets a command line argument win over the matching
# env var, so a `CMD ["--root=/notes"]` here would silently ignore ROOT from the
# compose file. --root and --listen already default to /notes and :8080 in main.go
ENTRYPOINT ["/srv/scrawl"]
