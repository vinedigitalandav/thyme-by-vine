import { redirect } from "@remix-run/cloudflare";

// Logout is handled client-side by Clerk via the SignOutButton in the nav.
// This route is kept as a fallback redirect for any direct GET navigation.
export async function loader() {
  return redirect("/login");
}

export async function action() {
  return redirect("/login");
}

