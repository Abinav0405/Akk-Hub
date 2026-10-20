import * as React from "react"
import { cn } from "@/ui/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      data-ui="input"
      className={cn(
        "flex h-11 min-h-11 w-full rounded-xl border border-input bg-white px-3.5 py-2 text-base sm:text-sm shadow-[inset_0_1px_2px_rgb(15_29_51/0.04)] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
