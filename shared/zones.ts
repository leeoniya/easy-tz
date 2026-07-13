// canonical IANA zone list from the runtime's own tz database.
// computed once at module load; the list does not change at runtime.
export const zones: readonly string[] = Intl.supportedValuesOf('timeZone');
