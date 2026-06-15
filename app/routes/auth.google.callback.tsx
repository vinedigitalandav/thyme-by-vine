import { redirect } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  exchangeGoogleCode,
  upsertGCalConnection,
} from "~/lib/google-calendar.server";
import { getAuthOwnerId } from "~/lib/auth.server";
import { generateId } from "~/lib/utils";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const env = context.cloudflare.env;
  const redirectUri = `${env.APP_URL}/auth/google/callback`;

  // ── Booker pre-fill flow ─────────────────────────────
  if (state?.startsWith("booker:")) {
    if (error || !code) return redirect("/");
    const slug = state.split(":")[1] ?? "";

    let email: string;
    let name: string;
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) throw new Error(await tokenRes.text());
      const tokenData = (await tokenRes.json()) as { access_token: string };

      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) throw new Error("userinfo fetch failed");
      const user = (await userRes.json()) as { email: string; name?: string };
      email = user.email;
      name = user.name?.trim() || email.split("@")[0];
    } catch (err) {
      console.error("[booker-google-callback]", err);
      return redirect(`/${slug}`);
    }

    const params = new URLSearchParams({ bookerName: name, bookerEmail: email });
    return redirect(`/${slug}?${params}`);
  }

  // ── Google Calendar flow ─────────────────────────────
  if (error || !code || !state) {
    return redirect("/dashboard/settings?gcal_error=1");
  }

  const [ownerIdFromState] = state.split(":");
  const sessionOwnerId = await getAuthOwnerId(request, context);
  if (!sessionOwnerId || sessionOwnerId !== ownerIdFromState) {
    return redirect("/dashboard/settings?gcal_error=1");
  }

  try {
    const { accessToken, refreshToken, expiresAt, email } =
      await exchangeGoogleCode(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
        redirectUri,
        code
      );

    await upsertGCalConnection(
      env.DB,
      generateId(),
      sessionOwnerId,
      accessToken,
      refreshToken,
      email,
      expiresAt
    );
  } catch (err) {
    console.error("[google-callback]", err);
    return redirect("/dashboard/settings?gcal_error=1");
  }

  return redirect("/dashboard/settings?gcal_connected=1");
}

