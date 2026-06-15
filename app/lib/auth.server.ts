import { getAuth } from "@clerk/remix/ssr.server";
import { redirect } from "@remix-run/cloudflare";
import type { AppLoadContext } from "@remix-run/cloudflare";
import { getOwnerByClerkId } from "./db.server";

// Build a minimal args object accepted by Clerk's getAuth
function clerkArgs(request: Request, context: AppLoadContext) {
  return { request, context, params: {} };
}

function clerkEnv(context: AppLoadContext) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (context.cloudflare as any).env;
}

// ── Require authenticated owner — throws redirect if not ──
export async function requireOwner(
  request: Request,
  context: AppLoadContext
): Promise<string> {
  const env = clerkEnv(context);
  const { userId } = await getAuth(clerkArgs(request, context), {
    secretKey: env.CLERK_SECRET_KEY,
  });
  if (!userId) throw redirect("/login");

  const owner = await getOwnerByClerkId(env.DB, userId);
  if (!owner) throw redirect("/onboarding");
  return owner.id;
}

// ── Get authenticated owner ID without throwing ──
export async function getAuthOwnerId(
  request: Request,
  context: AppLoadContext
): Promise<string | null> {
  const env = clerkEnv(context);
  const { userId } = await getAuth(clerkArgs(request, context), {
    secretKey: env.CLERK_SECRET_KEY,
  });
  if (!userId) return null;
  const owner = await getOwnerByClerkId(env.DB, userId);
  return owner?.id ?? null;
}

// ── Get the raw Clerk userId (used by onboarding before owner row exists) ──
export async function getClerkUserId(
  request: Request,
  context: AppLoadContext
): Promise<string | null> {
  const env = clerkEnv(context);
  const { userId } = await getAuth(clerkArgs(request, context), {
    secretKey: env.CLERK_SECRET_KEY,
  });
  return userId;
}

