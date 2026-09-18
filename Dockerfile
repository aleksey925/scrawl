# pin stage to host arch (it then runs once) because go cross-compiles
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build

ARG TARGETOS
ARG TARGETARCH
ARG VERSION=0.0.0

ENV CGO_ENABLED=0

WORKDIR /build

COPY . .

RUN GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build \
      -mod=vendor -trimpath -buildvcs=false \
      -ldflags "-X main.revision=${VERSION} -s -w" \
      -o /build/scrawl .

#------------------------------------------------------------------------------

FROM alpine:3.22

LABEL org.opencontainers.image.source="https://github.com/aleksey925/scrawl"
LABEL org.opencontainers.image.description="markdown notes server"
LABEL org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache ca-certificates tzdata wget mailcap git && \
    adduser -s /bin/sh -D -u 1001 app && \
    mkdir -p /notes /data && chown app:app /notes /data && chmod 1777 /data

ENV TZ=UTC

COPY --from=build /build/scrawl /opt/app/scrawl

WORKDIR /opt/app
USER app

EXPOSE 7272

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --spider --tries=1 http://127.0.0.1:7272/ping || exit 1

ENTRYPOINT ["/opt/app/scrawl"]
