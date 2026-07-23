// formatOffset() for the baked impls (07/10): a pure read from the pre-baked
// offset->string lookup (shared/tables/<variant>/offsets.ts).
//
// Unlike the live impls (04/08 — see offsetFormat.ts), a baked resolver only
// ever yields offsets that are in the lookup by construction (the lookup IS the
// set of offsets its schedule + history tables can produce), so the on-the-fly
// formatter is dead weight here. It is deliberately NOT imported, keeping that
// code out of these bundles; a miss (an offset outside the baked set) returns
// '' rather than pulling the formatter back in.

import { offsetStrings } from './offsets.ts';

export function formatOffset(minutes: number): string {
  return offsetStrings.get(minutes) ?? '';
}
