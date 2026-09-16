VERSION ?= 0.0.0
LDFLAGS = -ldflags "-s -w -X main.revision=$(VERSION)"
BUILD_FLAGS = -trimpath

BINARY ?= scrawl
DIST_DIR = dist
BIN_PATH = $(DIST_DIR)/$(BINARY)

DOCKER_ARGS=--build-arg VERSION=$(VERSION)
DOCKER_IMAGE = ghcr.io/aleksey925/scrawl

.PHONY: deps ui build snapshot install run e2e test race cover lint img

deps:
	@go mod tidy
	@go mod vendor

# the bundle this writes into server/assets/app is committed, so that go build,
# go install and the docker image need neither node nor the network
ui:
	@cd web && npm ci --no-audit --no-fund && npm run build

build:
	@CGO_ENABLED=0 go build $(BUILD_FLAGS) $(LDFLAGS) -o $(BIN_PATH) .

snapshot:
	@goreleaser release --snapshot --skip=publish --clean

install: build
	@mkdir -p ~/.local/bin
	@rm -f ~/.local/bin/$(BINARY)
	@cp $(BIN_PATH) ~/.local/bin/

run:
	@go run . --root=./examples/data --project=notes --listen=:7272 --auth.disabled --history=off --dbg

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

img:
	@DOCKER_BUILDKIT=1 docker build $(DOCKER_ARGS) -t $(DOCKER_IMAGE):$(VERSION) .
