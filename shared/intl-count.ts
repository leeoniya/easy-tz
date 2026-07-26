// Process-wide Intl.DateTimeFormat construction counter, for benchmark
// reporting that also works for third-party libraries (which construct
// formatters internally, invisible to shared/fmt.ts's own counter). Wraps
// the global constructor in a counting Proxy: `construct` catches
// `new Intl.DateTimeFormat(...)`, `apply` catches the no-new call form.
// Statics (supportedLocalesOf) and instanceof keep working because the
// Proxy target IS the original constructor.
//
// Install BEFORE the first getTimeZonesAt() call (formatter construction is
// lazy in every impl, so installing after module load but before first use
// is sufficient). Not counted: engine-internal formatter caches (e.g.
// Date#toLocaleString) — only public constructor traffic.

let constructions = 0;
let installed = false;

export function installIntlCounter(): void {
  if (installed) {
    return;
  }

  installed = true;

  Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
    construct(target, args, newTarget): object {
      constructions++;
      return Reflect.construct(target, args as unknown[], newTarget) as object;
    },
    apply(target, thisArg, args): unknown {
      constructions++;
      return Reflect.apply(target, thisArg, args as unknown[]);
    },
  });
}

export const intlConstructCount = (): number => constructions;

// ---- formatToParts call counter -----------------------------------------
// Constructions alone don't separate "builds one formatter, then calls it per
// value" (luxon's IANAZone.offset) from "builds a formatter per value"
// (luxon's parseZoneInfo, behind offsetName) — the first is invisible to the
// counter above once the formatter is cached. Patching the prototype method
// counts the per-value Intl work directly. formatToParts is a plain method, so
// a straight assignment is enough; `format` is an accessor and is left alone
// (nothing measured here routes through it).

let partsCalls = 0;
let partsInstalled = false;

export function installIntlPartsCounter(): void {
  if (partsInstalled) {
    return;
  }

  partsInstalled = true;

  const proto = Intl.DateTimeFormat.prototype;
  // read through the descriptor rather than `proto.formatToParts` so the
  // original is never referenced as an unbound method
  const original = Object.getOwnPropertyDescriptor(proto, 'formatToParts')!.value as typeof proto.formatToParts;

  proto.formatToParts = new Proxy(original, {
    apply(target, thisArg, args): Intl.DateTimeFormatPart[] {
      partsCalls++;
      return Reflect.apply(target, thisArg, args as Parameters<typeof original>);
    },
  });
}

export const intlPartsCount = (): number => partsCalls;
