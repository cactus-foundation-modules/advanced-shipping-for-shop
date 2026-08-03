// Pure working-day date maths. No network, no database, no date-fns - native
// Intl only, the same house style as modules/twilio/lib/business-hours.ts.
//
// A "calendar date" throughout is a plain "YYYY-MM-DD" string in the shop's
// timezone. Weekday and calendar arithmetic run through Date.UTC so daylight
// saving never shifts a date across midnight; only the two zone-aware helpers
// (todayInZone, cutoffInstant) touch a real timezone.

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function isValidDate(value: string): boolean {
  return DATE_RE.test(value)
}

// Splits a validated "YYYY-MM-DD" into definite numbers. Callers guard input
// with isValidDate; a malformed string yields NaN parts, which the Date maths
// surfaces rather than hiding.
function ymd(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split('-')
  return [Number(y), Number(m), Number(d)]
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value)
}

// Today's calendar date in a timezone, as "YYYY-MM-DD". en-CA formats that way
// directly; an unknown timezone falls back to UTC rather than throwing.
export function todayInZone(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(now)
  }
}

// The UTC offset (ms) a timezone was at on a given instant, derived by reading
// the instant back as wall-clock parts and diffing. Positive east of UTC.
function zoneOffsetMs(timezone: string, at: Date): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
  } catch {
    return 0
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - at.getTime()
}

// The instant a wall-clock "HH:MM" on calendar date `dateStr` falls at in
// `timezone`. Interprets the wall time as UTC, then corrects by the zone's
// offset at that instant - accurate outside the one ambiguous hour of a DST
// change, which no sensible dispatch cut-off sits in.
export function cutoffInstant(dateStr: string, hhmm: string, timezone: string): Date {
  const [y, m, d] = ymd(dateStr)
  const [hh, mm] = hhmm.split(':')
  const guess = Date.UTC(y, m - 1, d, Number(hh), Number(mm))
  const offset = zoneOffsetMs(timezone, new Date(guess))
  return new Date(guess - offset)
}

// Weekday of a calendar date, 0=Sun .. 6=Sat, read at UTC noon so no zone can
// nudge it either side of midnight.
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = ymd(dateStr)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

// Calendar date `n` days on (n may be negative), as "YYYY-MM-DD".
export function addCalendarDays(dateStr: string, n: number): string {
  const [y, m, d] = ymd(dateStr)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

// A working day is a ship day (courier collects) that is not a holiday. The
// weekend is expressed through shipDays (default Mon-Fri), not hardcoded, so a
// supplier that ships Mon/Wed only is modelled by its shipDays.
export function isWorkingDay(dateStr: string, holidays: Set<string>, shipDays: number[]): boolean {
  return shipDays.includes(weekdayOf(dateStr)) && !holidays.has(dateStr)
}

// The first working day on or after `dateStr`. Returns `dateStr` unchanged when
// it is already a working day.
export function nextWorkingDay(dateStr: string, holidays: Set<string>, shipDays: number[]): string {
  let cursor = dateStr
  // A shop that ships on no day at all would loop forever; bound the search to a
  // little over a year and give up rather than hang.
  for (let i = 0; i < 400; i++) {
    if (isWorkingDay(cursor, holidays, shipDays)) return cursor
    cursor = addCalendarDays(cursor, 1)
  }
  return cursor
}

// `dateStr` advanced by `n` working days. n=0 returns `dateStr` unchanged (it is
// not rolled to a working day - callers that need that call nextWorkingDay
// first). Each step lands on the next ship, non-holiday day.
export function addWorkingDays(dateStr: string, n: number, holidays: Set<string>, shipDays: number[]): string {
  if (n <= 0) return dateStr
  let cursor = dateStr
  let remaining = n
  for (let i = 0; i < 400 && remaining > 0; i++) {
    cursor = addCalendarDays(cursor, 1)
    if (isWorkingDay(cursor, holidays, shipDays)) remaining--
  }
  return cursor
}

// How many working days `addWorkingDays` would need to get from `from` to `to` -
// the exact inverse of it, so a date turned into a day count and back again lands
// where it started. Counts the working days strictly after `from`, up to and
// including `to`; a `to` on or before `from` is 0. Bounded like its inverse, so a
// shop that ships on no day at all gives up rather than hangs.
export function workingDaysBetween(from: string, to: string, holidays: Set<string>, shipDays: number[]): number {
  if (to <= from) return 0
  let cursor = from
  let days = 0
  for (let i = 0; i < 400 && cursor < to; i++) {
    cursor = addCalendarDays(cursor, 1)
    if (isWorkingDay(cursor, holidays, shipDays)) days++
  }
  return days
}

// "Friday 7th of August" - the storefront delivery-line format, spelled out in
// full. Built from the calendar date's own parts (no timezone), so it reads the
// same wherever it renders. This is the "arrives by" date: it is the one a
// shopper reads as a promise, so it says the whole thing rather than an
// abbreviation they have to decode. The deliberately-short `formatDeliveryByLabel`
// below is the one for tight spaces (switch chips, the sticky bar).
export function formatDeliveryDate(dateStr: string): string {
  const [y, m, d] = ymd(dateStr)
  const weekday = WEEKDAY_FULL[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]
  return `${weekday} ${ordinal(d)} of ${MONTH_FULL[m - 1]}`
}

// "10th", "1st", "22nd" - ordinal day of month for the option-label date.
function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

// Whole calendar days from `a` to `b` (both "YYYY-MM-DD"), ignoring time of day.
function calendarDaysBetween(a: string, b: string): number {
  const [ay, am, ad] = ymd(a)
  const [by, bm, bd] = ymd(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

// The delivery-by phrase baked into each cart delivery option's label. Within a
// week the weekday alone is unambiguous ("Monday"). Past a week it needs the
// day of month ("Monday 3rd") so it can't be mistaken for the one three weeks
// away. Past four weeks a bare ordinal could itself repeat across months, so the
// short month is added ("Monday 3rd Aug"). `todayStr` is today's calendar date
// in the shop's timezone.
export function formatDeliveryByLabel(dateStr: string, todayStr: string): string {
  const [y, m, d] = ymd(dateStr)
  const weekday = WEEKDAY_FULL[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]!
  const daysAway = calendarDaysBetween(todayStr, dateStr)
  if (daysAway > 28) {
    return `${weekday} ${ordinal(d)} ${MONTH_LABELS[m - 1]}`
  }
  if (daysAway > 7) {
    return `${weekday} ${ordinal(d)}`
  }
  return weekday
}

// Compares two "YYYY-MM-DD" strings; ISO dates order correctly as plain strings.
export function isBefore(a: string, b: string): boolean {
  return a < b
}

export function laterOf(a: string, b: string): string {
  return a >= b ? a : b
}
