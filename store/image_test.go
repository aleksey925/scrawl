package store

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageSizeReadsTheHeaderOfAPicture(t *testing.T) {
	// arrange
	var shot, photo, clip bytes.Buffer
	require.NoError(t, png.Encode(&shot, image.NewRGBA(image.Rect(0, 0, 32, 24))))
	require.NoError(t, jpeg.Encode(&photo, image.NewRGBA(image.Rect(0, 0, 40, 30)), nil))
	require.NoError(t, gif.Encode(&clip, image.NewPaletted(image.Rect(0, 0, 16, 8), []color.Color{color.Black}), nil))
	s := newStore(t, map[string]string{
		"pics/shot.png":    shot.String(),
		"pics/photo.jpg":   photo.String(),
		"pics/turned.jpg":  withOrientation(photo.Bytes(), 6),
		"pics/flipped.jpg": withOrientation(photo.Bytes(), 3),
		"pics/clip.gif":    clip.String(),
		"pics/logo.svg":    "<svg/>",
		"note.md":          "# Note\n",
	})

	tests := []struct {
		name   string
		path   string
		width  int
		height int
		ok     bool
	}{
		{name: "a png", path: "pics/shot.png", width: 32, height: 24, ok: true},
		{name: "a jpeg", path: "pics/photo.jpg", width: 40, height: 30, ok: true},
		{name: "a jpeg its exif turns a quarter", path: "pics/turned.jpg", width: 30, height: 40, ok: true},
		{name: "a jpeg its exif turns upside down", path: "pics/flipped.jpg", width: 40, height: 30, ok: true},
		{name: "a gif", path: "pics/clip.gif", width: 16, height: 8, ok: true},
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

func withOrientation(jpegData []byte, orientation byte) string {
	tiff := []byte{'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0}
	payload := append([]byte("Exif\x00\x00"), tiff...)
	segment := append([]byte{0xFF, 0xE1, 0, byte(len(payload) + 2)}, payload...)
	return string(jpegData[:2]) + string(segment) + string(jpegData[2:])
}
