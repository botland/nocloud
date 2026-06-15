import type { RecurringServiceLine } from './cart-services';
import { endOfDayUtc, isBeforeUtcDate, startOfDayUtc } from './promotions';

export type RecurringBillingPhase = {
  /** Inclusive start (YYYY-MM-DD, UTC). */
  fromDate: string;
  /** Inclusive end; omitted when this rate applies until cancelled. */
  untilDate?: string;
  monthlyNet: number;
};

function dayAfterUtc(isoDate: string): string {
  const d = new Date(startOfDayUtc(isoDate));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function dayBeforeUtc(isoDate: string): string {
  const d = new Date(startOfDayUtc(isoDate));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Monthly total for one aggregated line at a given instant (UTC). */
export function lineMonthlyAt(line: RecurringServiceLine, at: Date = new Date()): number {
  const list = line.listPrice ?? line.price;

  if (line.launchFreeUntil) {
    if (isBeforeUtcDate(line.launchFreeUntil, at)) {
      return 0;
    }
    return list;
  }

  if (
    line.promoEndsAt &&
    line.listPrice != null &&
    line.price < line.listPrice &&
    at.getTime() <= endOfDayUtc(line.promoEndsAt)
  ) {
    return line.price;
  }

  return list;
}

export function totalMonthlyAt(lines: RecurringServiceLine[], at: Date = new Date()): number {
  return lines.reduce((sum, line) => sum + lineMonthlyAt(line, at), 0);
}

/** Dates (YYYY-MM-DD) when the combined monthly total may change, sorted ascending. */
export function collectBillingTransitionDates(lines: RecurringServiceLine[]): string[] {
  const dates = new Set<string>();

  for (const line of lines) {
    if (line.launchFreeUntil) {
      dates.add(line.launchFreeUntil);
    }
    if (
      line.promoEndsAt &&
      line.listPrice != null &&
      line.price < line.listPrice
    ) {
      dates.add(dayAfterUtc(line.promoEndsAt));
    }
  }

  return Array.from(dates).sort();
}

/**
 * Build a combined billing schedule for all recurring services (promo + launch windows).
 * Phases with identical totals are merged.
 */
export function buildRecurringBillingSchedule(
  lines: RecurringServiceLine[],
  at: Date = new Date(),
): RecurringBillingPhase[] {
  if (lines.length === 0) return [];

  const transitions = collectBillingTransitionDates(lines);
  const todayIso = at.toISOString().slice(0, 10);

  const futureTransitions = transitions.filter((d) => startOfDayUtc(d) > startOfDayUtc(todayIso));
  const sliceStarts = [todayIso, ...futureTransitions];

  const raw: RecurringBillingPhase[] = [];

  for (let i = 0; i < sliceStarts.length; i++) {
    const fromDate = sliceStarts[i];
    const nextStart = sliceStarts[i + 1];
    const untilDate = nextStart ? dayBeforeUtc(nextStart) : undefined;
    const sample = new Date(`${fromDate}T12:00:00.000Z`);
    const monthlyNet = totalMonthlyAt(lines, sample);

    raw.push({ fromDate, untilDate, monthlyNet });
  }

  if (raw.length === 0) {
    return [{ fromDate: todayIso, monthlyNet: totalMonthlyAt(lines, at) }];
  }

  const merged: RecurringBillingPhase[] = [];
  for (const phase of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.monthlyNet === phase.monthlyNet) {
      prev.untilDate = phase.untilDate;
    } else {
      merged.push({ ...phase });
    }
  }

  return merged;
}