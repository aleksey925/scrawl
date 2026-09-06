# version info derived from git: the exact tag if we sit on one, branch otherwise
TAG=$(shell git describe --tags --abbrev=0 --exact-match 2>/dev/null)
BRANCH=$(if $(TAG),$(TAG),$(shell git rev-parse --abbrev-ref HEAD 2>/dev/null))
HASH=$(shell git rev-parse --short=7 HEAD 2>/dev/null)
# git formats the timestamp itself, `date -u -r` means different things on BSD and GNU
TIMESTAMP=$(shell git log -1 --format=%cd --date=format-local:%Y%m%dT%H%M%S HEAD 2>/dev/null)
GIT_REV=$(shell printf "%s-%s-%s" "$(BRANCH)" "$(HASH)" "$(TIMESTAMP)")
REV=$(if $(filter --,$(GIT_REV)),latest,$(GIT_REV))

BINARY=scrawl
DOCKER_IMAGE=ghcr.io/aleksey925/scrawl

.PHONY: all build run test race_test lint fmt coverage docker docker-push version clean help

all: test build

build:
	go build -trimpath -ldflags "-X main.revision=$(REV) -s -w" -o .bin/$(BINARY) .

run:
	go run . --root=./examples/data --listen=:8080 --auth.disabled --dbg

test:
	go clean -testcache
	go test -race -coverprofile=coverage.out ./...
	grep -v "_mock.go" coverage.out | grep -v mocks > coverage_no_mocks.out
	go tool cover -func=coverage_no_mocks.out
	rm coverage.out coverage_no_mocks.out

race_test:
	go test -race -timeout=120s -count 1 ./...

lint:
	golangci-lint run ./...

fmt:
	gofmt -s -w .

coverage:
	go test -timeout=120s -covermode=count -coverprofile=coverage.out.tmp ./...
	grep -v "_mock.go" coverage.out.tmp | grep -v mocks > coverage.out
	rm -f coverage.out.tmp
	go tool cover -html=coverage.out -o coverage.html
	@echo "coverage report: coverage.html"

# .dockerignore drops .git, so the version has to be handed to the build the
# same way CI does it, otherwise the image reports itself as "local-<date>"
DOCKER_ARGS=--build-arg CI=make --build-arg GIT_BRANCH=$(BRANCH) --build-arg GITHUB_SHA=$(HASH)

docker:
	DOCKER_BUILDKIT=1 docker build $(DOCKER_ARGS) -t $(DOCKER_IMAGE):$(BRANCH) .

# multi-arch image for Synology NAS, amd64 and arm64 in one manifest
docker-push:
	docker buildx build --platform linux/amd64,linux/arm64 $(DOCKER_ARGS) -t $(DOCKER_IMAGE):$(BRANCH) --push .

version:
	@echo "branch: $(BRANCH), hash: $(HASH), timestamp: $(TIMESTAMP)"
	@echo "revision: $(REV)"

clean:
	rm -rf .bin coverage.out coverage.out.tmp coverage_no_mocks.out coverage.html

help:
	@echo "targets:"
	@echo "  build       - build the binary into .bin/$(BINARY)"
	@echo "  run         - run against ./examples/data with auth disabled and debug logs"
	@echo "  test        - tests with race detector plus a coverage summary"
	@echo "  race_test   - race tests only"
	@echo "  lint        - golangci-lint run ./..."
	@echo "  fmt         - gofmt -s -w ."
	@echo "  coverage    - html coverage report"
	@echo "  docker      - local docker image"
	@echo "  docker-push - multi-arch image (amd64, arm64)"
	@echo "  version     - show the computed revision"
