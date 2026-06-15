import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { rootAuthLoader } from "@clerk/remix/ssr.server";
import { ClerkApp } from "@clerk/remix";
import globalStyles from "~/styles/globals.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: globalStyles },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
];

export const loader = ({ request, context }: LoaderFunctionArgs) =>
  rootAuthLoader(
    { request, context, params: {} },
    {
      secretKey: context.cloudflare.env.CLERK_SECRET_KEY,
      publishableKey: context.cloudflare.env.CLERK_PUBLISHABLE_KEY,
    }
  );

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <Meta />
        <Links />
      </head>
      <body className="h-full antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function App() {
  return <Outlet />;
}

export default ClerkApp(App);

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something went wrong</title>
        <Links />
      </head>
      <body className="h-full flex items-center justify-center bg-apple-gray">
        <div className="text-center content-width py-24">
          {isRouteErrorResponse(error) ? (
            <>
              <p className="text-micro text-apple-blue uppercase tracking-widest mb-4">
                {error.status} Error
              </p>
              <h1 className="text-section-heading text-apple-near-black mb-4">
                {error.statusText || "Page not found"}
              </h1>
              <p className="text-body text-apple-near-black/60 mb-8">
                {error.status === 404
                  ? "The page you're looking for doesn't exist."
                  : "Something went wrong on our end."}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-section-heading text-apple-near-black mb-4">
                Unexpected Error
              </h1>
              <p className="text-body text-apple-near-black/60 mb-8">
                Something went wrong. Please try again.
              </p>
            </>
          )}
          <a
            href="/"
            className="inline-block bg-apple-blue text-white text-body px-6 py-2 rounded-btn hover:opacity-90 transition-opacity"
          >
            Go home
          </a>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
