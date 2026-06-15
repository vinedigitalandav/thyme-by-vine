interface CardProps {
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
  padding?: "sm" | "md" | "lg";
  shadow?: boolean;
}

export function Card({
  children,
  className = "",
  dark = false,
  padding = "md",
  shadow = false,
}: CardProps) {
  const paddingClasses = { sm: "p-4", md: "p-6", lg: "p-8" };
  return (
    <div
      className={[
        "rounded-card",
        dark ? "bg-apple-dark-surface text-white" : "bg-white text-apple-near-black",
        paddingClasses[padding],
        shadow ? "shadow-card" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

export function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-[13px] text-apple-near-black/50 uppercase tracking-wider font-medium">
        {label}
      </p>
      <p className="text-[2rem] font-semibold text-apple-near-black leading-none">
        {value}
      </p>
      {sub && <p className="text-[13px] text-apple-near-black/50">{sub}</p>}
    </Card>
  );
}
