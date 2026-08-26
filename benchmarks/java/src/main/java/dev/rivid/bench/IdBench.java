package dev.rivid.bench;

import com.fasterxml.uuid.Generators;
import com.github.f4b6a3.ulid.Ulid;
import com.github.f4b6a3.ulid.UlidCreator;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.openjdk.jmh.annotations.*;

/**
 * Cross-language identifier benchmark — Java suite (JMH).
 *
 * References (pinned in build.gradle):
 *  - ulid-creator 5.2.3  (ULID, monotonic via UlidCreator.getMonotonicUlid)
 *  - java-uuid-generator 5.0.0 (UUIDv4/v7, widely used)
 *
 * JMH handles warmup/forking/statistics; never replace with nanoTime loops
 * (BENCHMARK_METHODOLOGY.md §5). Security: both libs are CSP-seeded.
 */
@State(Scope.Thread)
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1)          // JIT warmup, documented
@Measurement(iterations = 5, time = 1)
@Fork(value = 1, jvmArgs = {"-Xms1g", "-Xmx1g"})
public class IdBench {

    // ── correctness gate ────────────────────────────────────────────────
    @Setup(Level.Trial)
    public void gate() {
        Set<String> seen = new HashSet<>(20_000);
        for (int i = 0; i < 20_000; i++) {
            String u = UlidCreator.getUlid().toString();
            if (!seen.add(u)) throw new AssertionError("ULID uniqueness failed");
            if (u.length() != 26) throw new AssertionError("ULID length wrong");
        }
        UUID v7 = Generators.timeBasedEpochGenerator().generate();
        if (v7.version() != 7) throw new AssertionError("uuidv7 version nibble");
        String prev = "";
        for (int i = 0; i < 10_000; i++) {
            String m = UlidCreator.getMonotonicUlid().toString();
            if (m.compareTo(prev) <= 0) throw new AssertionError("monotonic violation");
            prev = m;
        }
    }

    // ── category A: single string generation ────────────────────────────
    @Benchmark public String ulid_ulidCreator() {
        return UlidCreator.getUlid().toString();
    }

    @Benchmark public String ulid_monotonic_ulidCreator() {
        return UlidCreator.getMonotonicUlid().toString();
    }

    @Benchmark public String uuidv4_jug() {
        return UUID.randomUUID().toString();
    }

    @Benchmark public String uuidv7_jug() {
        return Generators.timeBasedEpochGenerator().generate().toString();
    }

    // ── category F: codec ───────────────────────────────────────────────
    private String sample;

    @Setup(Level.Invocation)
    public void makeSample() { sample = UlidCreator.getUlid().toString(); }

    @Benchmark public long timeExtract_ulid() {
        return Ulid.getTime(sample);
    }
}
