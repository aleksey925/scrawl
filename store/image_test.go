package store

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
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
		"pics/short.jpg":   jfifWithSegmentAfterFrame(photo.Bytes(), []byte{0xFF, 0xE1, 0, 0}),
		"pics/heavy.jpg":   string(photo.Bytes()[:2]) + strings.Repeat(fillerSegment(), imageHeadCap/0xFFFF+1) + string(photo.Bytes()[2:]),
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
		{name: "a jpeg with a segment too short after its frame", path: "pics/short.jpg", width: 40, height: 30, ok: true},
		{name: "a jpeg with more metadata before its frame than the cap", path: "pics/heavy.jpg"},
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

func jfifWithSegmentAfterFrame(jpegData, segment []byte) string {
	frame := bytes.Index(jpegData, []byte{0xFF, 0xC0})
	end := frame + 2 + int(binary.BigEndian.Uint16(jpegData[frame+2:]))
	jfif := []byte{0xFF, 0xE0, 0, 16, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0}
	return string(jpegData[:2]) + string(jfif) + string(jpegData[2:end]) + string(segment) + string(jpegData[end:])
}

func fillerSegment() string {
	return string([]byte{0xFF, 0xEF, 0xFF, 0xFF}) + strings.Repeat("x", 0xFFFF-2)
}
