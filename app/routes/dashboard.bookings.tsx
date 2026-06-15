import { data, redirect } from "@remix-run/cloudflare";
import { Form, useLoaderData, useSearchParams, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { requireOwner } from "~/lib/auth.server";
import {
  getBookingsByOwner,
  getResourcesByOwner,
  cancelBooking,
  getOwnerById,
} from "~/lib/db.server";
import { sendBookingCancellation } from "~/lib/email.server";
import { deleteCalendarEvent } from "~/lib/google-calendar.server";
import { formatDate, formatTime12, formatDurationLong } from "~/lib/utils";
import { Badge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";

export const meta: MetaFunction = () => [
  { title: "Bookings — Thyme by Vine" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const db = context.cloudflare.env.DB;

  const url = new URL(request.url);
  const resourceFilter = url.searchParams.get("resource") ?? undefined;
  const statusFilter = url.searchParams.get("status") ?? undefined;

  const [bookings, resources] = await Promise.all([
    getBookingsByOwner(db, ownerId, {
      resourceId: resourceFilter,
      status: statusFilter,
      limit: 100,
    }),
    getResourcesByOwner(db, ownerId),
  ]);

  return { bookings, resources };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const db = context.cloudflare.env.DB;
  const env = context.cloudflare.env;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "cancel") {
    const bookingId = String(form.get("bookingId"));
    const booking = await cancelBooking(db, bookingId, ownerId);

    if (booking) {
      // Send cancellation email
      const owner = await getOwnerById(db, ownerId);
      const resourceNames = booking.resource_names
        ? String(booking.resource_names).split(",")
        : [];

      if (env.RESEND_API_KEY && owner) {
        await sendBookingCancellation(env.RESEND_API_KEY, {
          to: booking.booker_email,
          bookerName: booking.booker_name,
          resourceNames,
          date: new Date(booking.start_at * 1000).toLocaleDateString(),
          startTime: formatTime12(booking.start_at),
          endTime: formatTime12(booking.end_at),
          ownerEmail: owner.email,
          ownerName: owner.name,
        });
      }

      // Delete Google Calendar event
      if (booking.google_event_id && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
        await deleteCalendarEvent(
          db,
          ownerId,
          env.GOOGLE_CLIENT_ID,
          env.GOOGLE_CLIENT_SECRET,
          booking.google_event_id
        );
      }
    }

    return redirect("/dashboard/bookings");
  }

  if (intent === "export-csv") {
    const bookings = await getBookingsByOwner(db, ownerId);
    const rows = [
      ["ID", "Booker", "Email", "Resources", "Date", "Start", "End", "Duration", "Status", "Note"].join(","),
      ...bookings.map((b) =>
        [
          b.id,
          `"${b.booker_name}"`,
          b.booker_email,
          `"${b.resource_names ?? ""}"`,
          new Date(b.start_at * 1000).toLocaleDateString(),
          formatTime12(b.start_at),
          formatTime12(b.end_at),
          b.duration_minutes,
          b.status,
          `"${b.note ?? ""}"`,
        ].join(",")
      ),
    ].join("\n");

    return new Response(rows, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=bookings.csv",
      },
    });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

export default function BookingsPage() {
  const { bookings, resources } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();

  const resourceFilter = searchParams.get("resource") ?? "";
  const statusFilter = searchParams.get("status") ?? "";

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-section-heading text-apple-near-black mb-1">Bookings</h2>
          <p className="text-body text-apple-near-black/50">
            All reservations across your resources.
          </p>
        </div>

        <Form method="post">
          <input type="hidden" name="intent" value="export-csv" />
          <Button variant="secondary" size="sm" type="submit">
            Export CSV
          </Button>
        </Form>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={resourceFilter}
          onChange={(e) => updateFilter("resource", e.target.value)}
          className="rounded-btn border border-apple-near-black/10 bg-btn-light px-3 py-1.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-apple-blue/20"
        >
          <option value="">All resources</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => updateFilter("status", e.target.value)}
          className="rounded-btn border border-apple-near-black/10 bg-btn-light px-3 py-1.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-apple-blue/20"
        >
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <span className="text-caption text-apple-near-black/40 ml-auto">
          {bookings.length} booking{bookings.length !== 1 ? "s" : ""}
        </span>
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-card p-10 text-center">
          <p className="text-body text-apple-near-black/40">No bookings found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-card overflow-hidden shadow-card divide-y divide-apple-gray">
          {bookings.map((b) => (
            <div key={b.id} className="px-6 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-apple-near-black">
                      {b.booker_name}
                    </p>
                    <Badge variant={b.status === "confirmed" ? "green" : b.status === "pending_confirmation" ? "yellow" : "red"}>
                      {b.status === "pending_confirmation" ? "pending" : b.status}
                    </Badge>
                  </div>
                  <p className="text-caption text-apple-near-black/50">
                    {b.booker_email}
                  </p>
                  <p className="text-[14px] text-apple-near-black/70">
                    {b.resource_names ?? "—"} ·{" "}
                    <strong>{formatDate(b.start_at)}</strong> ·{" "}
                    {formatTime12(b.start_at)} – {formatTime12(b.end_at)} ·{" "}
                    {formatDurationLong(b.duration_minutes)}
                  </p>
                  {b.note && (
                    <p className="text-caption text-apple-near-black/50 italic">
                      "{b.note}"
                    </p>
                  )}
                </div>

                {(b.status === "confirmed" || b.status === "pending_confirmation") && (
                  <Form method="post" className="shrink-0">
                    <input type="hidden" name="intent" value="cancel" />
                    <input type="hidden" name="bookingId" value={b.id} />
                    <Button
                      variant="danger"
                      size="sm"
                      type="submit"
                      onClick={(e) => {
                        if (!confirm("Cancel this booking? The booker will be notified.")) {
                          e.preventDefault();
                        }
                      }}
                    >
                      Cancel booking
                    </Button>
                  </Form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
