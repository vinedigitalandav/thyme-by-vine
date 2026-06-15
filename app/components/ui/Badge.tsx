type BadgeVariant = "green" | "red" | "yellow" | "blue" | "gray";

const variants: Record<BadgeVariant, string> = {
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-700",
  yellow: "bg-yellow-100 text-yellow-800",
  blue: "bg-blue-100 text-apple-blue",
  gray: "bg-apple-gray text-apple-near-black/60",
};

export function Badge({
  variant = "gray",
  children,
  className = "",
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-block rounded-pill px-2.5 py-0.5 text-[12px] font-medium",
        variants[variant],
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}
