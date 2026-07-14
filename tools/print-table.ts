// Single ASCII table printer for all report output (benches, chrome tests,
// mem/size tools). Default alignment: first column (impl/feature name) left,
// value columns right — pass allLeft for text matrices.

export function printTable(headers: string[], rows: string[][], allLeft = false): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));

  const line = (cells: string[]) =>
    cells
      .map((v, i) => (allLeft || i === 0 ? v.padEnd(widths[i]!) : v.padStart(widths[i]!)))
      .join('  ')
      .trimEnd();

  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}
