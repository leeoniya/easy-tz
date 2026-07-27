// Resolving "something changed between these two samples" into exact steps.
//
// Shared by the two places that sample a zone on a fixed 15-minute step grid
// and need every change pinned to the step it happened on: tools/gen-core.ts
// (scanAt, building the schedule/history segments) and tools/abbrfix-core.ts
// (the fallback boundary scan). They differ only in what they sample and what
// they do with the answer, so the walk itself lives here — a drift between two
// copies of this would silently misplace transitions rather than fail loudly.

// Sampling positions for a fixed stride, always ending on `lastStep` so a
// change in the final partial window is still bracketed. `stride` is in steps.
export function strideSteps(lastStep: number, stride: number): number[] {
  const out: number[] = [];

  for (let step = stride; step < lastStep; step += stride) out.push(step);

  out.push(lastStep);

  return out;
}

// Samples `valueAt` at each checkpoint (ascending step indices) and resolves
// every change between consecutive samples to its exact step, reporting each
// via `onChange`. `onOpen` receives the value in force at step 0.
//
// The outer loop is what makes multi-change windows safe. Each bisection
// returns the FIRST step differing from `prev`, and the value read AT that step
// becomes the new `prev` — never the value at the far sample, which may sit
// beyond further changes. Asia/Chita 2014 needs this even at a 1-day stride: it
// moves +10 -> +08 at 16:00Z and CLDR's metazone boundary follows an hour
// later, so the signature changes twice inside the hour.
//
// What a stride still cannot see is a window that changes and RETURNS to the
// value it opened on. tools/tz-transition-gap.ts measures that bound.
export function scanChanges(
  valueAt: (step: number) => string,
  checkpoints: Iterable<number>,
  onChange: (step: number, from: string, to: string) => void,
  onOpen?: (value: string) => void
): void {
  let prev = valueAt(0);
  let prevStep = 0; // last resolved step; valueAt(prevStep) === prev

  onOpen?.(prev);

  for (const s of checkpoints) {
    if (s <= prevStep) continue; // callers may propose duplicates

    const cur = valueAt(s);

    while (cur !== prev) {
      let lo = prevStep; // valueAt(lo) === prev
      let hi = s; // valueAt(hi) !== prev

      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;

        if (valueAt(mid) === prev) lo = mid;
        else hi = mid;
      }

      const from = prev;

      prev = hi === s ? cur : valueAt(hi); // `cur` already holds step s
      onChange(hi, from, prev);
      prevStep = hi; // strictly advances, so this terminates
    }

    prevStep = s;
  }
}
