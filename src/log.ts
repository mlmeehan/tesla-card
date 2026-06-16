// Single neutral logger for tesla-card (F6 / D6).
//
// The ONE sanctioned place `console.*` is called — every other module routes
// logging through this `log` singleton, which prefixes a neutral `[tesla-card]`
// tag. It carries NO brand colour: no Tesla-red brand hex, no Tesla-red
// `rgb()`/`hsl()` styling — so no trade-dress artefact ships in the console
// (this story removes the old brand-red `%c` startup badge; Story 2.6 adds the
// merge-blocking denylist that keeps it gone). The literal hex is deliberately
// absent even from comments here, so the no-brand gate stays unambiguous.
//
// Leaf module: imports nothing (no `data/`/`flow/`/`components/` edge), keeps
// `no-cycle` trivially green.

const PREFIX = '[tesla-card]';

export const log = {
  info: (...args: unknown[]): void => console.info(PREFIX, ...args),
  warn: (...args: unknown[]): void => console.warn(PREFIX, ...args),
  error: (...args: unknown[]): void => console.error(PREFIX, ...args),
  debug: (...args: unknown[]): void => console.debug(PREFIX, ...args),
};
