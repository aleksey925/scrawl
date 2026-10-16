package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/format"
	"github.com/aleksey925/scrawl/page"
)

// TestMain lets the format command start this test binary as its worker, the
// way the real binary starts itself.
func TestMain(m *testing.M) {
	format.RunWorkerIfAsked()
	os.Exit(m.Run())
}

// runCLI runs one command line and returns the exit code and both outputs.
func runCLI(t *testing.T, stdin string, args ...string) (int, string, string) {
	t.Helper()

	var out, errOut bytes.Buffer
	code := runCommand(args, strings.NewReader(stdin), &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestParseCommands(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		command string
		check   func(t *testing.T, cmds *commands)
	}{
		{name: "nothing", command: ""},
		{
			name: "version", args: []string{"-v"}, command: "",
			check: func(t *testing.T, cmds *commands) { assert.True(t, cmds.Version) },
		},
		{
			name: "serve with its options", args: []string{"serve", "--listen=:9000", "--auth.disabled"}, command: serveCommand,
			check: func(t *testing.T, cmds *commands) {
				assert.Equal(t, ":9000", cmds.Serve.Listen)
				assert.True(t, cmds.Serve.Auth.Disabled)
			},
		},
		{
			name: "render a file in every format", args: []string{"render", "-f", "json", "--link-ext=.html", "a.md"},
			command: renderCommand,
			check: func(t *testing.T, cmds *commands) {
				assert.Equal(t, "a.md", cmds.Render.Args.File)
				assert.Equal(t, outputJSON, cmds.Render.Format)
				assert.Equal(t, ".html", cmds.Render.LinkExt)
			},
		},
		{
			name: "render a file named like an option", args: []string{"render", "--", "-odd.md"}, command: renderCommand,
			check: func(t *testing.T, cmds *commands) { assert.Equal(t, "-odd.md", cmds.Render.Args.File) },
		},
		{
			name: "site with its options", args: []string{"site", "-o", "out", "--math", "--exclude", "drafts", "notes"},
			command: siteCommand,
			check: func(t *testing.T, cmds *commands) {
				assert.Equal(t, "out", cmds.Site.Output)
				assert.True(t, cmds.Site.Math)
				assert.Equal(t, []string{"drafts"}, cmds.Site.Exclude)
				assert.Equal(t, "notes", cmds.Site.Args.Dir)
			},
		},
		{
			name: "diff takes the paths after --", args: []string{"diff", "main", "HEAD", "--", "docs", "-x.md"},
			command: diffCommand,
			check: func(t *testing.T, cmds *commands) {
				assert.Equal(t, []string{"main", "HEAD"}, cmds.Diff.Args.Revs)
				assert.Equal(t, []string{"docs", "-x.md"}, cmds.Diff.paths)
				assert.Equal(t, outputPage, cmds.Diff.Format)
				assert.Equal(t, 1, cmds.Diff.Context)
			},
		},
		{
			name: "format takes files on both sides of --", args: []string{"format", "-w", "a.md", "--", "-b.md"},
			command: formatCommand,
			check: func(t *testing.T, cmds *commands) {
				assert.True(t, cmds.Format.Write)
				assert.Equal(t, []string{"a.md", "-b.md"}, cmds.Format.Args.Files)
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			cmds, name, err := parseCommands(tc.args)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.command, name)
			if tc.check != nil {
				tc.check(t, cmds)
			}
		})
	}
}

func TestParseCommandsInvalid(t *testing.T) {
	tests := []struct {
		name string
		args []string
	}{
		{name: "unknown command", args: []string{"publish"}},
		{name: "unknown format", args: []string{"render", "-f", "pdf"}},
		{name: "render with two files", args: []string{"render", "a.md", "--", "b.md"}},
		{name: "hash with files after --", args: []string{"hash", "--", "x"}},
		{name: "site without an output", args: []string{"site", "notes"}},
		{name: "site without notes", args: []string{"site", "-o", "out"}},
		{name: "a server option without serve", args: []string{"--listen=:9000"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, _, err := parseCommands(tc.args)

			// assert
			require.Error(t, err)
			assert.Contains(t, err.Error(), "parse flags")
		})
	}
}

func TestRunCommandWithoutACommand(t *testing.T) {
	// act
	code, out, errOut := runCLI(t, "")

	// assert
	assert.Equal(t, 1, code)
	assert.Empty(t, out)
	assert.Equal(t, "a command is required: serve, render, site, diff, format, stylesheet, hash, token; see scrawl --help\n",
		errOut)
}

func TestRunCommandVersion(t *testing.T) {
	// act
	code, out, _ := runCLI(t, "", "--version")

	// assert
	assert.Equal(t, 0, code)
	assert.Equal(t, "scrawl "+versionInfo()+"\n", out)
}

func TestRunRender(t *testing.T) {
	src := "---\ntitle: x\n---\n# Заголовок\n\nSee [the other](other.md) and $x^2$.\n"

	t.Run("a fragment keeps a relative link relative", func(t *testing.T) {
		// act
		code, out, errOut := runCLI(t, src, "render", "-f", "fragment")

		// assert
		assert.Equal(t, 0, code, errOut)
		assert.Contains(t, out, `<h1 id="заголовок"`)
		assert.Contains(t, out, `href="other.md"`)
		assert.NotContains(t, out, "<html")
	})

	t.Run("json carries the title, the outline and the frontmatter", func(t *testing.T) {
		// act
		code, out, errOut := runCLI(t, src, "render", "-f", "json", "--link-ext=.html", "-")

		// assert
		assert.Equal(t, 0, code, errOut)
		var got noteJSON
		require.NoError(t, json.Unmarshal([]byte(out), &got))
		assert.Equal(t, "Заголовок", got.Title)
		assert.Equal(t, "---\ntitle: x\n---", got.Frontmatter)
		require.Len(t, got.TOC, 1)
		assert.Equal(t, "Заголовок", got.TOC[0].Text)
		assert.Contains(t, got.HTML, `href="other.html"`)
	})

	t.Run("a page written to a file opens on its own", func(t *testing.T) {
		// arrange
		dir := t.TempDir()
		in := filepath.Join(dir, "note.md")
		require.NoError(t, os.WriteFile(in, []byte(src), 0o600))
		target := filepath.Join(dir, "note.html")

		// act
		code, out, errOut := runCLI(t, "", "render", in, "-o", target, "--math")

		// assert
		assert.Equal(t, 0, code, errOut)
		assert.Empty(t, out)
		written, err := os.ReadFile(target)
		require.NoError(t, err)
		assert.Contains(t, string(written), "<title>Заголовок</title>")
		assert.Contains(t, string(written), `<span class="math math-inline">`)
		assert.Contains(t, string(written), "katex")
	})

	t.Run("a missing file is an error", func(t *testing.T) {
		// act
		code, _, errOut := runCLI(t, "", "render", filepath.Join(t.TempDir(), "missing.md"))

		// assert
		assert.Equal(t, 1, code)
		assert.Contains(t, errOut, "scrawl render: read ")
	})
}

func TestRunFormat(t *testing.T) {
	messy := "#  Title\n\n* one\n* two\n"
	clean := "# Title\n\n- one\n- two\n"

	t.Run("standard input to standard output", func(t *testing.T) {
		// act
		code, out, errOut := runCLI(t, messy, "format")

		// assert
		assert.Equal(t, 0, code, errOut)
		assert.Equal(t, clean, out)
	})

	t.Run("check names the files that would change", func(t *testing.T) {
		// arrange
		dir := t.TempDir()
		dirty, tidy := filepath.Join(dir, "dirty.md"), filepath.Join(dir, "tidy.md")
		require.NoError(t, os.WriteFile(dirty, []byte(messy), 0o600))
		require.NoError(t, os.WriteFile(tidy, []byte(clean), 0o600))

		// act
		code, out, errOut := runCLI(t, "", "format", "--check", dirty, tidy)

		// assert
		assert.Equal(t, 1, code, errOut)
		assert.Equal(t, dirty+"\n", out)
	})

	t.Run("write replaces the file and keeps its mode", func(t *testing.T) {
		// arrange
		file := filepath.Join(t.TempDir(), "note.md")
		require.NoError(t, os.WriteFile(file, []byte(messy), 0o640))

		// act
		code, out, errOut := runCLI(t, "", "format", "-w", file)

		// assert
		assert.Equal(t, 0, code, errOut)
		assert.Empty(t, out)
		written, err := os.ReadFile(file)
		require.NoError(t, err)
		assert.Equal(t, clean, string(written))
		info, err := os.Stat(file)
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o640), info.Mode().Perm())
		entries, err := os.ReadDir(filepath.Dir(file))
		require.NoError(t, err)
		assert.Len(t, entries, 1)
	})

	t.Run("refuses what it cannot do", func(t *testing.T) {
		for _, args := range [][]string{
			{"format", "-w", "-c", "a.md"},
			{"format", "-w"},
			{"format", "a.md", "b.md"},
			{"format", "a.md", "-"},
		} {
			// act
			code, _, errOut := runCLI(t, "", args...)

			// assert
			assert.Equal(t, 1, code, "%v", args)
			assert.Contains(t, errOut, "scrawl format: ", "%v", args)
		}
	})
}

func TestRunHashAndToken(t *testing.T) {
	t.Run("hash reads the password from standard input", func(t *testing.T) {
		// act
		code, out, errOut := runCLI(t, "secret\n", "hash")

		// assert
		assert.Equal(t, 0, code, errOut)
		assert.True(t, strings.HasPrefix(out, "$2a$"), out)
	})

	t.Run("token names the entry", func(t *testing.T) {
		// act
		code, out, errOut := runCLI(t, "", "token", "agent")

		// assert
		assert.Equal(t, 0, code, errOut)
		assert.Contains(t, out, "configuration entry for --auth.tokens: agent:sha256:")
	})
}

func TestRunStylesheet(t *testing.T) {
	// act
	code, out, errOut := runCLI(t, "", "stylesheet")

	// assert
	assert.Equal(t, 0, code, errOut)
	assert.Equal(t, page.Stylesheet(), out)
}
