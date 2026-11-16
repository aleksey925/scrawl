package store

import (
	"bytes"
	"image"
	"image/png"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageSizeReadsTheHeaderOfAPicture(t *testing.T) {
	// arrange
	var picture bytes.Buffer
	require.NoError(t, png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 32, 24))))
	s := newStore(t, map[string]string{"pics/shot.png": picture.String(), "pics/logo.svg": "<svg/>", "note.md": "# Note\n"})

	tests := []struct {
		name   string
		path   string
		width  int
		height int
		ok     bool
	}{
		{name: "a png", path: "pics/shot.png", width: 32, height: 24, ok: true},
		{name: "an svg has no size of its own", path: "pics/logo.svg"},
		{name: "a note is no picture", path: "note.md"},
		{name: "a missing file", path: "pics/gone.png"},
		{name: "a path out of the root", path: "../outside.png"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			width, height, ok := s.ImageSize(tc.path)

			// assert
			assert.Equal(t, [3]any{tc.width, tc.height, tc.ok}, [3]any{width, height, ok})
		})
	}
}
