package auth

import (
	"slices"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Login budget per client IP: a handful of tries at once, then one every
// refill interval. On top of that a run of failures locks the client out
// completely for a while, which is what stops a slow patient guesser.
const (
	loginBurst        = 5
	loginRefill       = 12 * time.Second
	lockoutAfterFails = 10
	lockoutFor        = 15 * time.Minute
)

// Bounds on the limiter map. Idle clients are swept periodically and a hard
// cap keeps a flood of forged client addresses from exhausting memory.
const (
	limiterIdleTTL    = time.Hour
	limiterSweepEvery = 10 * time.Minute
	limiterMaxEntries = 10000
	// evictFraction is how much of a full map one eviction clears, as a divisor
	// of the cap.
	evictFraction = 10
)

type limiterEntry struct {
	lim    *rate.Limiter
	fails  int
	locked time.Time
	seen   time.Time
}

// limiter is a per-key attempt budget with a lockout, swept on write so it
// needs no background goroutine and no shutdown hook.
type limiter struct {
	mu         sync.Mutex
	entries    map[string]*limiterEntry
	lastSweep  time.Time
	rate       rate.Limit
	burst      int
	maxFails   int
	lockout    time.Duration
	idle       time.Duration
	sweepEvery time.Duration
	maxEntries int
}

func newLimiter(now time.Time) *limiter {
	return &limiter{
		entries:    map[string]*limiterEntry{},
		lastSweep:  now,
		rate:       rate.Every(loginRefill),
		burst:      loginBurst,
		maxFails:   lockoutAfterFails,
		lockout:    lockoutFor,
		idle:       limiterIdleTTL,
		sweepEvery: limiterSweepEvery,
		maxEntries: limiterMaxEntries,
	}
}

// allow consumes one attempt from the key's budget.
func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry := l.entry(key, now)
	if now.Before(entry.locked) {
		return false
	}
	return entry.lim.AllowN(now, 1)
}

// failed records a rejected attempt and starts a lockout once too many pile up.
func (l *limiter) failed(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry := l.entry(key, now)
	entry.fails++
	if entry.fails >= l.maxFails {
		entry.fails = 0
		entry.locked = now.Add(l.lockout)
	}
}

// reset forgets everything about a key, giving it a full budget again.
func (l *limiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}

func (l *limiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}

// entry returns the key's state, creating it when the key is new. A full map
// evicts instead of refusing: refusing would close the login form for everybody
// who has no entry yet, and filling the map is cheap for an attacker, so the
// cap bounds memory and nothing else.
func (l *limiter) entry(key string, now time.Time) *limiterEntry {
	if entry, ok := l.entries[key]; ok {
		entry.seen = now
		return entry
	}
	if now.Sub(l.lastSweep) >= l.sweepEvery || len(l.entries) >= l.maxEntries {
		l.sweep(now)
	}
	if len(l.entries) >= l.maxEntries {
		l.evict(now)
	}
	entry := &limiterEntry{lim: rate.NewLimiter(l.rate, l.burst), seen: now}
	l.entries[key] = entry
	return entry
}

// evict makes room by dropping the least recently seen keys, a batch at a time
// so that a flood of fresh keys does not scan the whole map on every request.
// Locked out keys go last: an attacker who filled the map must not be able to
// shake off a lockout by flooding it again.
func (l *limiter) evict(now time.Time) {
	keys := make([]string, 0, len(l.entries))
	for key := range l.entries {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b string) int {
		lockedA, lockedB := now.Before(l.entries[a].locked), now.Before(l.entries[b].locked)
		if lockedA != lockedB {
			if lockedA {
				return 1
			}
			return -1
		}
		return l.entries[a].seen.Compare(l.entries[b].seen)
	})

	batch := max(1, l.maxEntries/evictFraction)
	for _, key := range keys[:min(batch, len(keys))] {
		delete(l.entries, key)
	}
}

// sweep drops idle keys. A locked out key stays, otherwise the lockout could
// be shaken off simply by waiting quietly.
func (l *limiter) sweep(now time.Time) {
	l.lastSweep = now
	cutoff := now.Add(-l.idle)
	for key, entry := range l.entries {
		if entry.seen.Before(cutoff) && !now.Before(entry.locked) {
			delete(l.entries, key)
		}
	}
}
