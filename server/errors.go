package server

import (
	"errors"
	"net/http"

	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/store"
)

// errRenderTimeout is returned when a render outran its deadline. It is the
// server's own error and not a store one, but it travels the same path.
var errRenderTimeout = errors.New("render timed out")

// statusOf maps a store error onto the status the API contract promises.
func statusOf(err error) int {
	switch {
	case err == nil:
		return http.StatusOK
	case errors.Is(err, errRenderTimeout):
		return http.StatusServiceUnavailable
	case errors.Is(err, errHistoryNotRecorded), errors.Is(err, history.ErrNotPublished):
		return http.StatusInternalServerError
	case errors.Is(err, store.ErrPermission):
		return http.StatusForbidden
	case errors.Is(err, store.ErrConflict):
		return http.StatusPreconditionFailed
	case errors.Is(err, store.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, store.ErrExists), errors.Is(err, store.ErrNotEmpty):
		return http.StatusConflict
	case errors.Is(err, store.ErrReadOnly):
		return http.StatusForbidden
	case errors.Is(err, store.ErrTooLarge):
		return http.StatusRequestEntityTooLarge
	case errors.Is(err, store.ErrForbidden), errors.Is(err, store.ErrIsDir):
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

// errMessage is the text the client gets. It is derived from the sentinel and
// never from err.Error(): store errors quote the path they failed on and a
// wrapped os error quotes the filesystem path, neither of which belongs in a
// response.
func errMessage(err error) string {
	switch {
	case errors.Is(err, errRenderTimeout):
		return "rendering took too long"
	case errors.Is(err, errHistoryNotRecorded):
		return "the change was written but not recorded in history"
	case errors.Is(err, history.ErrNotPublished):
		return "the change was written and recorded, but not pushed to the remote"
	case errors.Is(err, store.ErrPermission):
		return permissionMessage
	case errors.Is(err, store.ErrConflict):
		return "conflict"
	case errors.Is(err, store.ErrNotFound):
		return "not found"
	case errors.Is(err, store.ErrExists):
		return "already exists"
	case errors.Is(err, store.ErrNotEmpty):
		return "directory is not empty"
	case errors.Is(err, store.ErrReadOnly):
		return "read-only mode, writing is disabled"
	case errors.Is(err, store.ErrTooLarge):
		return "file is too large"
	case errors.Is(err, store.ErrIsDir):
		return "path is a directory"
	case errors.Is(err, store.ErrForbidden):
		return "forbidden"
	}
	return "internal error"
}

// statusMessage titles the error page for a status raised by the server itself
// rather than by the store.
func statusMessage(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "That path does not look right"
	case http.StatusForbidden:
		return "This is not allowed"
	case http.StatusNotFound:
		return "This page does not exist"
	case http.StatusRequestEntityTooLarge:
		return "That is too large"
	case http.StatusTooManyRequests:
		return "Too many attempts"
	case http.StatusServiceUnavailable:
		return "That took too long"
	}
	return "Something went wrong"
}

// permissionMessage names the cause a bare "forbidden" hides. On a NAS the
// container almost always runs as a uid that does not own the mounted folder,
// and that is the one failure the owner has to be told about in full.
const permissionMessage = "permission denied by the filesystem, the notes folder must be " +
	"readable and writable by the user the server runs as"
