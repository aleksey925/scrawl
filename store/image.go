package store

import (
	"bytes"
	"encoding/binary"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
)

func (s *Store) ImageSize(p string) (width, height int, ok bool) {
	f, _, err := s.Open(p)
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()
	var head bytes.Buffer
	cfg, format, err := image.DecodeConfig(io.TeeReader(f, &head))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return 0, 0, false
	}
	if format == "jpeg" && quarterTurned(head.Bytes()) {
		return cfg.Height, cfg.Width, true
	}
	return cfg.Width, cfg.Height, true
}

const (
	jpegStartOfScan = 0xDA
	jpegApp1        = 0xE1
	exifOrientation = 0x0112
	exifEntrySize   = 12
)

func quarterTurned(jpeg []byte) bool {
	at := 2
	for at+4 <= len(jpeg) && jpeg[at] == 0xFF {
		marker := jpeg[at+1]
		end := at + 2 + int(binary.BigEndian.Uint16(jpeg[at+2:]))
		if marker == jpegStartOfScan || end > len(jpeg) {
			return false
		}
		if marker == jpegApp1 {
			if turn, found := orientationOf(jpeg[at+4 : end]); found {
				return turn >= 5 && turn <= 8
			}
		}
		at = end
	}
	return false
}

func orientationOf(segment []byte) (uint16, bool) {
	tiff, isExif := bytes.CutPrefix(segment, []byte("Exif\x00\x00"))
	if !isExif || len(tiff) < 8 {
		return 0, false
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0, false
	}
	ifd := uint64(order.Uint32(tiff[4:]))
	if ifd+2 > uint64(len(tiff)) {
		return 0, false
	}
	entries := tiff[ifd+2:]
	for range order.Uint16(tiff[ifd:]) {
		if len(entries) < exifEntrySize {
			return 0, false
		}
		if order.Uint16(entries) == exifOrientation {
			return order.Uint16(entries[8:]), true
		}
		entries = entries[exifEntrySize:]
	}
	return 0, false
}
