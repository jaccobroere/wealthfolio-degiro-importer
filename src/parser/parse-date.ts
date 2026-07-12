/**
 * DEGIRO date/time → ISO 8601 conversion.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. Uses the platform
 * `Intl.DateTimeFormat` with `Europe/Amsterdam` to derive the correct CET
 * (+01:00) / CEST (+02:00) offset for the given calendar date, so timestamps are
 * deterministic and DST-correct without hardcoding transition rules.
 *
 * Input date is `DD-MM-YYYY`; input time is `HH:MM`.
 */

export class DegiroDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DegiroDateError';
  }
}

const AMSTERDAM_TZ = 'Europe/Amsterdam';

/**
 * Convert a DEGIRO `DD-MM-YYYY` date and `HH:MM` time to an ISO 8601 timestamp
 * with the correct Europe/Amsterdam UTC offset for that date.
 */
export function toIsoDate(ddmmyyyy: string, hhmm: string): string {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(ddmmyyyy.trim());
  if (!m) throw new DegiroDateError(`invalid date "${ddmmyyyy}" (expected DD-MM-YYYY)`);
  const [, dRaw, moRaw, y] = m;
  const d = dRaw.padStart(2, '0');
  const mo = moRaw.padStart(2, '0');
  const datePart = `${y}-${mo}-${d}`;

  const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!tm) throw new DegiroDateError(`invalid time "${hhmm}" (expected HH:MM)`);
  const hh = tm[1].padStart(2, '0');
  const mm = tm[2];

  const offset = amsterdamOffsetForDate(datePart);
  return `${datePart}T${hh}:${mm}:00${offset}`;
}

/**
 * Compute the UTC offset (e.g. `+01:00` or `+02:00`) of Europe/Amsterdam for the
 * given calendar date. Deterministic for a fixed IANA timezone database.
 */
export function amsterdamOffsetForDate(isoDate: string): string {
  // Noon UTC on the target date is unambiguous w.r.t. DST transitions.
  const noonUtc = new Date(`${isoDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AMSTERDAM_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(noonUtc);
  const localHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
  const localMin = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10);
  if (Number.isNaN(localHour) || Number.isNaN(localMin)) {
    throw new DegiroDateError(`cannot resolve Amsterdam offset for ${isoDate}`);
  }
  // Offset in minutes: local noon-equivalent minus 12:00 UTC.
  const offsetMinutes = localHour * 60 + localMin - 12 * 60;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${sign}${oh}:${om}`;
}
