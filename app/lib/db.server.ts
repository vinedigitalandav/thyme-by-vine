// ─────────────────────────────────────────────────────
// Typed D1 query helpers
// ─────────────────────────────────────────────────────

import type {
  Owner,
  Resource,
  AvailabilityRule,
  AvailabilityOverride,
  Booking,
  GoogleCalendarConnection,
} from "./types";

// ── Owners ──────────────────────────────────────────

export async function getOwnerByEmail(
  db: D1Database,
  email: string
): Promise<Owner | null> {
  return db
    .prepare("SELECT * FROM owners WHERE email = ?")
    .bind(email.toLowerCase().trim())
    .first<Owner>();
}

export async function getOwnerBySlug(
  db: D1Database,
  slug: string
): Promise<Owner | null> {
  return db
    .prepare("SELECT * FROM owners WHERE slug = ?")
    .bind(slug)
    .first<Owner>();
}

export async function getOwnerById(
  db: D1Database,
  id: string
): Promise<Owner | null> {
  return db
    .prepare("SELECT * FROM owners WHERE id = ?")
    .bind(id)
    .first<Owner>();
}

export async function createOwner(
  db: D1Database,
  id: string,
  name: string,
  email: string,
  passwordHash: string,
  slug: string
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO owners (id, name, email, password_hash, slug) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id, name, email.toLowerCase().trim(), passwordHash, slug)
    .run();
}

export async function updateOwner(
  db: D1Database,
  id: string,
  fields: Partial<Pick<Owner, "name" | "email" | "password_hash" | "timezone">>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k]) => `${k} = ?`).join(", ");
  await db
    .prepare(`UPDATE owners SET ${set} WHERE id = ?`)
    .bind(...entries.map(([, v]) => v), id)
    .run();
}

export async function getOwnerByClerkId(
  db: D1Database,
  clerkId: string
): Promise<Owner | null> {
  return db
    .prepare("SELECT * FROM owners WHERE clerk_id = ?")
    .bind(clerkId)
    .first<Owner>();
}

export async function createOwnerFromClerk(
  db: D1Database,
  id: string,
  clerkId: string,
  name: string,
  email: string,
  slug: string
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO owners (id, clerk_id, name, email, password_hash, slug) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, clerkId, name, email.toLowerCase().trim(), "", slug)
    .run();
}

// ── Resources ────────────────────────────────────────

export async function getResourcesByOwner(
  db: D1Database,
  ownerId: string
): Promise<Resource[]> {
  const result = await db
    .prepare(
      "SELECT * FROM resources WHERE owner_id = ? ORDER BY created_at ASC"
    )
    .bind(ownerId)
    .all<Resource>();
  return result.results;
}

export async function getActiveResourcesByOwner(
  db: D1Database,
  ownerId: string
): Promise<Resource[]> {
  const result = await db
    .prepare(
      "SELECT * FROM resources WHERE owner_id = ? AND is_active = 1 ORDER BY created_at ASC"
    )
    .bind(ownerId)
    .all<Resource>();
  return result.results;
}

export async function getResourceById(
  db: D1Database,
  id: string,
  ownerId: string
): Promise<Resource | null> {
  return db
    .prepare("SELECT * FROM resources WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first<Resource>();
}

export async function createResource(
  db: D1Database,
  id: string,
  ownerId: string,
  name: string,
  description: string | null,
  slotDuration = 60,
  pricePerSlot = 0,
  color = "#3b82f6"
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO resources (id, owner_id, name, description, slot_duration, price_per_slot, color) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, ownerId, name, description, slotDuration, pricePerSlot, color)
    .run();
}

export async function updateResource(
  db: D1Database,
  id: string,
  ownerId: string,
  fields: Partial<Pick<Resource, "name" | "description" | "is_active" | "slot_duration" | "price_per_slot" | "color">>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k]) => `${k} = ?`).join(", ");
  await db
    .prepare(`UPDATE resources SET ${set} WHERE id = ? AND owner_id = ?`)
    .bind(...entries.map(([, v]) => v), id, ownerId)
    .run();
}

export async function deleteResource(
  db: D1Database,
  id: string,
  ownerId: string
): Promise<void> {
  // Verify ownership before deleting
  const exists = await db
    .prepare("SELECT id FROM resources WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first<{ id: string }>();
  if (!exists) return;

  // Manually remove child rows that lack ON DELETE CASCADE
  await db.prepare("DELETE FROM booking_resources WHERE resource_id = ?").bind(id).run();
  await db.prepare("DELETE FROM availability_rules WHERE resource_id = ?").bind(id).run();
  await db.prepare("DELETE FROM availability_overrides WHERE resource_id = ?").bind(id).run();
  await db.prepare("DELETE FROM resources WHERE id = ?").bind(id).run();
}

// ── Availability Rules ───────────────────────────────

export async function getRulesByResource(
  db: D1Database,
  resourceId: string
): Promise<AvailabilityRule[]> {
  const result = await db
    .prepare(
      "SELECT * FROM availability_rules WHERE resource_id = ? ORDER BY day_of_week ASC"
    )
    .bind(resourceId)
    .all<AvailabilityRule>();
  return result.results;
}

export async function upsertAvailabilityRule(
  db: D1Database,
  id: string,
  resourceId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  slotDurations: number[]
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO availability_rules (id, resource_id, day_of_week, start_time, end_time, slot_durations)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(resource_id, day_of_week) DO UPDATE SET
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         slot_durations = excluded.slot_durations`
    )
    .bind(id, resourceId, dayOfWeek, startTime, endTime, JSON.stringify(slotDurations))
    .run();
}

export async function deleteAvailabilityRule(
  db: D1Database,
  resourceId: string,
  dayOfWeek: number
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM availability_rules WHERE resource_id = ? AND day_of_week = ?"
    )
    .bind(resourceId, dayOfWeek)
    .run();
}

// ── Availability Overrides ───────────────────────────

export async function getOverridesByResource(
  db: D1Database,
  resourceId: string
): Promise<AvailabilityOverride[]> {
  const result = await db
    .prepare(
      "SELECT * FROM availability_overrides WHERE resource_id = ? ORDER BY date ASC"
    )
    .bind(resourceId)
    .all<AvailabilityOverride>();
  return result.results;
}

export async function upsertAvailabilityOverride(
  db: D1Database,
  id: string,
  resourceId: string,
  date: string,
  isBlocked: boolean,
  startTime: string | null,
  endTime: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO availability_overrides (id, resource_id, date, is_blocked, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(resource_id, date) DO UPDATE SET
         is_blocked = excluded.is_blocked,
         start_time = excluded.start_time,
         end_time = excluded.end_time`
    )
    .bind(id, resourceId, date, isBlocked ? 1 : 0, startTime, endTime)
    .run();
}

export async function deleteAvailabilityOverride(
  db: D1Database,
  resourceId: string,
  date: string
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM availability_overrides WHERE resource_id = ? AND date = ?"
    )
    .bind(resourceId, date)
    .run();
}

// ── Bookings ─────────────────────────────────────────

export async function getBookingsByOwner(
  db: D1Database,
  ownerId: string,
  opts?: { resourceId?: string; status?: string; limit?: number; offset?: number }
): Promise<Booking[]> {
  let sql = `
    SELECT b.*, GROUP_CONCAT(r.id) as resource_ids, GROUP_CONCAT(r.name) as resource_names
    FROM bookings b
    LEFT JOIN booking_resources br ON br.booking_id = b.id
    LEFT JOIN resources r ON r.id = br.resource_id
    WHERE b.owner_id = ?`;
  const bindings: (string | number)[] = [ownerId];
  if (opts?.status) { sql += " AND b.status = ?"; bindings.push(opts.status); }
  if (opts?.resourceId) { sql += " AND br.resource_id = ?"; bindings.push(opts.resourceId); }
  sql += " GROUP BY b.id ORDER BY b.start_at DESC";
  if (opts?.limit) { sql += " LIMIT ?"; bindings.push(opts.limit); }
  if (opts?.offset) { sql += " OFFSET ?"; bindings.push(opts.offset); }
  const result = await db.prepare(sql).bind(...bindings).all<Booking>();
  return result.results;
}

export async function getBookingById(
  db: D1Database,
  id: string
): Promise<Booking | null> {
  return db
    .prepare(
      `SELECT b.*, GROUP_CONCAT(r.id) as resource_ids, GROUP_CONCAT(r.name) as resource_names
       FROM bookings b
       LEFT JOIN booking_resources br ON br.booking_id = b.id
       LEFT JOIN resources r ON r.id = br.resource_id
       WHERE b.id = ?
       GROUP BY b.id`
    )
    .bind(id)
    .first<Booking>();
}

export async function createBooking(
  db: D1Database,
  id: string,
  ownerId: string,
  bookerName: string,
  bookerEmail: string,
  note: string | null,
  startAt: number,
  endAt: number,
  durationMinutes: number,
  resourceIds: string[],
  status: "pending_confirmation" | "confirmed" = "confirmed",
  confirmationToken: string | null = null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO bookings (id, owner_id, booker_name, booker_email, note, start_at, end_at, duration_minutes, status, confirmation_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, ownerId, bookerName, bookerEmail, note, startAt, endAt, durationMinutes, status, confirmationToken)
    .run();
  for (const resourceId of resourceIds) {
    await db
      .prepare("INSERT INTO booking_resources (booking_id, resource_id) VALUES (?, ?)")
      .bind(id, resourceId)
      .run();
  }
}

export async function confirmBookingByToken(
  db: D1Database,
  token: string
): Promise<Booking | null> {
  const booking = await db
    .prepare(
      "UPDATE bookings SET status = 'confirmed', confirmation_token = NULL WHERE confirmation_token = ? AND status = 'pending_confirmation' RETURNING *"
    )
    .bind(token)
    .first<Booking>();
  return booking ?? null;
}

export async function cancelBooking(
  db: D1Database,
  id: string,
  ownerId: string
): Promise<Booking | null> {
  const booking = await db
    .prepare(
      "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND owner_id = ? RETURNING *"
    )
    .bind(id, ownerId)
    .first<Booking>();
  return booking ?? null;
}

export async function setBookingGoogleEventId(
  db: D1Database,
  id: string,
  googleEventId: string
): Promise<void> {
  await db
    .prepare("UPDATE bookings SET google_event_id = ? WHERE id = ?")
    .bind(googleEventId, id)
    .run();
}

// ── Slot Holds ───────────────────────────────────────

export async function cleanExpiredHolds(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("DELETE FROM slot_holds WHERE expires_at <= ?")
    .bind(now)
    .run();
}

// ── Google Calendar ──────────────────────────────────

export async function getGCalConnection(
  db: D1Database,
  ownerId: string
): Promise<GoogleCalendarConnection | null> {
  return db
    .prepare(
      "SELECT * FROM google_calendar_connections WHERE owner_id = ?"
    )
    .bind(ownerId)
    .first<GoogleCalendarConnection>();
}

export async function upsertGCalConnection(
  db: D1Database,
  id: string,
  ownerId: string,
  accessToken: string,
  refreshToken: string,
  googleEmail: string,
  tokenExpiresAt: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO google_calendar_connections (id, owner_id, access_token, refresh_token, google_email, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         google_email = excluded.google_email,
         token_expires_at = excluded.token_expires_at`
    )
    .bind(id, ownerId, accessToken, refreshToken, googleEmail, tokenExpiresAt)
    .run();
}

export async function updateGCalAccessToken(
  db: D1Database,
  ownerId: string,
  accessToken: string,
  tokenExpiresAt: number
): Promise<void> {
  await db
    .prepare(
      "UPDATE google_calendar_connections SET access_token = ?, token_expires_at = ? WHERE owner_id = ?"
    )
    .bind(accessToken, tokenExpiresAt, ownerId)
    .run();
}

export async function updateGCalDefaultCalendar(
  db: D1Database,
  ownerId: string,
  calendarId: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE google_calendar_connections SET default_calendar_id = ? WHERE owner_id = ?"
    )
    .bind(calendarId, ownerId)
    .run();
}

export async function deleteGCalConnection(
  db: D1Database,
  ownerId: string
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM google_calendar_connections WHERE owner_id = ?"
    )
    .bind(ownerId)
    .run();
}
