import { data, redirect } from "@remix-run/cloudflare";
import { Form, useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { requireOwner } from "~/lib/auth.server";
import {
  getOwnerById,
  updateOwner,
  getGCalConnection,
  deleteGCalConnection,
  updateGCalDefaultCalendar,
} from "~/lib/db.server";
import { getGoogleAuthUrl, listUserCalendars } from "~/lib/google-calendar.server";
import { generateToken, isValidEmail } from "~/lib/utils";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Card } from "~/components/ui/Card";

export const meta: MetaFunction = () => [
  { title: "Settings — Thyme by Vine" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const db = context.cloudflare.env.DB;
  const [owner, gcal] = await Promise.all([
    getOwnerById(db, ownerId),
    getGCalConnection(db, ownerId),
  ]);
  if (!owner) throw new Response("Not found", { status: 404 });

  const env = context.cloudflare.env;
  const calendars = gcal
    ? await listUserCalendars(db, ownerId, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)
    : [];

  return {
    owner: { id: owner.id, name: owner.name, email: owner.email, slug: owner.slug, timezone: owner.timezone ?? "America/Chicago" },
    gcalConnected: !!gcal,
    gcalEmail: gcal?.google_email ?? null,
    gcalDefaultCalendarId: gcal?.default_calendar_id ?? null,
    calendars,
    appUrl: env.APP_URL,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const db = context.cloudflare.env.DB;
  const env = context.cloudflare.env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "update-profile") {
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const timezone = String(form.get("timezone") ?? "").trim() || "America/Chicago";
    const errors: Record<string, string> = {};

    if (!name || name.length < 2) errors.name = "Name must be at least 2 characters.";
    if (!isValidEmail(email)) errors.email = "Enter a valid email.";

    if (Object.keys(errors).length > 0) {
      return data({ errors, tab: "profile" }, { status: 400 });
    }

    await updateOwner(db, ownerId, { name, email, timezone });
    return data({ success: "Profile updated.", tab: "profile" });
  }

  if (intent === "set-calendar") {
    const calendarId = String(form.get("calendarId") ?? "").trim();
    if (calendarId) {
      await updateGCalDefaultCalendar(db, ownerId, calendarId);
    }
    return data({ success: "Default calendar updated.", tab: "calendar" });
  }

  if (intent === "connect-google") {
    const redirectUri = `${env.APP_URL}/auth/google/callback`;
    // Store ownerId in state (CSRF token approach — in production, use a signed state)
    const state = `${ownerId}:${generateToken(16)}`;
    const url = getGoogleAuthUrl(env.GOOGLE_CLIENT_ID, redirectUri, state);
    return redirect(url);
  }

  if (intent === "disconnect-google") {
    await deleteGCalConnection(db, ownerId);
    return data({ success: "Google Calendar disconnected.", tab: "calendar" });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionResult = Record<string, any> | null | undefined;

const TIMEZONES = [
  { group: "United States", options: [
    { value: "America/New_York",    label: "Eastern Time (New York)" },
    { value: "America/Chicago",     label: "Central Time (Chicago)" },
    { value: "America/Denver",      label: "Mountain Time (Denver)" },
    { value: "America/Phoenix",     label: "Mountain Time — no DST (Phoenix)" },
    { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
    { value: "America/Anchorage",   label: "Alaska Time (Anchorage)" },
    { value: "Pacific/Honolulu",    label: "Hawaii Time (Honolulu)" },
  ]},
  { group: "Canada & Mexico", options: [
    { value: "America/Toronto",     label: "Eastern Time (Toronto)" },
    { value: "America/Vancouver",   label: "Pacific Time (Vancouver)" },
    { value: "America/Mexico_City", label: "Central Time (Mexico City)" },
  ]},
  { group: "Latin America", options: [
    { value: "America/Sao_Paulo",               label: "Brasília Time (São Paulo)" },
    { value: "America/Argentina/Buenos_Aires",  label: "Argentina Time (Buenos Aires)" },
    { value: "America/Bogota",                  label: "Colombia Time (Bogotá)" },
    { value: "America/Lima",                    label: "Peru Time (Lima)" },
    { value: "America/Santiago",                label: "Chile Time (Santiago)" },
  ]},
  { group: "Europe", options: [
    { value: "UTC",               label: "UTC" },
    { value: "Europe/London",     label: "GMT/BST (London)" },
    { value: "Europe/Paris",      label: "Central European Time (Paris)" },
    { value: "Europe/Berlin",     label: "Central European Time (Berlin)" },
    { value: "Europe/Madrid",     label: "Central European Time (Madrid)" },
    { value: "Europe/Rome",       label: "Central European Time (Rome)" },
    { value: "Europe/Amsterdam",  label: "Central European Time (Amsterdam)" },
    { value: "Europe/Stockholm",  label: "Central European Time (Stockholm)" },
    { value: "Europe/Warsaw",     label: "Central European Time (Warsaw)" },
    { value: "Europe/Kyiv",       label: "Eastern European Time (Kyiv)" },
    { value: "Europe/Moscow",     label: "Moscow Time" },
    { value: "Europe/Istanbul",   label: "Turkey Time (Istanbul)" },
    { value: "Europe/Lisbon",     label: "Western European Time (Lisbon)" },
    { value: "Europe/Athens",     label: "Eastern European Time (Athens)" },
  ]},
  { group: "Middle East & Africa", options: [
    { value: "Asia/Dubai",            label: "Gulf Time (Dubai)" },
    { value: "Asia/Riyadh",           label: "Arabia Time (Riyadh)" },
    { value: "Asia/Jerusalem",        label: "Israel Time (Jerusalem)" },
    { value: "Africa/Cairo",          label: "Eastern European Time (Cairo)" },
    { value: "Africa/Johannesburg",   label: "South Africa Time (Johannesburg)" },
    { value: "Africa/Lagos",          label: "West Africa Time (Lagos)" },
    { value: "Africa/Nairobi",        label: "East Africa Time (Nairobi)" },
  ]},
  { group: "Asia", options: [
    { value: "Asia/Kolkata",    label: "India Standard Time (Kolkata)" },
    { value: "Asia/Colombo",    label: "Sri Lanka Time (Colombo)" },
    { value: "Asia/Dhaka",      label: "Bangladesh Time (Dhaka)" },
    { value: "Asia/Bangkok",    label: "Indochina Time (Bangkok)" },
    { value: "Asia/Singapore",  label: "Singapore Time (Singapore)" },
    { value: "Asia/Kuala_Lumpur", label: "Malaysia Time (Kuala Lumpur)" },
    { value: "Asia/Shanghai",   label: "China Standard Time (Shanghai)" },
    { value: "Asia/Hong_Kong",  label: "Hong Kong Time" },
    { value: "Asia/Tokyo",      label: "Japan Standard Time (Tokyo)" },
    { value: "Asia/Seoul",      label: "Korea Standard Time (Seoul)" },
    { value: "Asia/Karachi",    label: "Pakistan Time (Karachi)" },
    { value: "Asia/Kabul",      label: "Afghanistan Time (Kabul)" },
    { value: "Asia/Tashkent",   label: "Uzbekistan Time (Tashkent)" },
  ]},
  { group: "Oceania", options: [
    { value: "Australia/Sydney",    label: "Australian Eastern Time (Sydney)" },
    { value: "Australia/Melbourne", label: "Australian Eastern Time (Melbourne)" },
    { value: "Australia/Brisbane",  label: "Australian Eastern Time — no DST (Brisbane)" },
    { value: "Australia/Adelaide",  label: "Australian Central Time (Adelaide)" },
    { value: "Australia/Perth",     label: "Australian Western Time (Perth)" },
    { value: "Pacific/Auckland",    label: "New Zealand Time (Auckland)" },
    { value: "Pacific/Fiji",        label: "Fiji Time" },
  ]},
];

export default function SettingsPage() {
  const { owner, gcalConnected, gcalEmail, gcalDefaultCalendarId, calendars } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResult;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [selectedCalendarId, setSelectedCalendarId] = useState(gcalDefaultCalendarId ?? "primary");
  const [selectedTimezone, setSelectedTimezone] = useState(owner.timezone ?? "America/Chicago");

  // Keep in sync if the loader refreshes (e.g. after save)
  useEffect(() => {
    setSelectedCalendarId(gcalDefaultCalendarId ?? "primary");
  }, [gcalDefaultCalendarId]);

  useEffect(() => {
    setSelectedTimezone(owner.timezone ?? "America/Chicago");
  }, [owner.timezone]);

  return (
    <div className="space-y-10 max-w-xl">
      <div>
        <h2 className="text-section-heading text-apple-near-black mb-1">Settings</h2>
        <p className="text-body text-apple-near-black/50">
          Manage your account and integrations.
        </p>
      </div>

      {/* Profile */}
      <Card shadow>
        <h3 className="text-card-title mb-5">Profile</h3>
        {actionData?.tab === "profile" && actionData?.success && (
          <div className="mb-4 rounded-btn bg-green-50 border border-green-200 px-4 py-2 text-[14px] text-green-700">
            {actionData.success}
          </div>
        )}
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="update-profile" />
          <Input
            label="Name"
            name="name"
            defaultValue={owner.name}
            error={actionData?.tab === "profile" ? actionData?.errors?.name : undefined}
            required
          />
          <Input
            label="Email"
            name="email"
            type="email"
            defaultValue={owner.email}
            error={actionData?.tab === "profile" ? actionData?.errors?.email : undefined}
            required
          />
          <div>
            <label className="block text-[13px] font-medium text-apple-near-black mb-1.5">
              Timezone
            </label>
            <select
              name="timezone"
              value={selectedTimezone}
              onChange={(e) => setSelectedTimezone(e.target.value)}
              className="w-full border border-apple-near-black/15 rounded-btn px-3 py-2 text-[14px] text-apple-near-black bg-white focus:outline-none focus:ring-2 focus:ring-apple-blue/40"
            >
              {TIMEZONES.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.options.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-micro text-apple-near-black/40 mt-1">
              Used for the booking calendar display and Google Calendar events.
            </p>
          </div>
          <div>
            <p className="text-[14px] font-medium text-apple-near-black mb-1">Booking URL slug</p>
            <p className="text-[14px] text-apple-near-black/50 font-mono bg-apple-gray px-3 py-2 rounded-btn">
              /{owner.slug}
            </p>
            <p className="text-micro text-apple-near-black/40 mt-1">
              Slug cannot be changed after creation.
            </p>
          </div>
          <Button
            type="submit"
            loading={submitting && navigation.formData?.get("intent") === "update-profile"}
          >
            Save profile
          </Button>
        </Form>
      </Card>

      {/* Google Calendar */}
      <Card shadow>
        <h3 className="text-card-title mb-2">Google Calendar</h3>
        <p className="text-caption text-apple-near-black/50 mb-5">
          Connect your Google Calendar to automatically create and remove events when bookings are made or cancelled.
        </p>
        {actionData?.tab === "calendar" && actionData?.success && (
          <div className="mb-4 rounded-btn bg-green-50 border border-green-200 px-4 py-2 text-[14px] text-green-700">
            {actionData.success}
          </div>
        )}
        {gcalConnected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-btn px-4 py-3">
              <div>
                <p className="text-[14px] font-medium text-green-800">Connected</p>
                <p className="text-caption text-green-600">{gcalEmail}</p>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="disconnect-google" />
                <Button variant="ghost" size="sm" type="submit">
                  Disconnect
                </Button>
              </Form>
            </div>

            {calendars.length > 0 && (
              <Form method="post" className="flex items-end gap-3">
                <input type="hidden" name="intent" value="set-calendar" />
                <div className="flex-1">
                  <label className="block text-[13px] font-medium text-apple-near-black mb-1.5">
                    Booking calendar
                  </label>
                  <select
                    name="calendarId"
                    value={selectedCalendarId}
                    onChange={(e) => setSelectedCalendarId(e.target.value)}
                    className="w-full border border-apple-near-black/15 rounded-btn px-3 py-2 text-[14px] text-apple-near-black bg-white focus:outline-none focus:ring-2 focus:ring-apple-blue/40"
                  >
                    {calendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.name}{cal.primary ? " (primary)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-micro text-apple-near-black/40 mt-1">
                    New bookings will be added to this calendar.
                  </p>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  loading={submitting && navigation.formData?.get("intent") === "set-calendar"}
                >
                  Save
                </Button>
              </Form>
            )}
          </div>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="connect-google" />
            <Button variant="secondary" type="submit">
              Connect Google Calendar
            </Button>
          </Form>
        )}
      </Card>
    </div>
  );
}
