// The bake year's US/EU/AU DST transition edges, probed by two suites:
// tests/schedule.test.ts checks the baked schedule against live 04 on either
// side of each one, tests/classes.test.ts checks that every zone in a class
// still agrees with its representative there.
//
// Shared because they only mean anything as a complete set — the point is to
// cover both hemispheres and all three rule families, and a suite quietly
// carrying five of the six would still pass. The instants are specific to
// BAKE_YEAR (the US shifts to Mar 14 in 2027), so re-baking means recomputing
// these dates, not just bumping the year.

export const BAKE_YEAR = 2026;

export const TRANSITIONS: number[] = [
  Date.UTC(BAKE_YEAR, 2, 8, 7), // US spring-forward
  Date.UTC(BAKE_YEAR, 2, 29, 1), // EU spring-forward
  Date.UTC(BAKE_YEAR, 3, 4, 16), // Sydney fall-back
  Date.UTC(BAKE_YEAR, 9, 3, 16), // Sydney spring-forward
  Date.UTC(BAKE_YEAR, 9, 25, 1), // EU fall-back
  Date.UTC(BAKE_YEAR, 10, 1, 6), // US fall-back
];
