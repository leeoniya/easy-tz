import type { Impl } from '../shared/types.ts';

import { getTimeZonesAt as intlSingleFmt } from './04-live-intl/index.ts';
import { getTimeZonesAt as verifiedReps } from './08-verified-sharing/index.ts';
import { getTimeZonesAt as precomputed } from './07-baked-rules/index.ts';
import { getTimeZonesAt as auditedRules } from './10-audited-rules/index.ts';

// all impls memoize the full response per UTC hour bucket (shared/hourCache)
export const impls: Impl[] = [
  {
    id: '04-live-intl',
    label: 'single formatToParts + arithmetic offset + hour-bucket memo',
    features: {
      'staleness risk': 'none (always live)',
      'cold cost': '~40ms',
      'rss': '~26MB',
      'abbr source': 'live CLDR name',
      'offset source': 'live (wall-clock math)',
      'Intl formatters': 'one per zone',
      'generated data': 'none',
      'runtime guard': 'not needed',
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
      'cold cost': '~22ms',
      'rss': '~19MB',
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
    id: '10-audited-rules',
    label: 'baked rule schedule audited against Temporal at first call',
    features: {
      'staleness risk': 'near-none (audited at init)',
      'cold cost': '~2.5ms',
      'rss': '~7.5MB',
      'abbr source': 'baked rule schedule',
      'offset source': 'baked (audited); live for recovered',
      'Intl formatters': 'none',
      'generated data': 'rule schedule + links',
      'runtime guard': 'transition audit at init',
      'staleness healing': 'recovered zones go Temporal-live',
      'year rollover': 'immune (rules re-audited)',
      'Temporal use': 'audit + recovery (else = 07)',
    },
    getTimeZonesAt: auditedRules,
  },
  {
    id: '07-baked-rules',
    label: 'zero-Intl lookup of generated rule schedule',
    features: {
      'staleness risk': 'low: few zones/yr until regen',
      'cold cost': '~0.3ms',
      'rss': '~5.7MB',
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