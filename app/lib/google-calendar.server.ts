// ─────────────────────────────────────────────────────
// Google Calendar OAuth + Events integration
// ─────────────────────────────────────────────────────

import {
  getGCalConnection,
  upsertGCalConnection,
  updateGCalAccessToken,
} from "./db.server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function getGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Fetch user email
  const userRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${data.access_token}` } }
  );
  const user = (await userRes.json()) as { email: string };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    email: user.email,
  };
}

async function refreshAccessToken(
  db: D1Database,
  ownerId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const conn = await getGCalConnection(db, ownerId);
  if (!conn) throw new Error("No Google Calendar connection found");

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error("Failed to refresh Google access token");

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

  await updateGCalAccessToken(db, ownerId, data.access_token, expiresAt);
  return data.access_token;
}

async function getValidAccessToken(
  db: D1Database,
  ownerId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const conn = await getGCalConnection(db, ownerId);
  if (!conn) throw new Error("No Google Calendar connection");

  const now = Math.floor(Date.now() / 1000);
  // Refresh if token expires in less than 5 minutes
  if (conn.token_expires_at && conn.token_expires_at - now < 300) {
    return refreshAccessToken(db, ownerId, clientId, clientSecret);
  }
  return conn.access_token;
}

export async function createCalendarEvent(
  db: D1Database,
  ownerId: string,
  clientId: string,
  clientSecret: string,
  opts: {
    summary: string;
    description: string;
    startIso: string;
    endIso: string;
    timezone?: string;
    calendarId?: string;
  }
): Promise<string | null> {
  try {
    const token = await getValidAccessToken(db, ownerId, clientId, clientSecret);
    const conn = await getGCalConnection(db, ownerId);
    const calId = opts.calendarId ?? conn?.default_calendar_id ?? "primary";

    const res = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: opts.summary,
          description: opts.description,
          start: { dateTime: opts.startIso, timeZone: opts.timezone ?? "UTC" },
          end:   { dateTime: opts.endIso,   timeZone: opts.timezone ?? "UTC" },
        }),
      }
    );

    if (!res.ok) {
      console.error("[gcal] create event failed:", await res.text());
      return null;
    }

    const event = (await res.json()) as { id: string };
    return event.id;
  } catch (err) {
    console.error("[gcal] createCalendarEvent error:", err);
    return null;
  }
}

export async function deleteCalendarEvent(
  db: D1Database,
  ownerId: string,
  clientId: string,
  clientSecret: string,
  eventId: string,
  calendarId?: string
): Promise<void> {
  try {
    const token = await getValidAccessToken(db, ownerId, clientId, clientSecret);
    const conn = await getGCalConnection(db, ownerId);
    const calId = calendarId ?? conn?.default_calendar_id ?? "primary";

    await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  } catch (err) {
    console.error("[gcal] deleteCalendarEvent error:", err);
  }
}

export interface UserCalendar {
  id: string;
  name: string;
  primary: boolean;
}

export async function listUserCalendars(
  db: D1Database,
  ownerId: string,
  clientId: string,
  clientSecret: string
): Promise<UserCalendar[]> {
  try {
    const token = await getValidAccessToken(db, ownerId, clientId, clientSecret);
    const res = await fetch(
      `${GOOGLE_CALENDAR_API}/users/me/calendarList?minAccessRole=writer`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ id: string; summary: string; primary?: boolean }>;
    };
    return (data.items ?? []).map((c) => ({
      id: c.id,
      name: c.summary,
      primary: c.primary ?? false,
    }));
  } catch (err) {
    console.error("[gcal] listUserCalendars error:", err);
    return [];
  }
}

export { getGCalConnection, upsertGCalConnection };
