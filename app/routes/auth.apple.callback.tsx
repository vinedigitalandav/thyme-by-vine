import { redirect } from "@remix-run/cloudflare";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";

/**
 * Apple Sign In callback — Apple uses response_mode=form_post, so this
 * is a POST handler. The loader handles the unlikely GET (e.g. user cancels).
 *
 * Apple sends in the POST body:
 *   code       — authorization code
 *   id_token   — JWT with email (and sub) in payload
 *   state      — our state param
 *   user        — JSON string with name (FIRST authorization only)
 *   error       — present on denial
 */
export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const state = String(form.get("state") ?? "");
  const idToken = String(form.get("id_token") ?? "");
  const error = form.get("error");

  // ── apple_booker flow ─────────────────────────────
  if (state.startsWith("apple_booker:")) {
    const slug = state.split(":")[1] ?? "";

    if (error || !idToken) return redirect(`/${slug}`);

    let email = "";
    let name = "";
    try {
      // Decode the id_token JWT payload (base64url) — no signature verification
      // needed here since we're only pre-filling a contact form, not authenticating.
      const payloadB64 = idToken.split(".")[1] ?? "";
      const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
      const json = atob(padded);
      const payload = JSON.parse(json) as { email?: string; email_verified?: boolean };
      email = payload.email ?? "";

      // Apple sends the user's name only on the very first authorization.
      const userJson = form.get("user");
      if (userJson) {
        const userInfo = JSON.parse(String(userJson)) as {
          name?: { firstName?: string; lastName?: string };
        };
        name = [userInfo.name?.firstName, userInfo.name?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
      }
      if (!name) name = email.split("@")[0];
    } catch (err) {
      console.error("[apple-callback]", err);
      return redirect(`/${slug}`);
    }

    const params = new URLSearchParams({ bookerName: name, bookerEmail: email });
    return redirect(`/${slug}?${params}`);
  }

  return redirect("/");
}

// Apple may also GET this URL when the user taps "Cancel"
export async function loader(_: LoaderFunctionArgs) {
  return redirect("/");
}
