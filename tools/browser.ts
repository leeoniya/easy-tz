// Shared helper: locate the locally installed chrome-headless-shell.
// Install/update it with: bun run browsers:install (needs network; the
// scripts that use this helper don't).

import { getInstalledBrowsers, Browser } from '@puppeteer/browsers';

export async function findHeadlessShell(): Promise<string> {
  const cacheDir = new URL('../.browsers', import.meta.url).pathname;
  const installed = (await getInstalledBrowsers({ cacheDir }))
    .filter((b) => b.browser === Browser.CHROMEHEADLESSSHELL)
    .sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }));

  if (installed.length === 0) {
    console.error('chrome-headless-shell not found — run: bun run browsers:install');
    process.exit(1);
  }

  return installed[0]!.executablePath;
}
