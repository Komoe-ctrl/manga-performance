import { cn } from "@/lib/utils/cn";

export const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm transition-all placeholder:text-slate-400 hover:border-primary/40 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/25";

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = ({ className, ...props }: React.ComponentProps<"input">) => (
  <input className={cn(inputClass, className)} {...props} />
);
export const Select = ({ className, ...props }: React.ComponentProps<"select">) => (
  <select className={cn(inputClass, className)} {...props} />
);
export const Textarea = ({ className, ...props }: React.ComponentProps<"textarea">) => (
  <textarea className={cn(inputClass, "h-auto min-h-28 py-2", className)} {...props} />
);
