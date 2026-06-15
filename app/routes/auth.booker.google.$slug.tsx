import { redirect } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";

/**
 * Initiates Google OAuth for a booker on the public booking page.
 * After OAuth, Google redirects to /auth/google/callback with
 * state = "booker:{slug}:{nonce}", which then redirects back to
 * /{slug}?bookerName=...&bookerEmail=... so the form is pre-filled.
 */
export async function loader({ params, context }: LoaderFunctionArgs) {
  const slug = params.slug ?? "";
  const env = context.cloudflare.env;

  // Reuse the already-registered /auth/google/callback URI
  const redirectUri = `${env.APP_URL}/auth/google/callback`;
  const state = `booker:${slug}:${crypto.randomUUID()}`;

  const oauthParams = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${oauthParams}`);
}

export default function BookerGoogleAuth() {
  return null;
}
