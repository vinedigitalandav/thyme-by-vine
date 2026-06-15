import { data, redirect } from "@remix-run/cloudflare";
import { Form, useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { getAuth } from "@clerk/remix/ssr.server";
import { createClerkClient } from "@clerk/backend";
import { getOwnerByClerkId, createOwnerFromClerk } from "~/lib/db.server";
import { generateId, isValidSlug, slugify } from "~/lib/utils";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";

export const meta: MetaFunction = () => [
  { title: "Set Up Your Account — Thyme by Vine" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env;
  const { userId } = await getAuth(
    { request, context, params: {} },
    { secretKey: env.CLERK_SECRET_KEY }
  );
  if (!userId) throw redirect("/login");

  // Already onboarded — go straight to dashboard
  const existing = await getOwnerByClerkId(env.DB, userId);
  if (existing) throw redirect("/dashboard");

  // Pre-fill name from Clerk
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const clerkUser = await clerk.users.getUser(userId);
  const defaultName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    clerkUser.emailAddresses[0]?.emailAddress?.split("@")[0] ||
    "";
  const defaultEmail = clerkUser.emailAddresses[0]?.emailAddress ?? "";

  return { defaultName, defaultEmail };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env;
  const { userId } = await getAuth(
    { request, context, params: {} },
    { secretKey: env.CLERK_SECRET_KEY }
  );
  if (!userId) throw redirect("/login");

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();

  const errors: Record<string, string> = {};
  if (!name || name.length < 2) errors.name = "Name must be at least 2 characters.";
  if (!isValidSlug(slug)) {
    errors.slug =
      "Slug must be 3–60 lowercase letters, numbers, or hyphens (e.g. houston-pickle-club).";
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  // Check slug uniqueness
  const taken = await env.DB.prepare("SELECT id FROM owners WHERE slug = ?")
    .bind(slug)
    .first();
  if (taken) {
    return data(
      { errors: { slug: "This slug is already taken. Please choose another." } },
      { status: 409 }
    );
  }

  const id = generateId();
  // If an owner row already exists with this email (migrated from old auth),
  // claim it by setting the clerk_id rather than inserting a duplicate.
  const existingByEmail = email
    ? await env.DB.prepare("SELECT id FROM owners WHERE email = ?").bind(email).first<{ id: string }>()
    : null;

  if (existingByEmail) {
    await env.DB.prepare("UPDATE owners SET clerk_id = ?, name = ?, slug = ? WHERE id = ?")
      .bind(userId, name, slug, existingByEmail.id)
      .run();
  } else {
    await createOwnerFromClerk(env.DB, id, userId, name, email, slug);
  }

  throw redirect("/dashboard");
}

export default function OnboardingPage() {
  const { defaultName, defaultEmail } = useLoaderData<typeof loader>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();
  const loading = navigation.state === "submitting";
  const errors = (actionData?.errors ?? {}) as Record<string, string>;

  return (
    <div className="min-h-screen section-light flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-[28px] font-semibold text-apple-near-black tracking-tight">
            Almost there
          </h1>
          <p className="text-caption text-apple-near-black/50 mt-1">
            Set up your public booking page
          </p>
        </div>

        <div className="bg-white rounded-card shadow-card p-8">
          <Form method="post" className="flex flex-col gap-5">
            <input type="hidden" name="email" value={defaultEmail} />
            <Input
              label="Your name"
              name="name"
              type="text"
              autoComplete="name"
              required
              placeholder="Alex Johnson"
              defaultValue={defaultName}
              error={errors.name}
            />
            <Input
              label="Booking page slug"
              name="slug"
              type="text"
              required
              placeholder="houston-pickle-club"
              defaultValue={slugify(defaultName)}
              error={errors.slug}
              hint="Your public URL: thymebyvin.com/your-slug"
            />
            <Button type="submit" loading={loading} className="w-full mt-1">
              Create my page →
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
