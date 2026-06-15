import { Link, useLocation } from "@remix-run/react";
import { useClerk } from "@clerk/remix";

interface DashboardLayoutProps {
  children: React.ReactNode;
  ownerName: string;
  ownerSlug: string;
}

const navItems = [
  { label: "Overview", href: "/dashboard" },
  { label: "Resources", href: "/dashboard/resources" },
  { label: "Bookings", href: "/dashboard/bookings" },
  { label: "Settings", href: "/dashboard/settings" },
];

export function DashboardLayout({
  children,
  ownerName,
  ownerSlug,
}: DashboardLayoutProps) {
  const location = useLocation();
  const { signOut } = useClerk();

  return (
    <div className="min-h-screen bg-apple-gray flex flex-col">
      {/* Top Nav */}
      <nav className="sticky top-0 z-50 nav-glass border-b border-white/10" style={{ height: 48 }}>
        <div className="content-width h-full flex items-center justify-between">
          <Link
            to="/dashboard"
            className="text-white text-[17px] font-semibold tracking-tight hover:opacity-80 transition-opacity"
          >
            Thyme by Vine
          </Link>
          <div className="flex items-center gap-6">
            {navItems.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? location.pathname === "/dashboard"
                  : location.pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={[
                    "text-[13px] transition-opacity",
                    isActive
                      ? "text-white font-medium"
                      : "text-white/70 hover:text-white",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
            <span className="text-white/30">|</span>
            <a
              href={`/${ownerSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-apple-bright-blue text-[13px] hover:underline"
            >
              View page ↗
            </a>
            <button
              type="button"
              onClick={() => signOut({ redirectUrl: "/login" })}
              className="text-white/50 text-[13px] hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Page content */}
      <main className="flex-1">
        <div className="content-width py-10">{children}</div>
      </main>

      <footer className="border-t border-apple-near-black/10 py-6">
        <div className="content-width">
          <p className="text-micro text-apple-near-black/40 text-center">
            Thyme by Vine · {ownerName}
          </p>
        </div>
      </footer>
    </div>
  );
}
