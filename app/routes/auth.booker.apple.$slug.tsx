import { redirect } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";

/**
 * Initiates Apple Sign In for a booker on the public booking page.
 * Apple uses response_mode=form_post, so the callback is a POST to
 * /auth/apple/callback, handled by auth.apple.callback.tsx.
 *
 * Requires in env:
 *   APPLE_CLIENT_ID — your Services ID (e.g. com.yourcompany.bookings)
 *
 * Also register https://YOURDOMAIN/auth/apple/callback as a redirect URI
 * in your Apple Developer > Certificates, Identifiers & Profiles > Service IDs.
 */
export async function loader({ params, context }: LoaderFunctionArgs) {
  const slug = params.slug ?? "";
  const env = context.cloudflare.env;

  if (!env.APPLE_CLIENT_ID) {
    // Apple not configured — bounce back to the booking page
    return redirect(`/${slug}`);
  }

  const redirectUri = `${env.APP_URL}/auth/apple/callback`;
  const state = `apple_booker:${slug}:${crypto.randomUUID()}`;

  const oauthParams = new URLSearchParams({
    client_id: env.APPLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code id_token",
    response_mode: "form_post",
    scope: "name email",
    state,
  });

  return redirect(`https://appleid.apple.com/auth/authorize?${oauthParams}`);
}

export default function BookerAppleAuth() {
  return null;
}
