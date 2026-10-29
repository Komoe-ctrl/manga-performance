import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

export const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full text-sm font-medium transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:bg-primary",
        accent: "bg-accent text-accent-foreground hover:bg-[#ffc933] hover:shadow-lg hover:shadow-accent/40 active:bg-accent",
        // Secondaire : le contour se remplit au survol, l'état pressé reste lisible.
        outline:
          "border border-primary/30 bg-background text-primary hover:border-primary hover:bg-primary hover:text-primary-foreground hover:shadow-md active:bg-primary/80",
        // Secondaire sur fond bleu nuit.
        outlineLight:
          "border border-white/50 bg-transparent text-white hover:border-white hover:bg-white hover:text-primary hover:shadow-md active:bg-white/80",
        ghost: "text-primary hover:bg-accent/25 active:bg-accent/40",
      },
      size: { sm: "h-8 px-4", md: "h-10 px-5", lg: "h-12 px-7 text-base" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
