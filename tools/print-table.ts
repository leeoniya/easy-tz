// Single ASCII table printer for all report output (benches, chrome tests,
// mem/size tools). Default alignment: first column (impl/feature name) left,
// value columns right — pass allLeft for text matrices.

// a `null` row renders as a separator line (same dashes as under the header)
export function printTable(headers: string[], rows: (string[] | null)[], allLeft = false): void {
  const dataRows = rows.filter((r): r is string[] => r !== null);
  const widths = headers.map((h, i) => Math.max(h.length, ...dataRows.map((r) => r[i]!.length)));
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');

  const line = (cells: string[]) =>
    cells
      .map((v, i) => (allLeft || i === 0 ? v.padEnd(widths[i]!) : v.padStart(widths[i]!)))
      .join('  ')
      .trimEnd();

  console.log(line(headers));
  console.log(separator);
  for (const r of rows) console.log(r === null ? separator : line(r));
}
