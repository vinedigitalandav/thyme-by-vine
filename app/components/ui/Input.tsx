import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: InputProps) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s/g, "-") : undefined);
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[14px] font-medium text-apple-near-black"
        >
          {label}
          {props.required && (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <input
        id={inputId}
        className={[
          "w-full rounded-btn border bg-btn-light px-3 py-2 text-[15px] text-apple-near-black",
          "placeholder:text-apple-near-black/40",
          "border-apple-near-black/10",
          "focus:border-apple-blue focus:outline-none focus:ring-2 focus:ring-apple-blue/20",
          "transition-colors",
          error ? "border-red-500" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={!!error}
        aria-describedby={
          error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
        }
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-[13px] text-red-600">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-[13px] text-apple-near-black/50">
          {hint}
        </p>
      )}
    </div>
  );
}

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Textarea({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: TextareaProps) {
  const fieldId = id ?? (label ? label.toLowerCase().replace(/\s/g, "-") : undefined);
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={fieldId} className="text-[14px] font-medium text-apple-near-black">
          {label}
        </label>
      )}
      <textarea
        id={fieldId}
        className={[
          "w-full rounded-btn border bg-btn-light px-3 py-2 text-[15px] text-apple-near-black",
          "placeholder:text-apple-near-black/40",
          "border-apple-near-black/10",
          "focus:border-apple-blue focus:outline-none focus:ring-2 focus:ring-apple-blue/20",
          "transition-colors resize-none",
          error ? "border-red-500" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={!!error}
        {...props}
      />
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      {hint && !error && (
        <p className="text-[13px] text-apple-near-black/50">{hint}</p>
      )}
    </div>
  );
}
