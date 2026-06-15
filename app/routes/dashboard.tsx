import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { requireOwner } from "~/lib/auth.server";
import { getOwnerById } from "~/lib/db.server";
import { useLoaderData } from "@remix-run/react";
import { DashboardLayout } from "~/components/layout/DashboardLayout";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const ownerId = await requireOwner(request, context);
  const owner = await getOwnerById(context.cloudflare.env.DB, ownerId);
  if (!owner) throw new Response("Owner not found", { status: 404 });
  return { ownerName: owner.name, ownerSlug: owner.slug };
}

export default function DashboardRoot() {
  const { ownerName, ownerSlug } = useLoaderData<typeof loader>();
  return (
    <DashboardLayout ownerName={ownerName} ownerSlug={ownerSlug}>
      <Outlet />
    </DashboardLayout>
  );
}
