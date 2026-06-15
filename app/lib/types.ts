// ─────────────────────────────────────────────────────
// Shared TypeScript types for Thyme by Vine
// ─────────────────────────────────────────────────────

export interface Owner {
  id: string;
  clerk_id: string | null;
  name: string;
  email: string;
  password_hash: string;
  slug: string;
  timezone: string;
  created_at: number;
}

export interface GoogleCalendarConnection {
  id: string;
  owner_id: string;
  access_token: string;
  refresh_token: string;
  google_email: string;
  default_calendar_id: string | null;
  resource_calendar_map: string; // JSON
  token_expires_at: number | null;
  created_at: number;
}

export interface Resource {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  is_active: number; // 1 | 0
  slot_duration: number;   // minutes, e.g. 30 | 60 | 90
  price_per_slot: number;  // cents, e.g. 2500 = $25.00
  color: string;           // hex color, e.g. '#3b82f6'
  created_at: number;
}

export interface AvailabilityRule {
  id: string;
  resource_id: string;
  day_of_week: number; // 0–6
  start_time: string;  // "HH:MM"
  end_time: string;    // "HH:MM"
  slot_durations: string; // legacy JSON array — ignored, use resource.slot_duration
}

export interface AvailabilityOverride {
  id: string;
  resource_id: string;
  date: string;       // "YYYY-MM-DD"
  is_blocked: number; // 1 | 0
  start_time: string | null;
  end_time: string | null;
}

export interface Booking {
  id: string;
  owner_id: string;
  booker_name: string;
  booker_email: string;
  note: string | null;
  start_at: number;        // Unix seconds
  end_at: number;          // Unix seconds
  duration_minutes: number;
  status: "pending_confirmation" | "confirmed" | "cancelled";
  confirmation_token: string | null;
  google_event_id: string | null;
  created_at: number;
  // joined
  resource_ids?: string[];
  resource_names?: string[];
}

export interface BookingResource {
  booking_id: string;
  resource_id: string;
}

// ── Computed types ──

export interface TimeSlot {
  date: string;         // "YYYY-MM-DD"
  startMinutes: number; // minutes from midnight
  endMinutes: number;
  startTime: string;    // "HH:MM"
  endTime: string;      // "HH:MM"
  available: boolean;
}

export interface SlotsByDate {
  [date: string]: TimeSlot[];
}

export type BookingStatus = "confirmed" | "cancelled";
