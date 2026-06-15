import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-apple-blue text-white hover:bg-blue-600 active:opacity-90 border border-transparent",
  secondary:
    "bg-apple-near-black text-white hover:opacity-80 active:opacity-70 border border-transparent",
  outline:
    "bg-transparent text-apple-link-blue border border-apple-link-blue hover:underline",
  ghost:
    "bg-transparent text-apple-near-black hover:bg-apple-gray border border-transparent",
  danger:
    "bg-red-600 text-white hover:bg-red-700 active:opacity-90 border border-transparent",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[14px]",
  md: "px-4 py-2 text-[17px]",
  lg: "px-6 py-3 text-[18px] font-light",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-btn font-sans transition-all",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {loading && (
        <span
          className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

/** Pill-style "Learn more / Shop" link button */
export function PillLink({
  href,
  children,
  dark = false,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={[
        "inline-flex items-center gap-1 rounded-pill border px-4 py-1.5 text-[14px] transition-all",
        "hover:underline focus-visible:outline-2 focus-visible:outline-apple-blue",
        dark
          ? "border-apple-bright-blue text-apple-bright-blue"
          : "border-apple-link-blue text-apple-link-blue",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </a>
  );
}
