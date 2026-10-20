VERSION ?= 0.0.0
LDFLAGS = -ldflags "-s -w -X main.revision=$(VERSION)"
BUILD_FLAGS = -trimpath

BINARY ?= scrawl
DIST_DIR = dist
BIN_PATH = $(DIST_DIR)/$(BINARY)

DOCKER_ARGS=--build-arg VERSION=$(VERSION)
DOCKER_IMAGE = ghcr.io/aleksey925/scrawl

.PHONY: deps ui formatter gzassets build snapshot run e2e test test-gzassets race cover lint img

img:
	@DOCKER_BUILDKIT=1 docker build $(DOCKER_ARGS) -t $(DOCKER_IMAGE):$(VERSION) .

deps:
	@go mod tidy
	@go mod vendor
	@cd web && npm i --no-audit --no-fund
	@cd format/js && npm i --no-audit --no-fund
	@cd e2e && npm i --no-audit --no-fund && npx playwright install chromium firefox

# the bundle this writes into server/assets/app, and the stylesheet and scripts
# of the command line pages in page/assets, are committed, so that go build,
# go install and the docker image need neither node nor the network
ui:
	@cd web && npm i --no-audit --no-fund && npm run build

# prettier and QuickJS in one module, committed for the reason the bundle is.
# The plugins are the ones the command line loads for a markdown file, so a
# note formatted here does not come back changed from `prettier --write`.
PRETTIER = format/js/node_modules/prettier
PRETTIER_PLUGINS = markdown yaml babel estree typescript postcss html graphql glimmer

formatter:
	@cd format/js && npm i --no-audit --no-fund
	@cat $(PRETTIER)/standalone.js $(PRETTIER_PLUGINS:%=$(PRETTIER)/plugins/%.js) format/js/main.js > format/js/bundle.js
	@javy build -J event-loop=y -J javy-stream-io=y -J text-encoding=y -o format/prettier.wasm format/js/bundle.js
	@rm format/js/bundle.js

# the assets above compressed, for a binary that embeds them that way. They
# are not committed: a build without the gzassets tag embeds the files as they
# are, which is what keeps go install working
gzassets:
	@go run ./gzassets/pack

build: gzassets
	@CGO_ENABLED=0 go build $(BUILD_FLAGS) -tags gzassets $(LDFLAGS) -o $(BIN_PATH) .

snapshot:
	@goreleaser release --snapshot --skip=publish --clean

run:
	@go run . serve --space.dir=./examples/data --space.name=notes --listen=:7272 --auth.disabled --history=off --dbg

e2e: build
	@cd e2e && npx playwright test

test:
	@go test -timeout 3m ./...

test-gzassets: gzassets
	@go test -tags gzassets -timeout 3m ./...

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
