// ─────────────────────────────────────────────────────
// Slot computation engine
// ─────────────────────────────────────────────────────

import type { TimeSlot, SlotsByDate } from "./types";
import {
  getRulesByResource,
  getOverridesByResource,
  cleanExpiredHolds,
} from "./db.server";

/** Parse "HH:MM" → minutes from midnight */
function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Format minutes from midnight → "HH:MM" */
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → JS Date at midnight UTC */
function dateFromString(d: string): Date {
  const [y, mo, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, day));
}

/** JS Date → "YYYY-MM-DD" */
function dateToString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add `days` days to a date string */
function addDays(d: string, days: number): string {
  const dt = dateFromString(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dateToString(dt);
}

/** "YYYY-MM-DD" + "HH:MM" → Unix seconds */
function toUnixSeconds(date: string, timeMinutes: number): number {
  const base = dateFromString(date).getTime() / 1000;
  return base + timeMinutes * 60;
}

interface BookedWindow {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Generate all slot time blocks for a single resource on a single day,
 * filtering out windows that are already booked or held.
 */
function generateDaySlots(
  date: string,
  dayStart: number,
  dayEnd: number,
  durationMinutes: number,
  bookedWindows: BookedWindow[]
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (
    let start = dayStart;
    start + durationMinutes <= dayEnd;
    start += durationMinutes
  ) {
    const end = start + durationMinutes;
    const available = !bookedWindows.some(
      (w) => w.startMinutes < end && w.endMinutes > start
    );
    slots.push({
      date,
      startMinutes: start,
      endMinutes: end,
      startTime: formatTime(start),
      endTime: formatTime(end),
      available,
    });
  }
  return slots;
}

/**
 * Get booked/held windows for a resource on a given date from D1.
 * Returns windows as { startMinutes, endMinutes } in local-day minutes.
 */
async function getOccupiedWindows(
  db: D1Database,
  resourceId: string,
  date: string
): Promise<BookedWindow[]> {
  const dayStartTs = dateFromString(date).getTime() / 1000;
  const dayEndTs = dayStartTs + 86400;

  // Active bookings overlapping this day
  const bookingResult = await db
    .prepare(
      `SELECT b.start_at, b.end_at
       FROM bookings b
       JOIN booking_resources br ON br.booking_id = b.id
       WHERE br.resource_id = ?
         AND b.status = 'confirmed'
         AND b.start_at < ?
         AND b.end_at > ?`
    )
    .bind(resourceId, dayEndTs, dayStartTs)
    .all<{ start_at: number; end_at: number }>();

  // Active (non-expired) holds overlapping this day
  const now = Math.floor(Date.now() / 1000);
  const holdResult = await db
    .prepare(
      `SELECT sh.start_at, sh.end_at, sh.resource_ids
       FROM slot_holds sh
       WHERE sh.expires_at > ?
         AND sh.start_at < ?
         AND sh.end_at > ?`
    )
    .bind(now, dayEndTs, dayStartTs)
    .all<{ start_at: number; end_at: number; resource_ids: string }>();

  const windows: BookedWindow[] = [];
  const dayBase = dayStartTs;

  for (const row of bookingResult.results) {
    windows.push({
      startMinutes: Math.floor((row.start_at - dayBase) / 60),
      endMinutes: Math.ceil((row.end_at - dayBase) / 60),
    });
  }

  for (const row of holdResult.results) {
    const ids: string[] = JSON.parse(row.resource_ids);
    if (ids.includes(resourceId)) {
      windows.push({
        startMinutes: Math.floor((row.start_at - dayBase) / 60),
        endMinutes: Math.ceil((row.end_at - dayBase) / 60),
      });
    }
  }

  return windows;
}

/**
 * Compute available slots for a list of resources over a date range.
 * Returns only slots where ALL requested resources are available.
 *
 * @param db D1Database
 * @param resourceIds resource IDs to check (intersection)
 * @param weekStart "YYYY-MM-DD" — start of the week to show
 * Slot duration is read from each resource's `slot_duration` column.
 * All supplied resourceIds must share the same slot_duration; the first one wins.
 */
export async function getAvailableSlots(
  db: D1Database,
  resourceIds: string[],
  weekStart: string,
  durationMinutes?: number  // optional override; normally comes from resource.slot_duration
): Promise<SlotsByDate> {
  // Clean up expired holds lazily
  await cleanExpiredHolds(db);

  const result: SlotsByDate = {};

  // Build a 7-day window
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(addDays(weekStart, i));
  }

  // Look up slot_duration from the first resource if not supplied
  let slotDuration = durationMinutes ?? 60;
  if (!durationMinutes && resourceIds.length > 0) {
    const row = await db
      .prepare("SELECT slot_duration FROM resources WHERE id = ?")
      .bind(resourceIds[0])
      .first<{ slot_duration: number }>();
    if (row) slotDuration = row.slot_duration;
  }

  // Pre-fetch rules + overrides for each resource
  const rulesPerResource = await Promise.all(
    resourceIds.map((id) => getRulesByResource(db, id))
  );
  const overridesPerResource = await Promise.all(
    resourceIds.map((id) => getOverridesByResource(db, id))
  );

  for (const date of dates) {
    const dayOfWeek = dateFromString(date).getUTCDay();

    // For each resource, collect available time windows
    const resourceAvailableSlotSets: TimeSlot[][] = [];

    for (let ri = 0; ri < resourceIds.length; ri++) {
      const rules = rulesPerResource[ri];
      const overrides = overridesPerResource[ri];
      const resourceId = resourceIds[ri];

      // Check override first
      const override = overrides.find((o) => o.date === date);

      let dayStart: number | null = null;
      let dayEnd: number | null = null;

      if (override) {
        if (override.is_blocked) {
          resourceAvailableSlotSets.push([]);
          continue;
        }
        if (override.start_time && override.end_time) {
          dayStart = parseTime(override.start_time);
          dayEnd = parseTime(override.end_time);
        }
      }

      if (dayStart === null) {
        // Fall back to recurring rule
        const rule = rules.find((r) => r.day_of_week === dayOfWeek);
        if (!rule) {
          resourceAvailableSlotSets.push([]);
          continue;
        }
        dayStart = parseTime(rule.start_time);
        dayEnd = parseTime(rule.end_time);
      }

      if (dayStart === null || dayEnd === null) {
        resourceAvailableSlotSets.push([]);
        continue;
      }

      const occupied = await getOccupiedWindows(db, resourceId, date);
      const slots = generateDaySlots(date, dayStart, dayEnd, slotDuration, occupied);
      resourceAvailableSlotSets.push(slots);
    }

    if (resourceAvailableSlotSets.length === 0) {
      result[date] = [];
      continue;
    }

    // Intersection: a slot is available only if ALL resources have it available
    const reference = resourceAvailableSlotSets[0];
    const intersected = reference.map((slot) => {
      const allAvailable = resourceAvailableSlotSets.every((set) =>
        set.some((s) => s.startMinutes === slot.startMinutes && s.available)
      );
      return { ...slot, available: allAvailable };
    });

    result[date] = intersected;
  }

  return result;
}

/**
 * Compute available slots for each resource independently (no intersection).
 * Returns a map of resourceId → SlotsByDate.
 */
export async function getSlotsByResource(
  db: D1Database,
  resourceIds: string[],
  weekStart: string,
  durationMinutes?: number
): Promise<{ [resourceId: string]: SlotsByDate }> {
  const result: { [resourceId: string]: SlotsByDate } = {};
  await Promise.all(
    resourceIds.map(async (id) => {
      result[id] = await getAvailableSlots(db, [id], weekStart, durationMinutes);
    })
  );
  return result;
}

/**
 * Convert a slot (date + startMinutes + durationMinutes) to Unix timestamps.
 */
export function slotToTimestamps(
  date: string,
  startMinutes: number,
  durationMinutes: number
): { startAt: number; endAt: number } {
  const startAt = toUnixSeconds(date, startMinutes);
  const endAt = startAt + durationMinutes * 60;
  return { startAt, endAt };
}
