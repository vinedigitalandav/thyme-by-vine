import { data } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import React, { useState, useEffect, useMemo } from "react";
import { getOwnerBySlug, getActiveResourcesByOwner, createBooking } from "~/lib/db.server";
import { getAvailableSlots, getSlotsByResource, slotToTimestamps } from "~/lib/slots.server";
import { sendMultiBookingVerificationEmail } from "~/lib/email.server";
import { createCalendarEvent, getGCalConnection } from "~/lib/google-calendar.server";
import { setBookingGoogleEventId } from "~/lib/db.server";
import {
  generateId,
  generateToken,
  toIsoString,
  toLocalIso,
  isValidEmail,
  DAY_SHORT,
  currentWeekStart,
  minutesToTime12,
  formatDuration,
  formatDurationLong,
} from "~/lib/utils";
import type { SlotsByDate, TimeSlot } from "~/lib/types";
import { Button } from "~/components/ui/Button";
import { Input, Textarea } from "~/components/ui/Input";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { createPaymentIntent, getPaymentIntentStatus } from "~/lib/stripe.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.owner ? `Book with ${data.owner.name} — Thyme by Vine` : "Book — Thyme by Vine" },
];

export async function loader({ params, context }: LoaderFunctionArgs) {
  const { slug } = params;
  if (!slug) throw new Response("Not found", { status: 404 });
  const db = context.cloudflare.env.DB;
  const owner = await getOwnerBySlug(db, slug);
  if (!owner) throw new Response("Not found", { status: 404 });
  const resources = await getActiveResourcesByOwner(db, owner.id);
  return {
    owner: { id: owner.id, name: owner.name, slug: owner.slug, email: owner.email },
    resources,
    stripePublishableKey: context.cloudflare.env.STRIPE_PUBLISHABLE_KEY ?? null,
    ownerTimezone: owner.timezone ?? "America/Chicago",
  };
}

// ── Server action ─────────────────────────────────────

export async function action({ request, params, context }: ActionFunctionArgs) {
  const { slug } = params;
  if (!slug) throw new Response("Not found", { status: 404 });
  const db = context.cloudflare.env.DB;
  const env = context.cloudflare.env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "get-slots") {
    const resourceIds = String(form.get("resourceIds") ?? "").split(",").filter(Boolean);
    const weekStart = String(form.get("weekStart") ?? currentWeekStart());
    if (resourceIds.length === 0) return data({ slotsByResource: {} as Record<string, SlotsByDate>, resourceInfo: [] });
    const slotsByResource = await getSlotsByResource(db, resourceIds, weekStart);
    const resourceInfoRows = await Promise.all(
      resourceIds.map((id) =>
        db.prepare("SELECT id, name, slot_duration, price_per_slot, color FROM resources WHERE id = ?")
          .bind(id).first<{ id: string; name: string; slot_duration: number; price_per_slot: number; color: string }>()
      )
    );
    const resourceInfo = resourceInfoRows
      .filter((r): r is { id: string; name: string; slot_duration: number; price_per_slot: number; color: string } => r !== null)
      .map((r) => ({ id: r.id, name: r.name, slotDuration: r.slot_duration, pricePerSlot: r.price_per_slot, color: r.color ?? "#3b82f6" }));
    return data({ slotsByResource, resourceInfo });
  }

  if (intent === "create-payment-intent") {
    const owner = await getOwnerBySlug(db, slug);
    if (!owner) throw new Response("Not found", { status: 404 });
    const bookerName = String(form.get("bookerName") ?? "").trim();
    const bookerEmail = String(form.get("bookerEmail") ?? "").trim().toLowerCase();
    const slotDuration = Number(form.get("slotDuration") ?? 60);

    let bookingGroups: Array<{ resourceId: string; date: string; startMinutes: number; slotCount: number }>;
    try {
      bookingGroups = JSON.parse(String(form.get("bookings") ?? "[]"));
    } catch {
      return data({ errors: { general: "Invalid booking data." } }, { status: 400 });
    }

    const errors: Record<string, string> = {};
    if (!bookerName || bookerName.length < 2) errors.bookerName = "Name is required.";
    if (!isValidEmail(bookerEmail)) errors.bookerEmail = "Valid email is required.";
    if (bookingGroups.length === 0) errors.general = "No slots selected.";
    if (Object.keys(errors).length > 0) return data({ errors }, { status: 400 });

    if (!env.STRIPE_SECRET_KEY) {
      return data({ errors: { general: "Payment is not configured on this booking page." } }, { status: 503 });
    }

    // Validate slot availability before charging
    for (const group of bookingGroups) {
      const freshSlots = await getAvailableSlots(db, [group.resourceId], group.date, slotDuration);
      const dateSlots = freshSlots[group.date] ?? [];
      for (let i = 0; i < group.slotCount; i++) {
        const slotStart = group.startMinutes + i * slotDuration;
        const target = dateSlots.find((s) => s.startMinutes === slotStart && s.available);
        if (!target) {
          return data({ errors: { general: "One or more slots are no longer available. Please go back and choose different times." } }, { status: 409 });
        }
      }
    }

    // Calculate total server-side
    const allResourceIds = [...new Set(bookingGroups.map((g) => g.resourceId))];
    let totalCents = 0;
    for (const rId of allResourceIds) {
      const row = await db
        .prepare("SELECT price_per_slot FROM resources WHERE id = ?")
        .bind(rId)
        .first<{ price_per_slot: number }>();
      if (row) {
        const slotsForResource = bookingGroups
          .filter((g) => g.resourceId === rId)
          .reduce((s, g) => s + g.slotCount, 0);
        totalCents += (row.price_per_slot ?? 0) * slotsForResource;
      }
    }

    if (totalCents < 50) {
      return data({ errors: { general: "The booking total is too small to process a payment." } }, { status: 400 });
    }

    const pi = await createPaymentIntent(env.STRIPE_SECRET_KEY, {
      amountCents: totalCents,
      receiptEmail: bookerEmail,
      description: `Booking with ${owner.name}`,
      metadata: { ownerSlug: slug, bookerEmail, bookerName },
    });
    return data({ clientSecret: pi.clientSecret, paymentIntentId: pi.id });
  }

  if (intent === "confirm") {
    const owner = await getOwnerBySlug(db, slug);
    if (!owner) throw new Response("Not found", { status: 404 });
    const bookerName = String(form.get("bookerName") ?? "").trim();
    const bookerEmail = String(form.get("bookerEmail") ?? "").trim().toLowerCase();
    const note = String(form.get("note") ?? "").trim() || null;
    const slotDuration = Number(form.get("slotDuration") ?? 60);
    const stripePaymentIntentId = String(form.get("stripePaymentIntentId") ?? "").trim() || null;

    let bookingGroups: Array<{ resourceId: string; date: string; startMinutes: number; slotCount: number }>;
    try {
      bookingGroups = JSON.parse(String(form.get("bookings") ?? "[]"));
    } catch {
      return data({ errors: { general: "Invalid booking data." } }, { status: 400 });
    }

    const errors: Record<string, string> = {};
    if (!bookerName || bookerName.length < 2) errors.bookerName = "Name is required.";
    if (!isValidEmail(bookerEmail)) errors.bookerEmail = "Valid email is required.";
    if (bookingGroups.length === 0) errors.general = "No slots selected.";
    if (Object.keys(errors).length > 0) return data({ errors }, { status: 400 });

    // Validate availability for each booking group
    for (const group of bookingGroups) {
      const freshSlots = await getAvailableSlots(db, [group.resourceId], group.date, slotDuration);
      const dateSlots = freshSlots[group.date] ?? [];
      for (let i = 0; i < group.slotCount; i++) {
        const slotStart = group.startMinutes + i * slotDuration;
        const target = dateSlots.find((s) => s.startMinutes === slotStart && s.available);
        if (!target) {
          return data({ errors: { general: "One or more slots were just taken. Please choose again." } }, { status: 409 });
        }
      }
    }

    const confirmationToken = generateToken();
    const hasEmail = !!(env.RESEND_API_KEY && !env.RESEND_API_KEY.startsWith("re_placeholder"));

    // Determine booking status
    let status: "pending_confirmation" | "confirmed";
    if (stripePaymentIntentId && env.STRIPE_SECRET_KEY) {
      const piStatus = await getPaymentIntentStatus(env.STRIPE_SECRET_KEY, stripePaymentIntentId);
      if (piStatus !== "succeeded") {
        return data({ errors: { general: "Payment verification failed. Please try again." } }, { status: 400 });
      }
      status = "confirmed"; // payment verified — confirm immediately
    } else {
      status = hasEmail ? "pending_confirmation" : "confirmed";
    }

    // Fetch resource info once per unique resource
    const allResourceIds = [...new Set(bookingGroups.map((g) => g.resourceId))];
    const resourceRowMap: Record<string, { name: string; price_per_slot: number }> = {};
    for (const rId of allResourceIds) {
      const row = await db
        .prepare("SELECT name, price_per_slot FROM resources WHERE id = ?")
        .bind(rId)
        .first<{ name: string; price_per_slot: number }>();
      if (row) resourceRowMap[rId] = row;
    }

    // Create one booking per group
    let totalPrice = 0;
    const bookingIds: string[] = [];
    for (const group of bookingGroups) {
      const bookingId = generateId();
      bookingIds.push(bookingId);
      const durationMinutes = group.slotCount * slotDuration;
      const { startAt, endAt } = slotToTimestamps(group.date, group.startMinutes, durationMinutes);
      await createBooking(
        db, bookingId, owner.id, bookerName, bookerEmail, note,
        startAt, endAt, durationMinutes, [group.resourceId],
        status, status === "pending_confirmation" ? confirmationToken : null
      );
      totalPrice += (resourceRowMap[group.resourceId]?.price_per_slot ?? 0) * group.slotCount;
    }

    if (status === "pending_confirmation" && hasEmail) {
      const appUrl = env.APP_URL ?? "http://localhost:5173";
      const confirmUrl = `${appUrl}/booking/confirm?token=${confirmationToken}`;
      const emailRows = bookingGroups.map((g) => {
        const rInfo = resourceRowMap[g.resourceId];
        const endMinutes = g.startMinutes + g.slotCount * slotDuration;
        const groupPrice = (rInfo?.price_per_slot ?? 0) * g.slotCount;
        return {
          resourceName: rInfo?.name ?? "Resource",
          date: g.date,
          startTime: minutesToTime12(g.startMinutes),
          endTime: minutesToTime12(endMinutes),
          priceStr: groupPrice > 0 ? `$${(groupPrice / 100).toFixed(2)}` : "Free",
        };
      });
      await sendMultiBookingVerificationEmail(env.RESEND_API_KEY, {
        to: bookerEmail, bookerName, bookingRows: emailRows,
        totalPrice, note, ownerEmail: owner.email, ownerName: owner.name, confirmUrl,
      });
    }

    if (status === "confirmed" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      const gcal = await getGCalConnection(db, owner.id);
      if (gcal) {
        for (let i = 0; i < bookingGroups.length; i++) {
          const group = bookingGroups[i];
          const bookingId = bookingIds[i];
          const rInfo = resourceRowMap[group.resourceId];
          const durationMinutes = group.slotCount * slotDuration;
          const { startAt, endAt } = slotToTimestamps(group.date, group.startMinutes, durationMinutes);
          const eventId = await createCalendarEvent(
            db, owner.id, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, {
              summary: rInfo?.name ?? "Booking",
              description: `Booker: ${bookerName} (${bookerEmail})${note ? `\nNote: ${note}` : ""}`,
              startIso: toLocalIso(group.date, group.startMinutes),
              endIso: toLocalIso(group.date, group.startMinutes + durationMinutes),
              timezone: owner.timezone ?? "UTC",
            }
          );
          if (eventId) await setBookingGoogleEventId(db, bookingId, eventId);
        }
      }
    }

    return data({ bookingId: bookingIds[0], status, requiresEmailConfirmation: status === "pending_confirmation" });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

// ── Client helpers ────────────────────────────────────

type Step = 2 | 3 | 4;

interface SelectedItem {
  resourceId: string;
  date: string;
  slotIndex: number;
}

interface BookingState {
  step: Step;
  resourceIds: string[];
  selectedItems: SelectedItem[];
  weekStart: string;
  bookingId: string | null;
  requiresEmailConfirmation: boolean;
  paymentClientSecret: string | null;
}

interface ResourceInfo {
  id: string;
  name: string;
  slotDuration: number;
  pricePerSlot: number;
  color: string;
}

/** A contiguous block of slots for a single resource on a single date. */
interface BookingGroup {
  resourceId: string;
  date: string;
  startMinutes: number;
  slotCount: number;
}

/**
 * Groups selected items into contiguous booking blocks per (resourceId, date).
 * Non-adjacent slots on the same resource+date become separate groups.
 */
function buildBookingGroups(
  resolvedItems: Array<{ resourceId: string; date: string; slot: TimeSlot; info: ResourceInfo }>,
  slotDuration: number
): BookingGroup[] {
  if (resolvedItems.length === 0) return [];

  // Group by (resourceId::date)
  const map = new Map<string, typeof resolvedItems>();
  for (const item of resolvedItems) {
    const key = `${item.resourceId}::${item.date}`;
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }

  const groups: BookingGroup[] = [];
  for (const items of map.values()) {
    const sorted = [...items].sort((a, b) => a.slot.startMinutes - b.slot.startMinutes);
    let runStart = sorted[0].slot.startMinutes;
    let runCount = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].slot.startMinutes === runStart + runCount * slotDuration) {
        runCount++;
      } else {
        groups.push({ resourceId: sorted[0].resourceId, date: sorted[0].date, startMinutes: runStart, slotCount: runCount });
        runStart = sorted[i].slot.startMinutes;
        runCount = 1;
      }
    }
    groups.push({ resourceId: sorted[0].resourceId, date: sorted[0].date, startMinutes: runStart, slotCount: runCount });
  }

  // Sort by date, then start time
  groups.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);
  return groups;
}

function addDaysToDateStr(d: string, n: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

// ── CheckoutForm ─────────────────────────────────────

function CheckoutForm({
  total,
  onSuccess,
}: {
  total: number;
  onSuccess: (paymentIntentId: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError("");

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
    } else if (paymentIntent?.status === "succeeded") {
      onSuccess(paymentIntent.id);
    } else {
      setError("Payment could not be completed. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <div className="rounded-btn bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-700">
          {error}
        </div>
      )}
      <Button type="submit" loading={submitting || !stripe} className="w-full">
        Pay {formatPrice(total)} →
      </Button>
    </form>
  );
}

// ── Component ─────────────────────────────────────────

export default function PublicBookingPage() {
  const { owner, resources, stripePublishableKey, ownerTimezone } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const mountInitiated = React.useRef(false);

  const stripePromise = useMemo(
    () =>
      typeof window !== "undefined" && stripePublishableKey
        ? loadStripe(stripePublishableKey)
        : null,
    [stripePublishableKey]
  );

  const [state, setState] = useState<BookingState>({
    step: 2,
    resourceIds: resources.map((r) => r.id),
    selectedItems: [],
    weekStart: currentWeekStart(),
    bookingId: null,
    requiresEmailConfirmation: false,
    paymentClientSecret: null,
  });

  const [slotsByResource, setSlotsByResource] = useState<Record<string, SlotsByDate>>({});
  const [resourceInfo, setResourceInfo] = useState<ResourceInfo[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [bookerName, setBookerName] = useState(() => searchParams.get("bookerName") ?? "");
  const [bookerEmail, setBookerEmail] = useState(() => searchParams.get("bookerEmail") ?? "");
  const [bookerNote, setBookerNote] = useState("");

  useEffect(() => {
    // Prevent React StrictMode double-invoke from clearing restored state
    if (mountInitiated.current) return;
    mountInitiated.current = true;

    // Restore saved slot selection after Google/Apple OAuth redirect
    const savedJson = sessionStorage.getItem(`thyme_slots_${owner.slug}`);
    if (savedJson && (searchParams.get("bookerName") || searchParams.get("bookerEmail"))) {
      try {
        const saved = JSON.parse(savedJson) as {
          selectedItems: SelectedItem[];
          weekStart: string;
          slotsByResource: Record<string, SlotsByDate>;
          resourceInfo: ResourceInfo[];
        };
        sessionStorage.removeItem(`thyme_slots_${owner.slug}`);
        // Restore everything at once — no re-fetch needed
        setState((s) => ({ ...s, selectedItems: saved.selectedItems, weekStart: saved.weekStart, step: 3 }));
        setSlotsByResource(saved.slotsByResource ?? {});
        setResourceInfo(saved.resourceInfo ?? []);
        return;
      } catch {
        sessionStorage.removeItem(`thyme_slots_${owner.slug}`);
      }
    }
    fetchSlots(currentWeekStart(), resources.map((r) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = fetcher.data as any;
    if (!d) return;
    if ("slotsByResource" in d) {
      setSlotsByResource(d.slotsByResource ?? {});
      setResourceInfo(d.resourceInfo ?? []);
      setLoadingSlots(false);
    }
    if ("clientSecret" in d && d.clientSecret) {
      setFormErrors({});
      setState((s) => ({ ...s, paymentClientSecret: d.clientSecret as string }));
    }
    if ("bookingId" in d && d.bookingId) {
      setState((s) => ({ ...s, step: 4, bookingId: d.bookingId, requiresEmailConfirmation: d.requiresEmailConfirmation ?? false, paymentClientSecret: null }));
    }
    if ("errors" in d) setFormErrors(d.errors ?? {});
  }, [fetcher.data]);

  function fetchSlots(weekStart: string, resourceIds?: string[]) {
    const ids = resourceIds ?? state.resourceIds;
    if (ids.length === 0) return;
    setLoadingSlots(true);
    setSlotsByResource({});
    setState((s) => ({ ...s, selectedItems: [] }));
    const fd = new FormData();
    fd.append("intent", "get-slots");
    fd.append("resourceIds", ids.join(","));
    fd.append("weekStart", weekStart);
    fetcher.submit(fd, { method: "post" });
  }

  function changeWeek(direction: -1 | 1) {
    const newWeekStart = addDaysToDateStr(state.weekStart, direction * 7);
    setState((s) => ({ ...s, weekStart: newWeekStart }));
    // Don't clear selections when browsing weeks — just load more slots
    const fd = new FormData();
    fd.append("intent", "get-slots");
    fd.append("resourceIds", state.resourceIds.join(","));
    fd.append("weekStart", newWeekStart);
    setLoadingSlots(true);
    fetcher.submit(fd, { method: "post" });
  }

  function toggleSlot(resourceId: string, date: string, slotIndex: number) {
    setState((s) => {
      const existsAt = s.selectedItems.findIndex(
        (x) => x.resourceId === resourceId && x.date === date && x.slotIndex === slotIndex
      );
      if (existsAt !== -1) {
        return { ...s, selectedItems: s.selectedItems.filter((_, i) => i !== existsAt) };
      }
      return { ...s, selectedItems: [...s.selectedItems, { resourceId, date, slotIndex }] };
    });
  }

  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) weekDates.push(addDaysToDateStr(state.weekStart, i));

  const resourceInfoMap: Record<string, ResourceInfo> = Object.fromEntries(
    resourceInfo.map((r) => [r.id, r])
  );
  const slotDuration = resourceInfo[0]?.slotDuration ?? 60;

  // Resolve selected items into full slot objects
  const resolvedItems = state.selectedItems
    .map((item) => {
      const slot = slotsByResource[item.resourceId]?.[item.date]?.[item.slotIndex];
      const info = resourceInfoMap[item.resourceId];
      return slot && info ? { ...item, slot, info } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Group into contiguous booking blocks
  const bookingGroups = buildBookingGroups(resolvedItems, slotDuration);
  const canContinue = bookingGroups.length > 0;

  // Total duration = sum of actual selected slot durations (not min→max span)
  const totalDuration = bookingGroups.reduce((s, g) => s + g.slotCount * slotDuration, 0);

  // Total price = each resource's price × how many slots it has selected
  const totalPrice = bookingGroups.reduce((s, g) => {
    const rInfo = resourceInfoMap[g.resourceId];
    return s + (rInfo?.pricePerSlot ?? 0) * g.slotCount;
  }, 0);

  const selectedResourceNames = [...new Set(
    bookingGroups.map((g) => resourceInfoMap[g.resourceId]?.name ?? "").filter(Boolean)
  )];

  const stripeEnabled = !!stripePublishableKey;
  const isPaidBooking = totalPrice > 0 && stripeEnabled;

  // Compute "today" and "now" in owner's timezone to disable past slots
  const [todayTzDate, nowTzMinutes] = useMemo(() => {
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: ownerTimezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const p: Record<string, string> = {};
      for (const part of parts) p[part.type] = part.value;
      const dateStr = `${p.year}-${p.month}-${p.day}`;
      const mins = parseInt(p.hour) * 60 + parseInt(p.minute);
      return [dateStr, mins] as const;
    } catch {
      // Fallback to UTC if timezone is invalid
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
      return [dateStr, mins] as const;
    }
  }, [ownerTimezone]);

  function handlePaymentSuccess(paymentIntentId: string) {
    setFormErrors({});
    const fd = new FormData();
    fd.append("intent", "confirm");
    fd.append("bookings", JSON.stringify(bookingGroups));
    fd.append("slotDuration", String(slotDuration));
    fd.append("bookerName", bookerName);
    fd.append("bookerEmail", bookerEmail);
    fd.append("note", bookerNote);
    fd.append("stripePaymentIntentId", paymentIntentId);
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <div className="min-h-screen bg-apple-gray">
      <header className="section-dark py-10">
        <div className="content-width text-center">
          <p className="text-micro text-white/50 uppercase tracking-widest mb-3">Booking</p>
          <h1 className="text-display text-white">{owner.name}</h1>
        </div>
      </header>

      {state.step < 4 && (
        <div className="bg-white border-b border-apple-gray/60">
          <div className="content-width py-4">
            <div className="flex items-center gap-2">
              {(["Slots", "Confirm"] as const).map((label, i) => {
                const sNum = (i === 0 ? 2 : 3) as Step;
                const active = state.step === sNum;
                const done = state.step > sNum;
                return (
                  <div key={sNum} className="flex items-center gap-2">
                    <div className={["h-6 w-6 rounded-full flex items-center justify-center text-[12px] font-semibold transition-colors",
                      active ? "bg-apple-blue text-white" : done ? "bg-apple-blue/20 text-apple-blue" : "bg-apple-gray text-apple-near-black/40",
                    ].join(" ")}>{i + 1}</div>
                    <span className={["text-[13px] hidden sm:inline", active ? "text-apple-near-black font-medium" : "text-apple-near-black/40"].join(" ")}>
                      {label}
                    </span>
                    {i < 1 && <span className="text-apple-near-black/20 text-[12px]">›</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="content-width py-10">

        {/* Step 2: Per-resource slot picker */}
        {state.step === 2 && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-tile-heading text-apple-near-black mb-1">Choose your slots</h2>
                <p className="text-caption text-apple-near-black/50">
                  {resources.length > 1
                    ? `${resources.length} courts available · ${formatDuration(slotDuration)} per slot`
                    : `${resources[0]?.name ?? "Resource"} · ${formatDuration(slotDuration)} per slot`}
                </p>
                <p className="text-[12px] text-apple-near-black/40 mt-1">
                  Pick any slots across any day or court. Select multiple to build your schedule.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => changeWeek(-1)} className="h-8 w-8 rounded-full border border-apple-near-black/10 flex items-center justify-center hover:bg-apple-gray transition-colors text-apple-near-black">‹</button>
                <span className="text-[14px] font-medium text-apple-near-black min-w-[140px] text-center">
                  {new Date(state.weekStart + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <button onClick={() => changeWeek(1)} className="h-8 w-8 rounded-full border border-apple-near-black/10 flex items-center justify-center hover:bg-apple-gray transition-colors text-apple-near-black">›</button>
              </div>
            </div>
            <p className="text-micro text-apple-near-black/40 mb-4">
              Times shown in {ownerTimezone.replace("_", " ")}
            </p>

            {/* Selection summary bar */}
            {canContinue && (
              <div className="bg-apple-blue/10 border border-apple-blue/20 rounded-btn px-4 py-3 mb-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[14px] text-apple-blue font-medium">
                      {resolvedItems.length} slot{resolvedItems.length !== 1 ? "s" : ""} selected ·{" "}
                      {formatDurationLong(totalDuration)}{totalPrice > 0 ? ` · ${formatPrice(totalPrice)}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {bookingGroups.map((g, i) => {
                        const rName = resourceInfoMap[g.resourceId]?.name ?? "";
                        const endMin = g.startMinutes + g.slotCount * slotDuration;
                        const dateShort = new Date(g.date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                        return (
                          <span key={i} className="text-[11px] text-apple-blue/70">
                            {rName}: {dateShort}, {minutesToTime12(g.startMinutes)}–{minutesToTime12(endMin)}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setState((s) => ({ ...s, step: 3 }))}>Continue →</Button>
                </div>
              </div>
            )}

            {loadingSlots ? (
              <div className="flex justify-center py-16"><span className="spinner" /></div>
            ) : (
              <div className="overflow-x-auto">
                <div className="slot-grid min-w-[500px]">
                  {weekDates.map((date) => {
                    const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();
                    const dayNum = parseInt(date.slice(8, 10));
                    const monthName = new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short" });

                    const dayEntries: { resourceId: string; resourceName: string; slotIndex: number; slot: TimeSlot }[] = [];
                    for (const r of resourceInfo) {
                      const daySlots = slotsByResource[r.id]?.[date] ?? [];
                      daySlots.forEach((slot, slotIndex) => {
                        dayEntries.push({ resourceId: r.id, resourceName: r.name, slotIndex, slot });
                      });
                    }
                    dayEntries.sort((a, b) =>
                      a.slot.startMinutes - b.slot.startMinutes || a.resourceName.localeCompare(b.resourceName)
                    );

                    return (
                      <div key={date} className="flex flex-col gap-1.5">
                        <div className="text-center pb-2 border-b border-apple-gray">
                          <p className="text-micro text-apple-near-black/40 uppercase">{DAY_SHORT[dayOfWeek]}</p>
                          <p className="text-[18px] font-semibold text-apple-near-black">{dayNum}</p>
                          <p className="text-micro text-apple-near-black/40">{monthName}</p>
                        </div>
                        {dayEntries.length === 0 ? (
                          <p className="text-[11px] text-apple-near-black/30 text-center py-2">—</p>
                        ) : (
                          dayEntries.map(({ resourceId, resourceName, slotIndex, slot }) => {
                            const isSelected = state.selectedItems.some(
                              (x) => x.resourceId === resourceId && x.date === date && x.slotIndex === slotIndex
                            );
                            const isPast = date < todayTzDate || (date === todayTzDate && slot.endMinutes <= nowTzMinutes);
                            const color = resourceInfoMap[resourceId]?.color ?? "#3b82f6";
                            return (
                              <button
                                key={`${resourceId}-${slotIndex}`}
                                disabled={!slot.available || isPast}
                                onClick={() => toggleSlot(resourceId, date, slotIndex)}
                                title={slot.available ? `${resourceName} – ${minutesToTime12(slot.startMinutes)} – ${minutesToTime12(slot.endMinutes)}` : "Unavailable"}
                                className={["rounded-btn px-1.5 py-2 text-center transition-all",
                                  slot.available && !isPast
                                    ? "border shadow-sm cursor-pointer"
                                    : "bg-apple-gray text-apple-near-black/20 cursor-not-allowed border border-transparent",
                                ].join(" ")}
                                style={slot.available && !isPast ? (
                                  isSelected ? {
                                    background: `linear-gradient(135deg, ${color}40 0%, ${color}70 100%)`,
                                    borderColor: `${color}99`,
                                    color,
                                  } : {
                                    background: `linear-gradient(135deg, ${color}0a 0%, ${color}18 100%)`,
                                    borderColor: `${color}30`,
                                    color,
                                  }
                                ) : undefined}
                              >
                                <span className="block text-[10px] font-medium leading-tight mb-0.5 truncate opacity-70">
                                  {resourceName}
                                </span>
                                <span className="block text-[12px] font-semibold">
                                  {minutesToTime12(slot.startMinutes)}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Contact form / Payment */}
        {state.step === 3 && canContinue && (
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => {
                if (state.paymentClientSecret) {
                  setState((s) => ({ ...s, paymentClientSecret: null }));
                  setFormErrors({});
                } else {
                  setState((s) => ({ ...s, step: 2 }));
                }
              }}
              className="text-caption text-apple-link-blue hover:underline mb-6 block"
            >
              ← Back
            </button>
            <h2 className="text-tile-heading text-apple-near-black mb-2">
              {state.paymentClientSecret ? "Complete payment" : "Complete your booking"}
            </h2>

            {/* Booking summary */}
            <div className="bg-white rounded-card p-5 mb-6 shadow-card">
              <h3 className="text-[13px] font-semibold text-apple-near-black/50 uppercase tracking-wider mb-3">
                Your booking{bookingGroups.length > 1 ? "s" : ""}
              </h3>
              <div className="space-y-2">
                {bookingGroups.map((g, i) => {
                  const rInfo = resourceInfoMap[g.resourceId];
                  const endMin = g.startMinutes + g.slotCount * slotDuration;
                  const groupPrice = (rInfo?.pricePerSlot ?? 0) * g.slotCount;
                  const dateStr = new Date(g.date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  return (
                    <div key={i} className="flex justify-between items-center text-[14px] py-1.5 border-b border-apple-gray last:border-b-0">
                      <div>
                        <p className="font-medium text-apple-near-black">{rInfo?.name ?? "Resource"}</p>
                        <p className="text-apple-near-black/50 text-[12px]">{dateStr} · {minutesToTime12(g.startMinutes)}–{minutesToTime12(endMin)}</p>
                      </div>
                      <span className="text-[13px] text-apple-near-black/60 shrink-0 ml-4">
                        {groupPrice > 0 ? formatPrice(groupPrice) : "Free"}
                      </span>
                    </div>
                  );
                })}
              </div>
              {totalPrice > 0 && (
                <div className="flex justify-between border-t border-apple-gray pt-3 mt-3 text-[15px]">
                  <span className="font-semibold text-apple-near-black">Total</span>
                  <span className="font-bold text-apple-near-black">{formatPrice(totalPrice)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 text-[13px] text-apple-near-black/50">
                <span>Total duration</span>
                <span>{formatDurationLong(totalDuration)}</span>
              </div>
            </div>

            {!state.paymentClientSecret ? (
              /* ── Contact form ── */
              <fetcher.Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value={isPaidBooking ? "create-payment-intent" : "confirm"} />
                <input type="hidden" name="bookings" value={JSON.stringify(bookingGroups)} />
                <input type="hidden" name="slotDuration" value={slotDuration} />

                {/* Social sign-in shortcuts */}
                {(() => {
                  const saveForOAuth = () =>
                    sessionStorage.setItem(
                      `thyme_slots_${owner.slug}`,
                      JSON.stringify({ selectedItems: state.selectedItems, weekStart: state.weekStart, slotsByResource, resourceInfo })
                    );
                  return (
                    <div className="flex flex-col gap-2">
                      <a
                        href={`/auth/booker/google/${owner.slug}`}
                        onClick={saveForOAuth}
                        className="flex items-center justify-center gap-2.5 w-full border border-apple-near-black/15 rounded-btn px-4 py-2.5 text-[14px] font-medium text-apple-near-black hover:bg-apple-gray transition-colors"
                      >
                        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                          <g fill="none" fillRule="evenodd">
                            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                          </g>
                        </svg>
                        Continue with Google
                      </a>
                      <a
                        href={`/auth/booker/apple/${owner.slug}`}
                        onClick={saveForOAuth}
                        className="flex items-center justify-center gap-2.5 w-full border border-apple-near-black/15 rounded-btn px-4 py-2.5 text-[14px] font-medium text-apple-near-black hover:bg-apple-gray transition-colors"
                      >
                        <svg width="17" height="20" viewBox="0 0 814 1000" xmlns="http://www.w3.org/2000/svg">
                          <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 public 388.7 0 292.8 0 234 0 135.9 42.1 92.5 132.3c-28.5 57.8-36.4 119.6-36.4 182.2 0 230.8 144.1 435 214.1 543.9 51.4 79.6 124.4 168.3 213.1 168.3s113.5-38.4 199.8-38.4c83.8 0 102.6 38.4 196.3 38.4s133.8-76.6 193.9-160.4c69.5-98.3 98.4-193.3 100.1-198.8-5.8-2.6-193.5-76.9-193.5-298.4 0-190.5 141.8-278.3 150.6-282.9z" fill="currentColor"/>
                          <path d="M551.5 64.6c46.4-52.7 78.2-126.4 78.2-200.1 0-10.3-.6-20.7-2.6-29.1-74.4 2.6-163.7 49.3-217.9 110.5-41.5 46.4-80.6 120.1-80.6 194.8 0 11 1.9 22 2.6 25.6 4.5.6 11.6 1.9 19.5 1.9 66.6 0 150.6-44.6 200.8-103.7z" fill="currentColor"/>
                        </svg>
                        Continue with Apple
                      </a>
                    </div>
                  );
                })()}

                <div className="relative flex items-center gap-3">
                  <div className="flex-1 border-t border-apple-near-black/10" />
                  <span className="text-micro text-apple-near-black/30">or fill in manually</span>
                  <div className="flex-1 border-t border-apple-near-black/10" />
                </div>

                {formErrors.general && (
                  <div className="rounded-btn bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-700">{formErrors.general}</div>
                )}
                <Input
                  label="Your name"
                  name="bookerName"
                  type="text"
                  required
                  placeholder="Alex Johnson"
                  error={formErrors.bookerName}
                  value={bookerName}
                  onChange={(e) => setBookerName(e.target.value)}
                />
                <Input
                  label="Email address"
                  name="bookerEmail"
                  type="email"
                  required
                  placeholder="you@example.com"
                  error={formErrors.bookerEmail}
                  value={bookerEmail}
                  onChange={(e) => setBookerEmail(e.target.value)}
                />
                <Textarea
                  label="Note (optional)"
                  name="note"
                  placeholder="Any details for the owner…"
                  rows={3}
                  value={bookerNote}
                  onChange={(e) => setBookerNote(e.target.value)}
                />
                <Button type="submit" loading={fetcher.state === "submitting"} className="w-full">
                  {isPaidBooking ? `Continue to payment · ${formatPrice(totalPrice)} →` : "Confirm booking →"}
                </Button>
              </fetcher.Form>
            ) : (
              /* ── Stripe payment form ── */
              stripePromise ? (
                <div className="space-y-4">
                  <p className="text-[13px] text-apple-near-black/60">
                    Enter your card details to complete your booking.
                  </p>
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: state.paymentClientSecret,
                      appearance: {
                        theme: "stripe",
                        variables: {
                          colorPrimary: "#1d1d1f",
                          colorBackground: "#ffffff",
                          colorText: "#1d1d1f",
                          colorDanger: "#dc2626",
                          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
                          borderRadius: "8px",
                          spacingUnit: "4px",
                        },
                        rules: {
                          ".Input": { border: "1px solid rgba(29,29,31,0.15)", boxShadow: "none", padding: "10px 14px" },
                          ".Input:focus": { border: "1px solid #1d1d1f", boxShadow: "none" },
                          ".Label": { fontSize: "12px", fontWeight: "500", textTransform: "uppercase", letterSpacing: "0.05em", color: "#86868b" },
                          ".Tab": { border: "1px solid rgba(29,29,31,0.15)", boxShadow: "none" },
                          ".Tab--selected": { border: "1px solid #1d1d1f", boxShadow: "none" },
                        },
                      },
                    }}
                  >
                    <CheckoutForm total={totalPrice} onSuccess={handlePaymentSuccess} />
                  </Elements>
                  {fetcher.state === "submitting" && (
                    <div className="flex items-center gap-2 text-[13px] text-apple-near-black/50">
                      <span className="spinner" />
                      <span>Confirming your booking…</span>
                    </div>
                  )}
                  {formErrors.general && (
                    <div className="rounded-btn bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-700">
                      {formErrors.general}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[14px] text-apple-near-black/50">
                  Payment form unavailable. Please refresh and try again.
                </p>
              )
            )}
          </div>
        )}

        {/* Step 4: Success */}
        {state.step === 4 && (
          <div className="max-w-lg mx-auto py-10">
            <div className="text-center mb-8">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-green-600">
                  <path d="M5 14l7 7 11-12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              {state.requiresEmailConfirmation ? (
                <>
                  <h2 className="text-tile-heading text-apple-near-black mb-3">Check your email</h2>
                  <p className="text-body text-apple-near-black/60">
                    We sent a confirmation link to your email. Click it to confirm your booking — the slot{bookingGroups.length > 1 ? "s are" : " is"} held for you.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-tile-heading text-apple-near-black mb-3">You&rsquo;re booked!</h2>
                  <p className="text-body text-apple-near-black/60">Your booking is confirmed. See you then!</p>
                </>
              )}
            </div>

            {/* Booking summary */}
            <div className="bg-white rounded-card p-5 mb-6 shadow-card">
              <h3 className="text-[13px] font-semibold text-apple-near-black/50 uppercase tracking-wider mb-3">
                Booking summary
              </h3>
              {bookerName && (
                <div className="flex justify-between text-[14px] py-1.5 border-b border-apple-gray">
                  <span className="text-apple-near-black/50">Name</span>
                  <span className="font-medium text-apple-near-black">{bookerName}</span>
                </div>
              )}
              {bookerEmail && (
                <div className="flex justify-between text-[14px] py-1.5 border-b border-apple-gray">
                  <span className="text-apple-near-black/50">Email</span>
                  <span className="font-medium text-apple-near-black">{bookerEmail}</span>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {bookingGroups.map((g, i) => {
                  const rInfo = resourceInfoMap[g.resourceId];
                  const endMin = g.startMinutes + g.slotCount * slotDuration;
                  const groupPrice = (rInfo?.pricePerSlot ?? 0) * g.slotCount;
                  const dateStr = new Date(g.date + "T00:00:00Z").toLocaleDateString("en-US", {
                    weekday: "long", month: "long", day: "numeric", year: "numeric",
                  });
                  return (
                    <div key={i} className="flex justify-between items-start text-[14px] py-1.5 border-b border-apple-gray last:border-b-0">
                      <div>
                        <p className="font-medium text-apple-near-black">{rInfo?.name ?? "Resource"}</p>
                        <p className="text-apple-near-black/50 text-[12px]">{dateStr}</p>
                        <p className="text-apple-near-black/50 text-[12px]">
                          {minutesToTime12(g.startMinutes)} – {minutesToTime12(endMin)} · {formatDurationLong(g.slotCount * slotDuration)}
                        </p>
                      </div>
                      {groupPrice > 0 && (
                        <span className="text-[13px] font-medium text-apple-near-black shrink-0 ml-4">{formatPrice(groupPrice)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {totalPrice > 0 && (
                <div className="flex justify-between border-t border-apple-gray pt-3 mt-1 text-[15px]">
                  <span className="font-semibold text-apple-near-black">Total paid</span>
                  <span className="font-bold text-apple-near-black">{formatPrice(totalPrice)}</span>
                </div>
              )}
              <p className="text-micro text-apple-near-black/40 mt-3">
                Times shown in {ownerTimezone.replace(/_/g, " ")}
              </p>
            </div>

            <div className="text-center">
              <Button variant="secondary" onClick={() => {
                setState({
                  step: 2,
                  resourceIds: resources.map((r) => r.id),
                  selectedItems: [],
                  weekStart: currentWeekStart(),
                  bookingId: null,
                  requiresEmailConfirmation: false,
                  paymentClientSecret: null,
                });
                setBookerName("");
                setBookerEmail("");
                setBookerNote("");
                setSlotsByResource({});
                fetchSlots(currentWeekStart(), resources.map((r) => r.id));
              }}>
                Book another time
              </Button>
            </div>
          </div>
        )}
      </div>

      <footer className="content-width py-8 text-center">
        <p className="text-micro text-apple-near-black/30">Thyme by Vine · {owner.name}</p>
      </footer>
    </div>
  );
}
