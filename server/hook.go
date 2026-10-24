package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
)

const maxHookBody = 25 << 20

const (
	hubSignatureHeader = "X-Hub-Signature-256"
	gitlabTokenHeader  = "X-Gitlab-Token" //nolint:gosec // G101: a header name, never a value

	schemeHubSignature = "hub-signature"
	schemeGitlabToken  = "gitlab-token"
)

const signaturePrefix = "sha256="

var errBodyTooLarge = errors.New("body too large")

type Webhook struct {
	Secret string
	Notify func()
}

func (m *mount) hookHandler(w http.ResponseWriter, r *http.Request) {
	hook := m.spc.Webhook
	if hook == nil {
		http.Error(w, statusMessage(http.StatusNotFound), http.StatusNotFound)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		jsonError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	scheme, err := verifyHook(w, r, []byte(hook.Secret))
	if err != nil {
		log.Printf("[WARN] webhook %s: rejected a delivery: %v", m.spc.Name, err)
		if errors.Is(err, errBodyTooLarge) {
			jsonError(w, http.StatusRequestEntityTooLarge, "body too large")
			return
		}
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	log.Printf("[DEBUG] webhook %s: delivery accepted (%s)", m.spc.Name, scheme)
	hook.Notify()
	w.WriteHeader(http.StatusAccepted)
}

func verifyHook(w http.ResponseWriter, r *http.Request, secret []byte) (string, error) {
	if presented := r.Header.Get(hubSignatureHeader); presented != "" {
		return schemeHubSignature, verifySignature(w, r, secret, presented)
	}
	if presented := r.Header.Get(gitlabTokenHeader); presented != "" {
		if subtle.ConstantTimeCompare([]byte(presented), secret) != 1 {
			return "", errors.New("token mismatch")
		}
		return schemeGitlabToken, nil
	}
	return "", errors.New("no signature header")
}

func verifySignature(w http.ResponseWriter, r *http.Request, secret []byte, presented string) error {
	digest, ok := strings.CutPrefix(presented, signaturePrefix)
	if !ok {
		return errors.New("malformed signature")
	}
	want, err := hex.DecodeString(digest)
	if err != nil || len(want) != sha256.Size {
		return errors.New("malformed signature")
	}

	mac := hmac.New(sha256.New, secret)
	body := http.MaxBytesReader(w, r.Body, maxHookBody)
	if _, err = io.Copy(mac, body); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return errBodyTooLarge
		}
		return errors.New("body could not be read")
	}
	if !hmac.Equal(mac.Sum(nil), want) {
		return errors.New("signature mismatch")
	}
	return nil
}
