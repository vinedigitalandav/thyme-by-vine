import { redirect } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { SignIn } from "@clerk/remix";
import { getAuth } from "@clerk/remix/ssr.server";

export const meta: MetaFunction = () => [
  { title: "Sign In — Thyme by Vine" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env;
  const { userId } = await getAuth(
    { request, context, params: {} },
    { secretKey: env.CLERK_SECRET_KEY }
  );
  if (userId) throw redirect("/onboarding");
  return null;
}

export default function LoginPage() {
  return (
    <div className="min-h-screen section-light flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-[28px] font-semibold text-apple-near-black tracking-tight">
            Thyme by Vine
          </h1>
          <p className="text-caption text-apple-near-black/50 mt-1">
            Sign in to your dashboard
          </p>
        </div>
        <SignIn
          routing="hash"
          signUpUrl="/register"
          forceRedirectUrl="/onboarding"
        />
      </div>
    </div>
  );
}

