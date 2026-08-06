// Whether a benchmark run includes the third-party comparison libraries
// (impls/lib-registry.ts). Off by default because they dominate the runtime
// while their numbers only move when package.json is bumped: measuring the
// five libraries costs ~83% of a full run (timezonecomplete alone ~40%, at
// ~100ms per getTimeZonesAt() miss, and in Chrome every library page must
// parse the ~4.3MB combined tzdata bundle). Skipping them takes a run from
// ~37s to ~6s, which is what the dev loop wants; `--libs` restores the full
// comparison for README/comparison.md refreshes and dependency bumps.
//
// Host-only (reads process.argv), so it must stay out of bench-config.ts —
// that module is imported by browser-kernel.ts and bundled for the browser.

export const withLibs: boolean = process.argv.includes('--libs');

// Whether to run the supplementary bun pass (bench/bench.ts) alongside the
// Chrome one. Off by default for the same reason: Chrome is the deployment
// target and the primary report, whereas the bun pass exists as a fast proxy
// for the no-Temporal (Safari) fallback paths — useful, but a third of the
// default run's wall time for numbers that are JSC's rather than a browser's.
// Correctness of those fallback paths is covered by `bun run test` regardless.
// Only read by tools/bench-all.ts; running bench/bench.ts directly always
// performs the pass.
export const withBun: boolean = process.argv.includes('--bun');
