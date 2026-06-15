/** Generate a URL-safe UUID v4 */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Generate a random session token (hex) */
export function generateToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Slugify a string for use in URLs */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

/** Format Unix seconds to a readable date string */
export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Format Unix seconds to a time string (12-hour) */
export function formatTime12(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Format minutes-from-midnight to 12-hour time string */
export function minutesToTime12(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Format a duration in minutes to a short string */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Format duration for display */
export function formatDurationLong(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} hr ${m} min`;
}

/** YYYY-MM-DD from a Date object */
export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO string from Unix seconds */
export function toIsoString(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

/** Local ISO datetime string (no Z) from a date string + minutes from midnight. Use with a timeZone field in GCal events. */
export function toLocalIso(dateStr: string, minutesFromMidnight: number): string {
  const hh = String(Math.floor(minutesFromMidnight / 60)).padStart(2, "0");
  const mm = String(minutesFromMidnight % 60).padStart(2, "0");
  return `${dateStr}T${hh}:${mm}:00`;
}

/** Sunday of the current week (Sunday–Saturday view) */
export function currentWeekStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay()); // move back to Sunday
  return toDateString(d);
}

/** Validate email format */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Validate slug format */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]{3,60}$/.test(slug);
}

/** Day names */
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
