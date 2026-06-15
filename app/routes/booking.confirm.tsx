import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { confirmBookingByToken } from "~/lib/db.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(
      `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:80px">
        <h2>Invalid link</h2><p>No confirmation token found in this link.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" }, status: 400 }
    );
  }

  const booking = await confirmBookingByToken(context.cloudflare.env.DB, token);

  if (!booking) {
    return new Response(
      `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:80px">
        <h2 style="color:#1d1d1f">Link expired or already used</h2>
        <p style="color:#555">This confirmation link has already been used or has expired.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" }, status: 410 }
    );
  }

  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:80px">
      <div style="display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;background:#dcfce7;border-radius:50%;margin-bottom:24px">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <path d="M5 14l7 7 11-12" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2 style="color:#1d1d1f;margin-top:0">Booking confirmed!</h2>
      <p style="color:#555">You're all set. See you then!</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

// Remix requires a default export for routes that may render
export default function ConfirmBooking() {
  return null;
}
