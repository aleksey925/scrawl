VERSION ?= 0.0.0
LDFLAGS = -ldflags "-s -w -X main.revision=$(VERSION)"
BUILD_FLAGS = -trimpath

BINARY ?= scrawl
DIST_DIR = dist
BIN_PATH = $(DIST_DIR)/$(BINARY)

TEST_TIMEOUT = 20m

DOCKER_ARGS=--build-arg VERSION=$(VERSION)
DOCKER_IMAGE = ghcr.io/aleksey925/scrawl

.PHONY: deps ui formatter plantuml gzassets build snapshot run readme-promo e2e test test-gzassets race cover lint img

img:
	@DOCKER_BUILDKIT=1 docker build $(DOCKER_ARGS) -t $(DOCKER_IMAGE):$(VERSION) .

deps:
	@go mod tidy
	@go mod vendor
	@cd web && npm i --no-audit --no-fund
	@cd internal/format/js && npm i --no-audit --no-fund
	@cd internal/plantuml/js && npm i --no-audit --no-fund
	@cd e2e && npm i --no-audit --no-fund && npx playwright install chromium firefox

ui:
	@cd web && npm i --no-audit --no-fund && npm run build

# prettier and QuickJS in one module, committed for the reason the bundle is.
# The plugins are the ones the command line loads for a markdown file, so a
# note formatted here does not come back changed from `prettier --write`.
PRETTIER = internal/format/js/node_modules/prettier
PRETTIER_PLUGINS = markdown yaml babel estree typescript postcss html graphql glimmer

JAVY_FLAGS = -J event-loop=y -J javy-stream-io=y -J text-encoding=y

formatter:
	@cd internal/format/js && npm i --no-audit --no-fund
	@cat $(PRETTIER)/standalone.js $(PRETTIER_PLUGINS:%=$(PRETTIER)/plugins/%.js) internal/format/js/main.js > internal/format/js/bundle.js
	@javy build $(JAVY_FLAGS) -o internal/format/prettier.wasm internal/format/js/bundle.js
	@rm internal/format/js/bundle.js

# the PlantUML engine of the server in QuickJS, and the libraries an include
# loads, both from the PlantUML commit the browser's engine was built from.
plantuml:
	@cd internal/plantuml/js && npm i --no-audit --no-fund
	@cd internal/plantuml/js && node build.mjs bundle.js
	@javy build $(JAVY_FLAGS) -C source=omitted -o internal/plantuml/engine.wasm internal/plantuml/js/bundle.js
	@rm internal/plantuml/js/bundle.js
	@cd internal/plantuml/js && node library.mjs ../library

# the assets above compressed, for a binary that embeds them that way. They
# are not committed: a build without the gzassets tag embeds the files as they
# are, which is what keeps go install working
gzassets:
	@go run ./internal/gzassets/pack

build: gzassets
	@CGO_ENABLED=0 go build $(BUILD_FLAGS) -tags gzassets $(LDFLAGS) -o $(BIN_PATH) ./cmd/scrawl

snapshot:
	@goreleaser release --snapshot --skip=publish --clean

run:
	go run ./cmd/scrawl serve \
    --space.dir=./examples/data \
    --space.name=notes \
    --listen=:7272 \
    --history=off \
    --auth.users=admin:admin \
    --auth.tokens=bot:demo-token:ro \
    --auth.secret-file=/tmp/scrawl-session.key

readme-promo:
	@go build -o $(DIST_DIR)/readme-promo/scrawl ./cmd/scrawl
	@node scripts/readme-shots/shoot.js $(DIST_DIR)/readme-promo/scrawl docs/screenshots

e2e: build
	@cd e2e && npx playwright test

test:
	@go test -timeout $(TEST_TIMEOUT) ./...

test-gzassets: gzassets
	@go test -tags gzassets -timeout $(TEST_TIMEOUT) ./...

race:
	@go test -race -timeout $(TEST_TIMEOUT) ./...

cover:
	go test -race -covermode=atomic -coverprofile=coverage.out.tmp -timeout $(TEST_TIMEOUT) ./...
	grep -v "_mock.go" coverage.out.tmp | grep -v mocks > coverage.out
	@rm -f coverage.out.tmp
	go tool cover -func=coverage.out | tail -1
	@echo "---"
	@echo "HTML report: go tool cover -html=coverage.out"

lint:
	@prek run --all-files
