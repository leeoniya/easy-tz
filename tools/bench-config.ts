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
