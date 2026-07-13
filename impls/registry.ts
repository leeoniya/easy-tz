import type { Impl } from '../shared/types.ts';

import { getTimeZonesAt as intlSingleFmt } from './04-intl-single-fmt/index.ts';
import { getTimeZonesAt as precomputed } from './07-precomputed/index.ts';
import { getTimeZonesAt as verifiedReps } from './08-verified-reps/index.ts';
import { getTimeZonesAt as liveOffsets } from './09-live-offsets/index.ts';

export const impls: Impl[] = [
  {
    id: '04-intl-single-fmt',
    label: 'single formatToParts + arithmetic offset + hour-bucket memo',
    notes: 'curated metazone map + initials fallback; 1 Intl call/zone; response memoized per UTC hour bucket',
    getTimeZonesAt: intlSingleFmt,
  },
  {
    id: '08-verified-reps',
    label: 'live Intl + class-table hints verified via Temporal at first call',
    notes: 'shares formatters like 06, but verifies each group with an exact Temporal transition walk and splits diverged members; plain-04 fallback without Temporal',
    getTimeZonesAt: verifiedReps,
  },
  {
    id: '09-live-offsets',
    label: 'baked abbrs (schedule table) + live Temporal offsets',
    notes: 'zero formatters on the fast path; baked labels guarded by live-offset coherence check (stale zones fall back to live Intl); zone-name skew bridged via shared/zoneLinks.ts; full live fallback without Temporal',
    getTimeZonesAt: liveOffsets,
  },
  {
    id: '07-precomputed',
    label: 'zero-Intl lookup of generated year schedule',
    notes: 'year-independent rule schedule baked into shared/schedule.ts (bun run gen); no formatters at all; correct across year rollover except irregular zones; hour-bucket memo',
    getTimeZonesAt: precomputed,
  },
];
