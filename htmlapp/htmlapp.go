package htmlapp

import (
	"crypto/sha256"
	"encoding/base32"
	"errors"
	"net"
	"net/url"
	"path"
	"strings"
)

const (
	TicketPurpose = "app-ticket"
	CookiePurpose = "app-cookie"

	idLen         = 12
	idPlaceholder = "{id}"
	idSentinel    = "x0scrawl0id0x"
	localPrefix   = "app-"
	localDomain   = "localhost"

	plainCookieName  = "scrawl_app"
	secureCookieName = "__Host-scrawl_app"
)

var (
	ErrNoID = errors.New("must have {id} in its first label, such as https://app-{id}.example.com: " +
		"every HTML app runs on a host of its own")
	ErrNotHere  = errors.New("HTML apps do not run at this address")
	ErrSameHost = errors.New("an HTML app cannot run on the host of scrawl")
)

var idEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

type Hosts struct {
	scheme string
	prefix string
	suffix string
	rest   string
	port   string
}

type Ticket struct {
	Space   string `json:"space"`
	Folder  string `json:"folder"`
	File    string `json:"file"`
	Parent  string `json:"parent"`
	App     string `json:"app"`
	Nonce   string `json:"nonce"`
	Offline bool   `json:"offline"`
}

type Cookie struct {
	Space  string `json:"space"`
	Folder string `json:"folder"`
	Parent string `json:"parent"`
}

func Parse(raw string) (Hosts, error) {
	if raw == "" {
		return Hosts{}, nil
	}
	if strings.Count(raw, idPlaceholder) != 1 {
		return Hosts{}, ErrNoID
	}
	u, err := parseURL(strings.Replace(raw, idPlaceholder, idSentinel, 1))
	if err != nil {
		return Hosts{}, err
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	first, rest, found := strings.Cut(host, ".")
	prefix, suffix, inFirst := strings.Cut(first, idSentinel)
	if !inFirst {
		return Hosts{}, ErrNoID
	}
	if u.Path != "" && u.Path != "/" {
		return Hosts{}, errors.New("must have no path")
	}
	if !found || rest == "" {
		return Hosts{}, errors.New("must have a domain after the label with {id}")
	}
	if !labelChars(prefix) || !labelChars(suffix) {
		return Hosts{}, errors.New("may have only letters, digits and - beside {id}")
	}
	return Hosts{scheme: u.Scheme, prefix: prefix, suffix: suffix, rest: rest, port: u.Port()}, nil
}

func parseURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("is not a URL")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, errors.New("must be an http or https URL")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" {
		return nil, errors.New("must have no user, query or fragment")
	}
	return u, nil
}

func labelChars(s string) bool {
	for _, c := range s {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return false
		}
	}
	return true
}

func (h Hosts) Local() bool { return h.scheme == "" }

func (h Hosts) Secure() bool { return h.scheme == "https" }

func (h Hosts) CookieName() string {
	if h.Secure() {
		return secureCookieName
	}
	return plainCookieName
}

func (h Hosts) Match(hostport string) (id string, apps bool) {
	first, rest, _ := strings.Cut(Hostname(hostport), ".")
	if h.Local() {
		x, ok := strings.CutPrefix(first, localPrefix)
		if !ok || (rest != localDomain && !strings.HasSuffix(rest, "."+localDomain)) {
			return "", false
		}
		return validID(x), true
	}
	if rest != h.rest || len(first) < len(h.prefix)+len(h.suffix) ||
		!strings.HasPrefix(first, h.prefix) || !strings.HasSuffix(first, h.suffix) {
		return "", false
	}
	id = validID(first[len(h.prefix) : len(first)-len(h.suffix)])
	if id == "" && h.prefix == "" && h.suffix == "" {
		return "", false
	}
	return id, true
}

func (h Hosts) Origin(id, parent string) (string, error) {
	pu, err := url.Parse(parent)
	if err != nil {
		return "", ErrNotHere
	}
	parentHost := Hostname(pu.Host)
	scheme, host, port := h.scheme, h.prefix+id+h.suffix+"."+h.rest, h.port
	if h.Local() {
		scheme, port = pu.Scheme, pu.Port()
		switch {
		case parentHost == "127.0.0.1":
			host = localPrefix + id + "." + localDomain
		case parentHost == localDomain || strings.HasSuffix(parentHost, "."+localDomain):
			host = localPrefix + id + "." + parentHost
		default:
			return "", ErrNotHere
		}
	}
	if host == parentHost {
		return "", ErrSameHost
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	}
	return scheme + "://" + host, nil
}

func (h Hosts) FrameSources() string {
	if h.Local() {
		return "http://*.localhost:* https://*.localhost:*"
	}
	res := h.scheme + "://*." + h.rest
	if h.port != "" {
		res += ":" + h.port
	}
	return res
}

func Hostname(hostport string) string {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	return strings.TrimSuffix(strings.ToLower(host), ".")
}

func ID(space, folder string) string {
	sum := sha256.Sum256([]byte(space + "\x00" + folder))
	return strings.ToLower(idEncoding.EncodeToString(sum[:]))[:idLen]
}

func validID(x string) string {
	if len(x) != idLen {
		return ""
	}
	for _, c := range x {
		if (c < 'a' || c > 'z') && (c < '2' || c > '7') {
			return ""
		}
	}
	return x
}

func Folder(p string) string {
	dir := path.Dir(p)
	if dir == "." || dir == "/" {
		return ""
	}
	return dir
}

func Runnable(p string) bool {
	ext := strings.ToLower(path.Ext(p))
	return ext == ".html" || ext == ".htm"
}

var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".htm":         "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json; charset=utf-8",
	".map":         "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".wasm":        "application/wasm",
	".txt":         "text/plain; charset=utf-8",
	".csv":         "text/csv; charset=utf-8",
	".xml":         "application/xml; charset=utf-8",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".gif":         "image/gif",
	".webp":        "image/webp",
	".avif":        "image/avif",
	".ico":         "image/vnd.microsoft.icon",
	".svg":         "image/svg+xml",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
	".ttf":         "font/ttf",
	".otf":         "font/otf",
	".mp3":         "audio/mpeg",
	".wav":         "audio/wav",
	".ogg":         "audio/ogg",
	".mp4":         "video/mp4",
	".webm":        "video/webm",
}

func ContentType(name string) (string, bool) {
	ct, ok := contentTypes[strings.ToLower(path.Ext(name))]
	return ct, ok
}
