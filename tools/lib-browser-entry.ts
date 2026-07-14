// Browser-bundle entry for the third-party comparison libraries (~4MB of
// bundled tzdata). Kept separate from bench-browser-entry.ts so that pages
// benchmarking this repo's impls never pay this bundle's parse/GC cost.
// Impl 04 (live Intl, ~6KB) is included as the vs-04 baseline.

import type { Impl } from '../shared/types.ts';
import { libImpls } from '../impls/lib-registry.ts';
import { getTimeZonesAt as live04 } from '../impls/04-live-intl/index.ts';
import { installKernel } from './browser-kernel.ts';

const baseline04: Impl = {
  id: '04-live-intl',
  label: 'live Intl baseline',
  features: {},
  getTimeZonesAt: live04,
};

installKernel(libImpls, baseline04);
