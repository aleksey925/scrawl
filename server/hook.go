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

// maxHookBody bounds the one part of a delivery an unauthenticated caller
// controls the size of. It cannot be smaller than a real delivery, or the
// webhook fails silently for a busy repository and the operator sees 413s in a
// list with nothing wrong on their side; GitHub documents 25 MB as its payload
// limit. Streaming is what makes the number cheap: a rejected delivery costs a
// bounded read and one sha256 pass, never 25 MiB of held memory.
const maxHookBody = 25 << 20

// the two schemes, named by the header the sender chose. GitHub, Gitea and
// Forgejo sign; GitLab sends the secret itself.
const (
	hubSignatureHeader = "X-Hub-Signature-256"
	gitlabTokenHeader  = "X-Gitlab-Token" //nolint:gosec // G101: a header name, never a value

	schemeHubSignature = "hub-signature"
	schemeGitlabToken  = "gitlab-token"
)

// signaturePrefix is what a GitHub signature header starts with. The sha1 form,
// X-Hub-Signature, is deliberately unsupported: it is superseded, and keeping a
// broken hash alive buys no deployment that cannot send the sha256 one.
const signaturePrefix = "sha256="

// errBodyTooLarge separates the one rejection that is not a credential failure,
// so it can answer 413 rather than 401.
var errBodyTooLarge = errors.New("body too large")

// Webhook is what a project needs to answer a delivery. Notify is non-blocking
// and asks main to run Sync; the handler never runs git itself.
type Webhook struct {
	Secret string
	Notify func()
}

// hookHandler answers a delivery from the upstream repository. It is the whole
// security of an endpoint that is reachable without a session, so it is written
// as a closed set of outcomes and nothing below the verification runs until the
// verification passed.
//
// A verified POST means "something may have changed, run Sync" and nothing
// more. No JSON is parsed, no event type is read, no branch is filtered: a push
// to a branch we do not track costs one fetch that finds nothing, which is
// cheaper in code and in failure modes than a parser that has to know four
// providers' shapes and stay right as they change. It is also what makes the
// GitLab scheme work at all, because a plain token signs nothing.
//
// The route is registered outside the mutating group on purpose. Go's
// cross-origin protection allows a request carrying neither Sec-Fetch-Site nor
// Origin, which is every provider delivery, so it would pass the check - it is
// outside it so that the one route whose credential is a signature does not
// look like it depends on a browser-shaped check with nothing to say about it.
func (m *mount) hookHandler(w http.ResponseWriter, r *http.Request) {
	hook := m.prj.Webhook
	if hook == nil {
		// the route is registered only for a project that declared a secret
		http.Error(w, statusMessage(http.StatusNotFound), http.StatusNotFound)
		return
	}
	// the GET registration exists only for this: without it a GET on a path
	// that is in the public list would fall to the shell catch-all and hand the
	// app to an anonymous caller
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		jsonError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	scheme, err := verifyHook(w, r, []byte(hook.Secret))
	if err != nil {
		log.Printf("[WARN] webhook %s: rejected a delivery: %v", m.prj.Name, err)
		if errors.Is(err, errBodyTooLarge) {
			jsonError(w, http.StatusRequestEntityTooLarge, "body too large")
			return
		}
		jsonError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	log.Printf("[DEBUG] webhook %s: delivery accepted (%s)", m.prj.Name, scheme)
	// it never runs git: a fetch is a network round trip and the provider's own
	// delivery timeout is shorter than a slow one, and Sync takes the history
	// lock, so doing it here would block every save on the project for the
	// length of somebody else's network
	hook.Notify()
	w.WriteHeader(http.StatusAccepted)
}

// verifyHook decides which scheme the sender used and checks the credential.
// It returns the scheme for the log line and nothing else: the body is never
// kept.
func verifyHook(w http.ResponseWriter, r *http.Request, secret []byte) (string, error) {
	if presented := r.Header.Get(hubSignatureHeader); presented != "" {
		return schemeHubSignature, verifySignature(w, r, secret, presented)
	}
	if presented := r.Header.Get(gitlabTokenHeader); presented != "" {
		// the body is never read, and therefore never capped and never answered
		// with a 413; the server drains what it can and closes the connection
		// otherwise, like any handler that ignores a body
		if subtle.ConstantTimeCompare([]byte(presented), secret) != 1 {
			return "", errors.New("token mismatch")
		}
		return schemeGitlabToken, nil
	}
	return "", errors.New("no signature header")
}

// verifySignature checks the header's shape before the body is touched, so a
// malformed one costs no read at all, and then streams the body through the cap
// into the hash. Nothing is buffered: the memory cost is the hash state
// whatever the cap is.
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
