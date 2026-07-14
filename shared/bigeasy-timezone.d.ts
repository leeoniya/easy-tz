// The bigeasy `timezone` package (2019) ships no type declarations.
// Minimal ambient surface for what this repo uses.

declare module 'timezone' {
  type Tz = (ts: number, format: string, zone: string) => string;
  function timezone(zonesData: unknown): Tz;
  export default timezone;
}

declare module 'timezone/zones' {
  const zonesData: unknown;
  export default zonesData;
}
