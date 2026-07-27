// Value-asserting tests only mean something when THIS runtime's ICU is the one
// the tables were generated from. Against a table set baked by another runtime
// a "failure" reports provenance rather than a bug, so the suites skip those
// assertions instead — Chrome-generated tables are verified in-browser by
// tools/gen-chrome.ts, in the runtime they describe.
//
// Six suites gate on this and each does something different with the answer
// (skip, test.failing, or filtering the impl list), so only the predicate is
// shared. It takes the meta rather than reading one, so every suite keeps
// checking the provenance of the table IT loads.

export const alignedWith = (meta: { host: string; icu: string | null }): boolean =>
  meta.host === `bun ${Bun.version}` && meta.icu === process.versions.icu;
