import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"
import { cn } from "@/ui/utils"

const buttonVariants = cva(
  "inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap max-sm:whitespace-normal max-sm:h-auto max-sm:py-2 max-sm:text-center max-sm:leading-snug rounded-xl text-sm font-semibold ring-offset-background transition-[background,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 min-h-10 max-sm:min-h-11",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:bg-brand-hover shadow-xs",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs",
        outline:
          "border border-[rgb(15_29_51/0.14)] bg-white text-[var(--g-ink)] shadow-[0_1px_1px_rgb(15_29_51/0.04)] hover:bg-slate-50 hover:border-[rgb(15_29_51/0.22)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-[var(--g-fill)] hover:text-[var(--g-ink)]",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 min-h-9 rounded-lg px-3",
        lg: "h-12 min-h-12 rounded-2xl px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-ui="button"
      data-variant={variant || "default"}
      data-size={size || "default"}
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
