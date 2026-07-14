// Third-party-library comparison impls: libraries whose BUILT-IN data
// produces real timezone abbreviations (validated by tools/validate-libs.ts)
// with no help from this repo's strategies. Included in the benchmarks and
// size/memory tools for comparison, but NOT in the correctness test suites —
// their bundled tzdata is on the library's release cadence, not ours, and
// their abbreviation conventions legitimately differ from our fixtures
// (e.g. tzdata says "+03" for Europe/Istanbul where we curate TRT).

import type { Impl } from '../shared/types.ts';

import { getTimeZonesAt as momentTz } from './lib-moment-timezone/index.ts';
import { getTimeZonesAt as bigeasyTz } from './lib-bigeasy-timezone/index.ts';
import { getTimeZonesAt as tzSupport } from './lib-timezone-support/index.ts';
import { getTimeZonesAt as tzComplete } from './lib-timezonecomplete/index.ts';

const libFeatures = (via: string): Impl['features'] => ({
  'staleness risk': 'lib release cadence',
  'abbr source': via,
  'offset source': via,
  'Intl formatters': 'none',
  'generated data': via,
  'runtime guard': 'none',
  'staleness healing': 'lib upgrade only',
  'year rollover': 'immune (full tzdata)',
  'Temporal use': 'none',
});

export const libImpls: Impl[] = [
  {
    id: 'lib-moment-timezone',
    label: 'moment-timezone@0.6.2 (bundled tzdata)',
    features: libFeatures('bundled tzdata'),
    getTimeZonesAt: momentTz,
  },
  {
    id: 'lib-timezone-support',
    label: 'timezone-support@3.1.0 (bundled tzdata)',
    features: libFeatures('bundled tzdata'),
    getTimeZonesAt: tzSupport,
  },
  {
    id: 'lib-timezonecomplete',
    label: 'timezonecomplete@5.15.1 (bundled tzdata)',
    features: libFeatures('bundled tzdata'),
    getTimeZonesAt: tzComplete,
  },
  {
    id: 'lib-bigeasy-timezone',
    label: 'timezone@1.0.23 bigeasy (bundled tzdata, 2019 vintage)',
    features: libFeatures('bundled tzdata (2019)'),
    getTimeZonesAt: bigeasyTz,
  },
];
