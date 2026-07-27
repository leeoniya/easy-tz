// Both year-range scripts (tools/probe-equiv.ts, tools/tz-transition-gap.ts)
// accept the same CLI shape: [fromYear] [toYear] [--local]. Defaults run
// through the bake year + 2, the full span either table variant draws from.
// `args` comes back so callers can read their own extra flags off it.

export interface YearRangeArgs {
  args: string[];
  local: boolean;
  fromYear: number;
  toYear: number;
}

export function parseYearRange(defaultFrom: number): YearRangeArgs {
  const args = process.argv.slice(2);
  const years = args.filter((a) => /^\d{4}$/.test(a)).map(Number);
  const fromYear = years[0] ?? defaultFrom;
  const toYear = years[1] ?? new Date().getUTCFullYear() + 2;

  if (fromYear > toYear) {
    console.error(`from year ${fromYear} > to year ${toYear}`);
    process.exit(1);
  }

  return { args, local: args.includes('--local'), fromYear, toYear };
}
