// The `tzdata` package (timezonecomplete's data dependency) ships raw IANA
// data as JSON with no type declarations.

declare module 'tzdata' {
  const data: unknown;
  export default data;
}
