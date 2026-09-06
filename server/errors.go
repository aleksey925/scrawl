package server

import (
	"errors"
	"net/http"

	"github.com/aleksey925/mdserver/store"
)

// statusOf maps a store error onto the status the API contract promises.
func statusOf(err error) int {
	switch {
	case err == nil:
		return http.StatusOK
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
	}
	return "Something went wrong"
}
