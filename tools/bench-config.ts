// Shared parameters for the single-zone getTimeZoneAt() benchmark, so the bun
// (bench/bench.ts) and Chrome (tools/browser-kernel.ts) passes measure the same
// workload: one DST zone resolved at GETONE_CALLS timestamps stepping across
// many DST transitions, timed once anchored in the projected present (schedule
// path for the baked impls) and once in a historical year (which routes 07/10
// through the baked era resolver, or live Temporal for 10 in Chrome).
//
// A DST zone is deliberately chosen: static zones resolve in a couple of array
// reads, whereas a two-state zone exercises the per-call rule-instant math that
// dominates the single-zone cost.

const HOUR_MS = 3_600_000;

export const GETONE_ZONE = 'America/New_York';
export const GETONE_CALLS = 10_000;
export const GETONE_STEP_MS = 6 * HOUR_MS; // 10000 * 6h ≈ 6.8 years per sweep
export const GETONE_STEP_HOURS = GETONE_STEP_MS / HOUR_MS;
export const GETONE_CUR_BASE = Date.UTC(2026, 0, 1); // bake year onward
export const GETONE_HIST_BASE = Date.UTC(2000, 0, 1); // within the 1995+ era window

// --- adaptive sampling for the per-call miss/hist loops --------------------
// Sample counts are budgeted rather than fixed. Measured over 7 repeats at
// n = 5, 7, 9, 13, 25, the run-to-run spread of the reported median is the same
// at every n (±6% for a ~100ms/call library, ±47-53% for a ~3ms one), because
// the noise is ambient system load BETWEEN runs rather than variation within
// one. Extra samples therefore buy no accuracy and only cost wall time.
//
// The budget self-targets: at a few ms/call an impl still takes every one of
// MAX samples (they're nearly free), while a ~100ms/call library stops at MIN —
// and those slow libraries are exactly where the old fixed 25-sample loops
// spent the bulk of the benchmark's runtime.

export interface SampleBudget {
  min: number; // always take at least this many, however slow
  max: number; // never take more, however cheap
  budgetMs: number; // stop past `min` once this much wall time is spent
}

export const MISS_SAMPLES: SampleBudget = { min: 5, max: 25, budgetMs: 150 };

// Untimed priming ahead of each measured loop (JIT, formatter caches, memo
// paths), capped the same way so a ~100ms/call library doesn't spend a second
// warming up. Run once per era, since the current-year and historical routes
// differ for the rule-baking impls.
export const WARMUP_SAMPLES: SampleBudget = { min: 2, max: 5, budgetMs: 50 };

// Runs `call(i)` under `budget`, returning the per-call times in ms. `now` is
// injected because the two passes have different clocks (Bun.nanoseconds() vs
// performance.now(), the latter coarsened to ~100µs by Chrome — which only
// means sub-100µs impls read as 0 and so always take `max` samples).
export function sampleTimes(now: () => number, call: (i: number) => void, budget: SampleBudget): number[] {
  const times: number[] = [];
  let spent = 0;

  for (let i = 0; i < budget.max; i++) {
    const t0 = now();
    call(i);
    const dt = now() - t0;

    times.push(dt);
    spent += dt;

    if (times.length >= budget.min && spent >= budget.budgetMs) break;
  }

  return times;
}

export function median(times: number[]): number {
  return times.toSorted((a, b) => a - b)[times.length >> 1]!;
}

// --- steady-state passes for the single-zone sweeps ------------------------
// The sweeps report the FASTEST of several repeated passes, not a single timing,
// because a lone timing measures the engine's JIT ramp more than the impl.
//
// Both engines allocate type feedback per CALL SITE, so a separate warm-up loop
// trains different feedback slots than the timed loop: V8's --trace-deopt shows
// the timed loop bailing out with "Insufficient type feedback for generic named
// access" however long the warm-up ran, and in bun a 5000-iteration warm-up
// still left the first pass at 53.8ms against a 2.3ms steady state. Only
// re-running the timed loop itself can fix that — hence passes, not warm-up.
//
// The ramp's cost is roughly fixed, so it swamped the cheap impls: measured
// against steady state, the baked impls read 4-5x high in Chrome and 10-25x
// high in bun, while the Intl-bound impls (whose own work dominates) were only
// ~10% high. The budget self-targets the same way MISS_SAMPLES does: a ~1ms
// sweep takes every pass (they're nearly free, and it needs them — at that
// scale scheduling jitter rivals the signal), while a ~47ms sweep stops early.
// min 3 rather than 2 because JSC converges slowly on the Intl-bound sweeps
// (~60ms/pass): two passes left them ~20% above steady state, three gets within
// ~12%, and V8 already takes 3-4 within this budget so it costs the primary pass
// nothing. 200ms rather than 150 because at 150 the ~24ms/pass sweep (10's
// historical route through live Temporal) stopped at 6 passes and read ~5% high;
// 200 gets every sub-25ms sweep to `max`, for +250ms on the Chrome pass. Beyond
// that the budget buys nothing measurable: across 3 runs each at 150/200/250ms
// the Intl-bound sweeps landed 45.3-47.7 / 42.8-45.4 / 44.2-45.9ms, all inside
// the run-to-run spread.
export const SWEEP_PASSES: SampleBudget = { min: 3, max: 8, budgetMs: 200 };

// Runs `pass` (one full timed sweep, returning its own elapsed ms) repeatedly
// under `budget` and reports the fastest — the pass where the engine has fully
// tiered up. The minimum rather than the median: the slow passes are ramp and
// ambient interference, both of which only ever add time.
export function steadyState(pass: () => number, budget: SampleBudget): { ms: number; passes: number } {
  let best = Infinity;
  let spent = 0;
  let passes = 0;

  while (passes < budget.max) {
    const ms = pass();

    passes++;
    spent += ms;
    if (ms < best) best = ms;

    if (passes >= budget.min && spent >= budget.budgetMs) break;
  }

  return { ms: best, passes };
}

// how the sample counts are described in the report headers
export const SAMPLING_NOTE = `miss samples: ${MISS_SAMPLES.min}-${MISS_SAMPLES.max} (${MISS_SAMPLES.budgetMs}ms budget/loop)`;
export const SWEEP_NOTE =
  `sweeps: fastest of ${SWEEP_PASSES.min}-${SWEEP_PASSES.max} passes ` +
  `(${SWEEP_PASSES.budgetMs}ms budget/era), discarding the JIT ramp`;
