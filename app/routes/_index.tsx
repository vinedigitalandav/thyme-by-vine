import { redirect } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getAuthOwnerId } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const ownerId = await getAuthOwnerId(request, context);
  if (ownerId) return redirect("/dashboard");
  return redirect("/login");
}
