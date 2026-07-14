import type { Impl } from '../shared/types.ts';

import { getTimeZonesAt as intlSingleFmt } from './04-live-intl/index.ts';
import { getTimeZonesAt as verifiedReps } from './08-verified-sharing/index.ts';
import { getTimeZonesAt as liveOffsets } from './09-guarded-hybrid/index.ts';
import { getTimeZonesAt as precomputed } from './07-baked-rules/index.ts';

// all impls memoize the full response per UTC hour bucket (shared/hourCache)
export const impls: Impl[] = [
  {
    id: '04-live-intl',
    label: 'single formatToParts + arithmetic offset + hour-bucket memo',
    features: {
      'staleness risk': 'none (always live)',
      'cold cost': '~65ms (~130x of 07)',
      'abbr source': 'live CLDR name',
      'offset source': 'live (wall-clock math)',
      'Intl formatters': 'one per zone',
      'generated data': 'none',
      'runtime guard': '- (is the baseline)',
      'staleness healing': 'always live',
      'year rollover': 'immune',
      'Temporal use': 'none',
    },
    getTimeZonesAt: intlSingleFmt,
  },
  {
    id: '08-verified-sharing',
    label: 'live Intl + class-table hints verified via Temporal at first call',
    features: {
      'staleness risk': 'near-none (rename corner)',
      'cold cost': '~35ms (~70x of 07)',
      'abbr source': 'live CLDR name (shared rep)',
      'offset source': 'live (wall-clock math)',
      'Intl formatters': 'one per verified group',
      'generated data': 'class groups (hints)',
      'runtime guard': 'transition walk at init',
      'staleness healing': 'diverged groups split',
      'year rollover': 'immune (re-verifies)',
      'Temporal use': 'fast path (else = 04)',
    },
    getTimeZonesAt: verifiedReps,
  },
  {
    id: '09-guarded-hybrid',
    label: 'baked abbrs (rule schedule) + live Temporal offsets',
    features: {
      'staleness risk': 'near-none (stale goes live)',
      'cold cost': '~2ms (~4x of 07)',
      'abbr source': 'baked rule schedule',
      'offset source': 'live (Temporal)',
      'Intl formatters': 'fallback zones only',
      'generated data': 'rule schedule + links',
      'runtime guard': 'offset coherence per call',
      'staleness healing': 'stale zones go live',
      'year rollover': 'immune (rules + guard)',
      'Temporal use': 'fast path (else = 04)',
    },
    getTimeZonesAt: liveOffsets,
  },
  {
    id: '07-baked-rules',
    label: 'zero-Intl lookup of generated rule schedule',
    features: {
      'staleness risk': 'low: few zones/yr until regen',
      'cold cost': '~0.5ms (1x)',
      'abbr source': 'baked rule schedule',
      'offset source': 'baked rule schedule',
      'Intl formatters': 'none',
      'generated data': 'rule schedule + links',
      'runtime guard': 'none',
      'staleness healing': 'regeneration only',
      'year rollover': 'rules hold (4 zones clamp)',
      'Temporal use': 'none',
    },
    getTimeZonesAt: precomputed,
  },
];