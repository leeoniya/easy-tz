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
  }) as typeof Intl.DateTimeFormat;
}

export const intlConstructCount = (): number => constructions;
