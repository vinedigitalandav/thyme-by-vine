import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { requireOwner } from "~/lib/auth.server";
import { getBookingsByOwner, getResourcesByOwner } from "~/lib/db.server";
import { StatCard } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { formatDate, formatTime12 } from "~/lib/utils";

export const meta: MetaFunction = () => [{ title: "Dashboard — Thyme by Vine" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const db = context.cloudflare.env.DB;

  const now = Math.floor(Date.now() / 1000);
  // Use start of today (UTC midnight) so bookings earlier today still appear
  const todayStart = now - (now % 86400);
  const threeDaysLater = todayStart + 3 * 24 * 60 * 60;

  const [resources, allConfirmed] = await Promise.all([
    getResourcesByOwner(db, ownerId),
    getBookingsByOwner(db, ownerId, { status: "confirmed" }),
  ]);

  const activeResources = resources.filter((r) => r.is_active === 1);
  const allUpcoming = allConfirmed
    .filter((b) => b.start_at >= todayStart)
    .sort((a, b) => a.start_at - b.start_at);
  const upcomingInNext3Days = allUpcoming.filter((b) => b.start_at < threeDaysLater);

  return { resources, activeResources: activeResources.length, upcomingCount: allUpcoming.length, upcoming: upcomingInNext3Days };
}

export default function DashboardIndex() {
  const { resources, activeResources, upcoming, upcomingCount } =
    useLoaderData<typeof loader>();

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-section-heading text-apple-near-black mb-1">Overview</h2>
        <p className="text-body text-apple-near-black/50">
          Manage your resources, availability, and bookings.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          label="Active resources"
          value={activeResources}
          sub={`${resources.length} total`}
        />
        <StatCard
          label="Upcoming bookings"
          value={upcomingCount}
          sub="Confirmed"
        />
      </div>

      {/* Upcoming bookings preview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title text-apple-near-black">Next 3 Days</h3>
          <Link
            to="/dashboard/bookings"
            className="text-apple-link-blue text-caption hover:underline"
          >
            View all →
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <div className="bg-white rounded-card p-8 text-center">
            <p className="text-body text-apple-near-black/40">
              No bookings in the next 3 days.
            </p>
            <p className="text-caption text-apple-near-black/30 mt-1">
              Share your booking link to get started.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-card overflow-hidden divide-y divide-apple-gray max-h-72 overflow-y-auto">
            {upcoming.map((booking) => (
              <div key={booking.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-apple-near-black">{booking.booker_name}</p>
                  <p className="text-caption text-apple-near-black/50">
                    {booking.resource_names ?? "—"} · {formatDate(booking.start_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-medium text-apple-near-black">
                    {formatTime12(booking.start_at)} – {formatTime12(booking.end_at)}
                  </p>
                  <Badge variant="green">Confirmed</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick action: add resource if none */}
      {resources.length === 0 && (
        <div className="bg-apple-near-black rounded-card p-8 text-center text-white">
          <h3 className="text-tile-heading mb-2">Get started in minutes</h3>
          <p className="text-body text-white/60 mb-6">
            Create your first resource, set its availability, then share your booking link.
          </p>
          <Link
            to="/dashboard/resources"
            className="inline-block bg-apple-blue text-white px-6 py-2 rounded-btn hover:opacity-90 transition-opacity"
          >
            Add your first resource
          </Link>
        </div>
      )}
    </div>
  );
}
