package auth

import (
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLimiterBudget(t *testing.T) {
	// arrange
	start := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	lim := newLimiter(start)

	// act
	allowed := 0
	for range loginBurst + 5 {
		if lim.allow("10.0.0.1", start) {
			allowed++
		}
	}
	blockedRightAfter := lim.allow("10.0.0.1", start)
	afterOneRefill := lim.allow("10.0.0.1", start.Add(loginRefill))
	otherClient := lim.allow("10.0.0.2", start)

	// assert
	assert.Equal(t, loginBurst, allowed)
	assert.False(t, blockedRightAfter)
	assert.True(t, afterOneRefill, "the budget refills over time")
	assert.True(t, otherClient, "the budget is per client")
}

func TestLimiterLockout(t *testing.T) {
	// arrange
	start := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	lim := newLimiter(start)

	// act
	for range lockoutAfterFails {
		lim.failed("10.0.0.1", start)
	}
	// the budget has refilled long ago, only the lockout can block now
	locked := lim.allow("10.0.0.1", start.Add(time.Minute))
	stillLocked := lim.allow("10.0.0.1", start.Add(lockoutFor-time.Second))
	released := lim.allow("10.0.0.1", start.Add(lockoutFor))

	// assert
	assert.False(t, locked)
	assert.False(t, stillLocked)
	assert.True(t, released)
}

func TestLimiterReset(t *testing.T) {
	// arrange
	start := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	lim := newLimiter(start)
	for range lockoutAfterFails {
		lim.failed("10.0.0.1", start)
	}
	require.False(t, lim.allow("10.0.0.1", start))

	// act
	lim.reset("10.0.0.1")

	// assert
	assert.True(t, lim.allow("10.0.0.1", start))
	assert.Equal(t, 1, lim.size())
}

func TestLimiterEviction(t *testing.T) {
	t.Run("idle entries are swept", func(t *testing.T) {
		// arrange
		start := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
		lim := newLimiter(start)
		for i := range 500 {
			lim.allow("10.0.0."+strconv.Itoa(i), start)
		}
		require.Equal(t, 500, lim.size())

		// act
		lim.allow("192.168.0.1", start.Add(limiterIdleTTL+limiterSweepEvery))

		// assert
		assert.Equal(t, 1, lim.size())
	})

	t.Run("recently seen and locked out entries stay", func(t *testing.T) {
		// arrange
		start := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
		lim := newLimiter(start)
		lim.idle, lim.sweepEvery = time.Minute, time.Minute // short enough for a lockout to outlive them
		for range lockoutAfterFails {
			lim.failed("10.0.0.1", start)
		}
		lim.allow("10.0.0.2", start)
		later := start.Add(5 * time.Minute)
		lim.allow("10.0.0.3", later)

		// act
		lim.allow("192.168.0.1", later)

		// assert
		assert.Equal(t, 3, lim.size(), "only the idle and unlocked entry is dropped")
		assert.False(t, lim.allow("10.0.0.1", later), "the lockout outlives the sweep")
	})

	t.Run("a full map drops the least recently seen key", func(t *testing.T) {
		// arrange
		start := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
		lim := newLimiter(start)
		lim.maxEntries = 3
		for i := range lim.maxEntries {
			require.True(t, lim.allow("10.0.0."+strconv.Itoa(i), start.Add(time.Duration(i)*time.Second)))
		}

		// act
		overflow := lim.allow("10.0.0.100", start.Add(time.Minute))

		// assert
		assert.True(t, overflow, "a new client is never refused just because the map is full")
		assert.Equal(t, []string{"10.0.0.1", "10.0.0.100", "10.0.0.2"}, slices.Sorted(maps.Keys(lim.entries)))
	})

	t.Run("a flood of fresh keys locks nobody out", func(t *testing.T) {
		// arrange
		start := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
		lim := newLimiter(start)
		lim.maxEntries = 64
		for range lockoutAfterFails {
			lim.failed("10.0.0.1", start)
		}

		// act
		for i := range lim.maxEntries * 4 {
			lim.allow("192.168."+strconv.Itoa(i/256)+"."+strconv.Itoa(i%256), start)
		}

		// assert
		assert.True(t, lim.allow("10.0.0.2", start), "the owner can still reach the login form")
		assert.LessOrEqual(t, lim.size(), lim.maxEntries)
		assert.False(t, lim.allow("10.0.0.1", start), "a lockout is not shaken off by flooding the map")
	})
}

func TestLimiterConcurrent(t *testing.T) {
	// arrange
	start := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	lim := newLimiter(start)
	var wg sync.WaitGroup

	// act
	for i := range 50 {
		wg.Go(func() {
			key := "10.0.0." + strconv.Itoa(i%5)
			lim.allow(key, start)
			lim.failed(key, start)
			lim.reset(key)
			lim.size()
		})
	}
	wg.Wait()

	// assert
	assert.LessOrEqual(t, lim.size(), 5)
}

func TestServiceAllowAndFailed(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{})
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	req := func() *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/login", http.NoBody)
		r.RemoteAddr = "10.0.0.1:34567"
		return r
	}

	// act
	allowed := 0
	for range loginBurst + 3 {
		if svc.Allow(req()) {
			allowed++
		}
	}
	for range lockoutAfterFails {
		svc.Failed(req())
	}
	locked := svc.Allow(req())

	rec := httptest.NewRecorder()
	require.NoError(t, svc.SetCookie(rec, req(), "alice"))
	afterLogin := svc.Allow(req())

	// assert
	assert.Equal(t, loginBurst, allowed)
	assert.False(t, locked)
	assert.True(t, afterLogin, "a successful login clears the record")
}
