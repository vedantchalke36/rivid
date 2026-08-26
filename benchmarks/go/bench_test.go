// Cross-language identifier benchmark — Go suite (testing.B).
//
// Executes the central spec workloads against mature Go implementations:
//   - oklog/ulid/v2 (ULID; both secure crypto/rand and non-secure flag shown)
//   - google/uuid   (UUIDv4, UUIDv7)
//
// The runner detects the Go toolchain and invokes:
//   go test -bench . -benchmem -run '^$'
//
// Security note: oklog/ulid supports insecure entropy sources; we benchmark
// BOTH and label them separately per BENCHMARK_METHODOLOGY.md §6.
package gobench

import (
	"crypto/rand"
	"fmt"
	"testing"

	"github.com/google/uuid"
	oklog "github.com/oklog/ulid/v2"
)

// ── correctness gate ─────────────────────────────────────────────────────

func TestCorrectnessGate(t *testing.T) {
	seen := make(map[oklog.ULID]struct{}, 10000)
	for i := 0; i < 10000; i++ {
		u, err := oklog.New(oklog.Now(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		if _, dup := seen[u]; dup {
			t.Fatal("uniqueness failure")
		}
		seen[u] = struct{}{}
		if len(u.String()) != 26 {
			t.Fatalf("bad length: %s", u.String())
		}
	}
	v7 := uuid.Must(uuid.NewV7())
	if v7.Version() != 7 {
		t.Fatalf("uuidv7 version nibble wrong: %v", v7.Version())
	}
}

// ── single generation (category A) ───────────────────────────────────────

func BenchmarkSingleUlidOklogSecure(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = oklog.MustNew(oklog.Now(), rand.Reader).String()
	}
}

func BenchmarkSingleUuidV4Google(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = uuid.New().String()
	}
}

func BenchmarkSingleUuidV7Google(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = uuid.NewV7()
	}
}

// ── bulk generation (category B) ─────────────────────────────────────────

var sizes = []int{1000, 10000, 100000}

func BenchmarkBulkUlidOklog(b *testing.B) {
	for _, n := range sizes {
		b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				t := oklog.Now()
				out := make([]string, n)
				var err error
				for j := range out {
					var id oklog.ULID
					id, err = oklog.New(t, rand.Reader)
					if err != nil {
						b.Fatal(err)
					}
					out[j] = id.String()
				}
			}
		})
	}
}

// ── codec (category F) ───────────────────────────────────────────────────

func BenchmarkDecodeUlidOklog(b *testing.B) {
	id := oklog.MustNew(oklog.Now(), rand.Reader)
	s := id.String()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = oklog.Parse(s)
	}
}

func BenchmarkValidateUlidOklog(b *testing.B) {
	s := oklog.MustNew(oklog.Now(), rand.Reader).String()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = oklog.ParseStrict(s)
	}
}
