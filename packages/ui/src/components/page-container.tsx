import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const pageContainerVariants = cva("w-full px-4 py-8 sm:px-6 lg:py-10", {
  variants: {
    size: {
      default: "max-w-5xl",
      narrow: "max-w-2xl",
      wide: "max-w-7xl",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

/** Standard page width and gutters. `narrow` suits forms, `wide` suits grids. Every size shares the same left edge so content does not jump between pages. */
function PageContainer({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof pageContainerVariants>) {
  return (
    <div
      data-slot="page-container"
      data-size={size ?? "default"}
      className={cn(pageContainerVariants({ size }), className)}
      {...props}
    />
  )
}

export { PageContainer, pageContainerVariants }
