package server

import (
	"errors"
	"log"
	"net/http"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/history"
)

// divergenceResponse is what a reset to the remote would do, measured.
type divergenceResponse struct {
	// Head and Remote go back in the reset request untouched, so the reset
	// acts on the state this answer describes or not at all.
	Head   string `json:"head"`
	Remote string `json:"remote"`
	// Clean means nothing here is missing from the remote. Lost can be empty
	// without it: the paths are hidden, or the check could not finish.
	Clean bool          `json:"clean"`
	Lost  unsyncedPaths `json:"lost"`
	// CanPushBackup is false for a project that never pushes anything.
	CanPushBackup bool `json:"can_push_backup"`
}

type resetRequest struct {
	Head       string `json:"head"`
	Remote     string `json:"remote"`
	PushBackup bool   `json:"push_backup"`
}

type resetResponse struct {
	Backup       string `json:"backup"`
	BackupPushed bool   `json:"backup_pushed"`
}

// canReset reports whether this caller may move the project to the remote's
// version. It is not the write guard: a read-only mirror whose upstream was
// rewritten is the project that needs a reset most, and no note anybody wrote
// here is changed by one. So it asks who is calling instead - and with auth
// off nobody is, which leaves the write guard as the only thing to go by.
//
// /api/me and both routes ask this one function, so the page never offers what
// the server refuses.
func (m *mount) canReset(r *http.Request) bool {
	if !m.history().Remote() || auth.ReadOnlyToken(r) {
		return false
	}
	if m.AuthDisabled || m.Auth == nil {
		return !m.readOnly()
	}
	_, known := m.Auth.User(r)
	return known
}

func (m *mount) refuseReset(w http.ResponseWriter, r *http.Request) bool {
	if m.canReset(r) {
		return false
	}
	jsonError(w, http.StatusForbidden, "resetting this project is not allowed")
	return true
}

// apiSyncCheck syncs once and answers what a reset would lose. It is a POST
// because it fetches, and it waits for the answer where the webhook does not:
// somebody is looking at a dialog that has nothing to show until it arrives.
func (m *mount) apiSyncCheck(w http.ResponseWriter, r *http.Request) {
	if m.refuseReset(w, r) {
		return
	}
	res, err := m.history().CheckDivergence(r.Context())
	if err != nil {
		failSync(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, divergenceResponse{
		Head:          res.Head,
		Remote:        res.Remote,
		Clean:         res.Clean,
		Lost:          unsyncedOf(res.Lost),
		CanPushBackup: !m.readOnly(),
	})
}

// apiSyncReset moves the project to the remote's version. The two commits in
// the body are compared and never handed to git.
func (m *mount) apiSyncReset(w http.ResponseWriter, r *http.Request) {
	if m.refuseReset(w, r) {
		return
	}
	var req resetRequest
	if !decodeJSON(w, r, &req, maxJSONBody) {
		return
	}
	res, err := m.history().ResetToRemote(r.Context(), history.ResetOp{
		Actor:      m.actor(r),
		Head:       req.Head,
		Remote:     req.Remote,
		PushBackup: req.PushBackup,
	})
	if err != nil {
		failSync(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, resetResponse{Backup: res.Backup, BackupPushed: res.BackupPushed})
}

// failSync answers a check or a reset that did not happen. A refusal carries
// its reason, which history has already redacted and which names the files in
// the way: without it the reader is back to guessing what to do in a clone.
func failSync(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, history.ErrDisabled), errors.Is(err, history.ErrNotDiverged):
		jsonError(w, http.StatusConflict, "this project has not diverged from the remote")
	case errors.Is(err, history.ErrStateChanged):
		jsonError(w, http.StatusPreconditionFailed, "the project changed since it was checked")
	case errors.Is(err, history.ErrResetRefused):
		log.Printf("[WARN] %s %s: %v", r.Method, r.URL.Path, err)
		jsonError(w, http.StatusUnprocessableEntity, err.Error())
	default:
		log.Printf("[WARN] %s %s: %v", r.Method, r.URL.Path, err)
		jsonError(w, http.StatusBadGateway, err.Error())
	}
}

func unsyncedOf(paths history.Unsynced) unsyncedPaths {
	res := unsyncedPaths{Paths: paths.Paths, Many: paths.Many}
	if res.Paths == nil {
		res.Paths = []string{}
	}
	return res
}
