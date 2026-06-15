import { data, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useState } from "react";
import { requireOwner } from "~/lib/auth.server";
import {
  getResourcesByOwner,
  createResource,
  updateResource,
  deleteResource,
} from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Badge } from "~/components/ui/Badge";
import { Link } from "@remix-run/react";
import type { Resource } from "~/lib/types";

export const meta: MetaFunction = () => [
  { title: "Resources — Thyme by Vine" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const resources = await getResourcesByOwner(context.cloudflare.env.DB, ownerId);
  return { resources };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const db = context.cloudflare.env.DB;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim() || null;
    const slotDuration = Number(form.get("slot_duration") ?? 60);
    const pricePerSlot = Math.round(parseFloat(String(form.get("price_per_slot") ?? "0")) * 100);
    const color = String(form.get("color") ?? "#3b82f6");
    if (!name) return data({ error: "Resource name is required.", intent: "create" }, { status: 400 });
    try {
      await createResource(db, generateId(), ownerId, name, description, slotDuration, pricePerSlot, color);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return data({ error: `Failed to create: ${msg}`, intent: "create" }, { status: 500 });
    }
    return redirect("/dashboard/resources");
  }

  if (intent === "update") {
    const id = String(form.get("id"));
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim() || null;
    const slotDuration = Number(form.get("slot_duration") ?? 60);
    const pricePerSlot = Math.round(parseFloat(String(form.get("price_per_slot") ?? "0")) * 100);
    const color = String(form.get("color") ?? "#3b82f6");
    if (!name) return data({ error: "Resource name is required.", intent: "update", id }, { status: 400 });
    try {
      await updateResource(db, id, ownerId, {
        name,
        description: description ?? undefined,
        slot_duration: slotDuration,
        price_per_slot: pricePerSlot,
        color,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return data({ error: `Failed to update: ${msg}`, intent: "update", id }, { status: 500 });
    }
    return data({ ok: true, intent: "update" });
  }

  if (intent === "toggle") {
    const id = String(form.get("id"));
    const currentActive = Number(form.get("is_active"));
    await updateResource(db, id, ownerId, { is_active: currentActive === 1 ? 0 : 1 });
    return data({ ok: true, intent: "toggle" });
  }

  if (intent === "delete") {
    const id = String(form.get("id"));
    try {
      await deleteResource(db, id, ownerId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return data({ error: `Failed to delete: ${msg}`, intent: "delete", id }, { status: 500 });
    }
    return data({ ok: true, intent: "delete" });
  }

  return data({ error: "Unknown action.", intent: "" }, { status: 400 });
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

const DURATIONS = [15, 30, 45, 60, 90, 120];

function durationLabel(mins: number) {
  if (mins < 60) return `${mins} min`;
  if (mins === 60) return "1 hour";
  return `${mins / 60} hours`;
}

// ─────────────────────────────────────────────────────
// Per-row component with its own fetcher
// ─────────────────────────────────────────────────────

function ResourceRow({ resource }: { resource: Resource }) {
  const fetcher = useFetcher<typeof action>();
  const [editing, setEditing] = useState(false);
  const [previewColor, setPreviewColor] = useState(resource.color ?? "#3b82f6");

  const fd = fetcher.formData;
  const currentIntent = fd?.get("intent");

  const isTogglingActive = fetcher.state !== "idle" && currentIntent === "toggle";
  const isDeletingRow   = fetcher.state !== "idle" && currentIntent === "delete";
  const isSavingEdit    = fetcher.state !== "idle" && currentIntent === "update";

  // Optimistic active state while toggle is in flight
  const optimisticActive = isTogglingActive
    ? (resource.is_active === 1 ? 0 : 1)
    : resource.is_active;

  // Collapse edit panel after a successful save
  const fetcherData = fetcher.data as Record<string, unknown> | null | undefined;
  const justSaved = fetcherData?.ok === true && fetcherData?.intent === "update";
  if (!isSavingEdit && editing && justSaved) {
    setEditing(false);
  }

  const updateError =
    fetcherData?.intent === "update" && typeof fetcherData.error === "string"
      ? fetcherData.error
      : null;

  const deleteError =
    fetcherData?.intent === "delete" && typeof fetcherData.error === "string"
      ? fetcherData.error
      : null;

  // Optimistically remove the row when delete is in flight (only if no error yet)
  if (isDeletingRow) return null;

  return (
    <div>
      {/* ── Main row ── */}
      <div className="px-6 py-4">
        <div className="flex items-start sm:items-center justify-between gap-4">
          {/* Left: info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: resource.color ?? "#3b82f6" }}
              />
              <p className="font-semibold text-apple-near-black">{resource.name}</p>
              <Badge variant={optimisticActive ? "green" : "gray"}>
                {optimisticActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-caption text-apple-near-black/50 mt-0.5">
              {durationLabel(resource.slot_duration ?? 60)} slots
              {(resource.price_per_slot ?? 0) > 0
                ? ` · $${((resource.price_per_slot ?? 0) / 100).toFixed(2)}/slot`
                : " · Free"}
              {resource.description ? ` · ${resource.description}` : ""}
            </p>
            {deleteError && (
              <p className="text-[13px] text-red-600 mt-1">{deleteError}</p>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-3 shrink-0 text-caption">
            <Link
              to={`/dashboard/availability/${resource.id}`}
              className="text-apple-link-blue hover:underline"
            >
              Availability
            </Link>

            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-apple-near-black/60 hover:text-apple-near-black transition-colors"
            >
              {editing ? "Close" : "Edit"}
            </button>

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="toggle" />
              <input type="hidden" name="id" value={resource.id} />
              <input type="hidden" name="is_active" value={resource.is_active} />
              <button
                type="submit"
                className="text-apple-near-black/50 hover:text-apple-near-black transition-colors"
              >
                {optimisticActive ? "Deactivate" : "Activate"}
              </button>
            </fetcher.Form>

            <fetcher.Form
              method="post"
              onSubmit={(e) => {
                if (!window.confirm(`Delete "${resource.name}"? This cannot be undone.`)) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={resource.id} />
              <button
                type="submit"
                className="text-red-500 hover:text-red-700 transition-colors"
              >
                Delete
              </button>
            </fetcher.Form>
          </div>
        </div>
      </div>

      {/* ── Inline edit panel ── */}
      {editing && (
        <div className="border-t border-apple-gray/60 bg-apple-gray/20 px-6 py-5">
          <p className="text-[13px] font-semibold text-apple-near-black/40 uppercase tracking-wider mb-4">
            Edit resource
          </p>
          {updateError && (
            <p className="mb-3 text-[14px] text-red-600">{updateError}</p>
          )}
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="id" value={resource.id} />

            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                label="Name"
                name="name"
                defaultValue={resource.name}
                required
                className="flex-1"
              />
              <Input
                label="Description"
                name="description"
                defaultValue={resource.description ?? ""}
                placeholder="Optional"
                className="flex-1"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1">
                <label className="block text-[14px] font-medium text-apple-near-black mb-1">
                  Slot duration
                </label>
                <select
                  name="slot_duration"
                  defaultValue={resource.slot_duration ?? 60}
                  className="w-full h-10 rounded-btn border border-apple-near-black/20 bg-white px-3 text-[15px] text-apple-near-black focus:outline-none focus:ring-2 focus:ring-apple-blue"
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>{durationLabel(d)}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <Input
                  label="Price per slot ($)"
                  name="price_per_slot"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={((resource.price_per_slot ?? 0) / 100).toFixed(2)}
                />
              </div>
              <div className="flex gap-2 sm:self-end">
                <Button type="submit" loading={isSavingEdit} size="sm">
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>

            {/* Color picker + slot preview */}
            <div className="flex flex-col sm:flex-row gap-4 items-start pt-1">
              <div>
                <label className="block text-[14px] font-medium text-apple-near-black mb-1">
                  Slot color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    name="color"
                    value={previewColor}
                    onChange={(e) => setPreviewColor(e.target.value)}
                    className="h-10 w-16 rounded-btn border border-apple-near-black/20 cursor-pointer p-0.5 bg-white"
                  />
                  <span className="text-[13px] text-apple-near-black/50 font-mono">{previewColor}</span>
                </div>
              </div>
              {/* Live slot preview */}
              <div>
                <p className="text-[14px] font-medium text-apple-near-black mb-1">Preview</p>
                <div
                  className="rounded-btn px-3 py-2 text-center w-28 border shadow-sm"
                  style={{
                    background: `linear-gradient(135deg, ${previewColor}18 0%, ${previewColor}38 100%)`,
                    borderColor: `${previewColor}55`,
                    color: previewColor,
                  }}
                >
                  <span className="block text-[10px] font-medium leading-tight mb-0.5 truncate opacity-80">
                    {resource.name}
                  </span>
                  <span className="block text-[12px] font-semibold">9:00 AM</span>
                </div>
              </div>
            </div>
          </fetcher.Form>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────

export default function ResourcesPage() {
  const { resources } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<typeof action>();
  const [createColor, setCreateColor] = useState("#3b82f6");

  const createData = createFetcher.data as Record<string, unknown> | null | undefined;
  const createError =
    createData?.intent === "create" && typeof createData?.error === "string"
      ? createData.error
      : null;

  const isCreating = createFetcher.state !== "idle";

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-section-heading text-apple-near-black mb-1">Resources</h2>
        <p className="text-body text-apple-near-black/50">
          Resources are the bookable entities — courts, rooms, people, etc.
        </p>
      </div>

      {/* Create form */}
      <div className="bg-white rounded-card p-6 shadow-card">
        <h3 className="text-card-title mb-4">Add Resource</h3>
        {createError && (
          <p className="mb-4 text-[14px] text-red-600">{createError}</p>
        )}
        <createFetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="create" />
          <div className="flex flex-col sm:flex-row gap-3">
            <Input name="name" label="Name" placeholder="e.g. Court 1" required className="flex-1" />
            <Input name="description" label="Description" placeholder="Optional" className="flex-1" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1">
              <label className="block text-[14px] font-medium text-apple-near-black mb-1">
                Slot duration
              </label>
              <select
                name="slot_duration"
                defaultValue="60"
                className="w-full h-10 rounded-btn border border-apple-near-black/20 bg-white px-3 text-[15px] text-apple-near-black focus:outline-none focus:ring-2 focus:ring-apple-blue"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>{durationLabel(d)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <Input
                label="Price per slot ($)"
                name="price_per_slot"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                defaultValue="0"
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-apple-near-black mb-1">
                Color
              </label>
              <input
                type="color"
                name="color"
                value={createColor}
                onChange={(e) => setCreateColor(e.target.value)}
                className="h-10 w-16 rounded-btn border border-apple-near-black/20 cursor-pointer p-0.5 bg-white"
              />
            </div>
            <Button type="submit" loading={isCreating} className="h-10 sm:self-end">
              Add resource
            </Button>
          </div>
        </createFetcher.Form>
      </div>

      {/* Resource list */}
      {resources.length === 0 ? (
        <div className="bg-white rounded-card p-10 text-center">
          <p className="text-body text-apple-near-black/40">
            No resources yet. Add one above to get started.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-card overflow-hidden shadow-card divide-y divide-apple-gray">
          {resources.map((r) => (
            <ResourceRow key={r.id} resource={r} />
          ))}
        </div>
      )}
    </div>
  );
}
