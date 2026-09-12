# version info derived from git: the exact tag if we sit on one, branch otherwise
TAG=$(shell git describe --tags --abbrev=0 --exact-match 2>/dev/null)
BRANCH=$(if $(TAG),$(TAG),$(shell git rev-parse --abbrev-ref HEAD 2>/dev/null))
HASH=$(shell git rev-parse --short=7 HEAD 2>/dev/null)
# git formats the timestamp itself, `date -u -r` means different things on BSD and GNU
TIMESTAMP=$(shell git log -1 --format=%cd --date=format-local:%Y%m%dT%H%M%S HEAD 2>/dev/null)
GIT_REV=$(shell printf "%s-%s-%s" "$(BRANCH)" "$(HASH)" "$(TIMESTAMP)")
REV=$(if $(filter --,$(GIT_REV)),latest,$(GIT_REV))

VERSION ?= $(REV)
LDFLAGS = -ldflags "-s -w -X main.revision=$(VERSION)"
BUILD_FLAGS = -trimpath

BINARY ?= scrawl
DIST_DIR = dist
BIN_PATH = $(DIST_DIR)/$(BINARY)
DOCKER_IMAGE = ghcr.io/aleksey925/scrawl

.PHONY: deps build snapshot install run e2e test race cover lint docker docker-push version clean help

deps:
	@go mod tidy
	@go mod vendor

build:
	@CGO_ENABLED=0 go build $(BUILD_FLAGS) $(LDFLAGS) -o $(BIN_PATH) .

snapshot:
	@goreleaser release --snapshot --skip=publish --clean

install: build
	@mkdir -p ~/.local/bin
	@rm -f ~/.local/bin/$(BINARY)
	@cp $(BIN_PATH) ~/.local/bin/

run:
	@go run . --root=./examples/data --listen=:8080 --auth.disabled --history=off --dbg

e2e: build
	@cd e2e && npx playwright test

test:
	@go test -timeout 3m ./...

race:
	@go test -race -timeout 3m ./...

cover:
	go test -race -covermode=atomic -coverprofile=coverage.out.tmp -timeout 3m ./...
	grep -v "_mock.go" coverage.out.tmp | grep -v mocks > coverage.out
	@rm -f coverage.out.tmp
	go tool cover -func=coverage.out | tail -1
	@echo "---"
	@echo "HTML report: go tool cover -html=coverage.out"

lint:
	@prek run --all-files

# .dockerignore drops .git, so the version has to be handed to the build the
# same way CI does it, otherwise the image reports itself as "local-<date>"
DOCKER_ARGS=--build-arg CI=make --build-arg GIT_BRANCH=$(BRANCH) --build-arg GITHUB_SHA=$(HASH)

docker:
	@DOCKER_BUILDKIT=1 docker build $(DOCKER_ARGS) -t $(DOCKER_IMAGE):$(BRANCH) .

# multi-arch image for Synology NAS, amd64 and arm64 in one manifest
docker-push:
	@docker buildx build --platform linux/amd64,linux/arm64 $(DOCKER_ARGS) -t $(DOCKER_IMAGE):$(BRANCH) --push .

version:
	@echo "branch: $(BRANCH), hash: $(HASH), timestamp: $(TIMESTAMP)"
	@echo "revision: $(REV)"

clean:
	@rm -rf $(DIST_DIR) coverage.out coverage.out.tmp

help:
	@echo "targets:"
	@echo "  deps        - go mod tidy and go mod vendor"
	@echo "  build       - build the binary into $(BIN_PATH)"
	@echo "  snapshot    - local goreleaser build of every platform archive"
	@echo "  install     - build and copy the binary to ~/.local/bin"
	@echo "  run         - run against ./examples/data with auth disabled and debug logs"
	@echo "  e2e         - playwright browser suite against a freshly built binary"
	@echo "  test        - tests"
	@echo "  race        - tests with the race detector"
	@echo "  cover       - race tests plus a coverage summary"
	@echo "  lint        - prek run --all-files"
	@echo "  docker      - local docker image"
	@echo "  docker-push - multi-arch image (amd64, arm64)"
	@echo "  version     - show the computed revision"
	@echo "  clean       - remove build and coverage output"
