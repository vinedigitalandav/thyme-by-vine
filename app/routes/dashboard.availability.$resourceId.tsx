import { data, redirect } from "@remix-run/cloudflare";
import { Form, useLoaderData, useNavigation, Link } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { requireOwner } from "~/lib/auth.server";
import {
  getResourceById,
  getRulesByResource,
  getOverridesByResource,
  upsertAvailabilityRule,
  deleteAvailabilityRule,
  upsertAvailabilityOverride,
  deleteAvailabilityOverride,
} from "~/lib/db.server";
import { generateId, DAY_NAMES } from "~/lib/utils";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Badge } from "~/components/ui/Badge";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `Availability — ${data?.resource?.name ?? "Resource"} — Thyme by Vine` },
];


export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const db = context.cloudflare.env.DB;
  const resourceId = params.resourceId!;

  const resource = await getResourceById(db, resourceId, ownerId);
  if (!resource) throw new Response("Resource not found", { status: 404 });

  const [rules, overrides] = await Promise.all([
    getRulesByResource(db, resourceId),
    getOverridesByResource(db, resourceId),
  ]);

  return { resource, rules, overrides };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const db = context.cloudflare.env.DB;
  const resourceId = params.resourceId!;

  // Verify ownership
  const resource = await getResourceById(db, resourceId, ownerId);
  if (!resource) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-rules") {
    for (let day = 0; day < 7; day++) {
      const enabled = form.get(`day_${day}_enabled`) === "on";
      if (!enabled) {
        await deleteAvailabilityRule(db, resourceId, day);
        continue;
      }
      const startTime = String(form.get(`day_${day}_start`) ?? "09:00");
      const endTime = String(form.get(`day_${day}_end`) ?? "17:00");
      // slot_durations stored as [] — duration now comes from resource.slot_duration
      await upsertAvailabilityRule(db, generateId(), resourceId, day, startTime, endTime, []);
    }
    return redirect(`/dashboard/availability/${resourceId}`);
  }

  if (intent === "add-override") {
    const date = String(form.get("override_date") ?? "").trim();
    const isBlocked = form.get("override_blocked") === "on";
    const startTime = String(form.get("override_start") ?? "").trim() || null;
    const endTime = String(form.get("override_end") ?? "").trim() || null;
    if (!date) return data({ error: "Date is required." }, { status: 400 });
    await upsertAvailabilityOverride(
      db,
      generateId(),
      resourceId,
      date,
      isBlocked,
      isBlocked ? null : startTime,
      isBlocked ? null : endTime
    );
    return redirect(`/dashboard/availability/${resourceId}`);
  }

  if (intent === "delete-override") {
    const date = String(form.get("date") ?? "");
    await deleteAvailabilityOverride(db, resourceId, date);
    return redirect(`/dashboard/availability/${resourceId}`);
  }

  return null;
}

export default function AvailabilityPage() {
  const { resource, rules, overrides } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  // Build lookup: dayOfWeek → rule
  const ruleByDay = Object.fromEntries(rules.map((r) => [r.day_of_week, r]));

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/dashboard/resources"
            className="text-apple-link-blue text-caption hover:underline"
          >
            ← Resources
          </Link>
          <h2 className="text-section-heading text-apple-near-black mt-1">
            {resource.name} — Availability
          </h2>
        </div>
      </div>

      {/* Recurring Weekly Schedule */}
      <div className="bg-white rounded-card p-6 shadow-card">
        <h3 className="text-card-title mb-1">Weekly Schedule</h3>
        <p className="text-caption text-apple-near-black/50 mb-6">
          Slot duration and price are set on the resource itself.
        </p>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save-rules" />
          {DAY_NAMES.map((dayName, day) => {
            const rule = ruleByDay[day];
            const enabled = !!rule;

            return (
              <div
                key={day}
                className="flex flex-wrap gap-4 items-center border-b border-apple-gray pb-4 last:border-0 last:pb-0"
              >
                <label className="flex items-center gap-2 cursor-pointer w-[120px] shrink-0">
                  <input
                    type="checkbox"
                    name={`day_${day}_enabled`}
                    defaultChecked={enabled}
                    className="h-4 w-4 rounded accent-apple-blue"
                  />
                  <span className="text-[15px] font-medium">{dayName}</span>
                </label>

                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    name={`day_${day}_start`}
                    defaultValue={rule?.start_time ?? "09:00"}
                    className="rounded-btn border border-apple-near-black/10 bg-btn-light px-2 py-1 text-[14px] focus:outline-none focus:ring-2 focus:ring-apple-blue/20"
                  />
                  <span className="text-apple-near-black/40 text-[13px]">to</span>
                  <input
                    type="time"
                    name={`day_${day}_end`}
                    defaultValue={rule?.end_time ?? "17:00"}
                    className="rounded-btn border border-apple-near-black/10 bg-btn-light px-2 py-1 text-[14px] focus:outline-none focus:ring-2 focus:ring-apple-blue/20"
                  />
                </div>
              </div>
            );
          })}

          <Button type="submit" loading={saving}>
            Save schedule
          </Button>
        </Form>
      </div>

      {/* Date Overrides */}
      <div className="bg-white rounded-card p-6 shadow-card">
        <h3 className="text-card-title mb-4">Date Overrides</h3>
        <p className="text-caption text-apple-near-black/50 mb-6">
          Block a specific date or set custom hours. Overrides take priority over the weekly schedule.
        </p>

        <Form method="post" className="grid sm:grid-cols-4 gap-3 mb-6">
          <input type="hidden" name="intent" value="add-override" />
          <Input name="override_date" type="date" label="Date" required />
          <Input name="override_start" type="time" label="Start time" />
          <Input name="override_end" type="time" label="End time" />
          <div className="flex flex-col gap-1">
            <label className="text-[14px] font-medium text-apple-near-black">
              Block entire day
            </label>
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                name="override_blocked"
                id="override_blocked"
                className="h-4 w-4 accent-apple-blue"
              />
              <label htmlFor="override_blocked" className="text-[14px]">
                Yes, block this day
              </label>
            </div>
          </div>
          <div className="sm:col-span-4 flex justify-end">
            <Button type="submit" variant="secondary" size="sm">
              Add override
            </Button>
          </div>
        </Form>

        {overrides.length === 0 ? (
          <p className="text-caption text-apple-near-black/40 text-center py-4">
            No overrides yet.
          </p>
        ) : (
          <div className="divide-y divide-apple-gray">
            {overrides.map((o) => (
              <div
                key={o.id}
                className="py-3 flex items-center justify-between"
              >
                <div>
                  <span className="font-medium text-[15px]">{o.date}</span>
                  {o.is_blocked ? (
                    <Badge variant="red" className="ml-2">
                      Blocked
                    </Badge>
                  ) : (
                    <span className="ml-3 text-caption text-apple-near-black/60">
                      {o.start_time} – {o.end_time}
                    </span>
                  )}
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete-override" />
                  <input type="hidden" name="date" value={o.date} />
                  <button
                    type="submit"
                    className="text-caption text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
