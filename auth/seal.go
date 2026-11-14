package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"strconv"
	"strings"
	"time"
)

const sealParts = 4

func (s *Service) Seal(purpose, user string, payload []byte, expiry time.Time) string {
	body := b64.EncodeToString([]byte(user)) + tokenSep +
		strconv.FormatInt(expiry.Unix(), 10) + tokenSep +
		b64.EncodeToString(payload)
	return body + tokenSep + b64.EncodeToString(s.sealMAC(purpose, body, user))
}

func (s *Service) Unseal(purpose, value string) (user string, payload []byte, ok bool) {
	parts := strings.Split(value, tokenSep)
	if len(parts) != sealParts {
		return "", nil, false
	}
	name, err := b64.DecodeString(parts[0])
	if err != nil {
		return "", nil, false
	}
	got, err := b64.DecodeString(parts[3])
	body := strings.Join(parts[:3], tokenSep)
	if err != nil || !hmac.Equal(got, s.sealMAC(purpose, body, string(name))) {
		return "", nil, false
	}
	unix, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || !time.Unix(unix, 0).After(s.now()) {
		return "", nil, false
	}
	payload, err = b64.DecodeString(parts[2])
	if err != nil {
		return "", nil, false
	}
	return string(name), payload, true
}

func (s *Service) TTL() time.Duration { return s.ttl }

func (s *Service) sealMAC(purpose, body, user string) []byte {
	key := hmac.New(sha256.New, s.secret)
	key.Write([]byte("scrawl/" + purpose))
	return macWith(key.Sum(nil), body, s.epochOf(user))
}
