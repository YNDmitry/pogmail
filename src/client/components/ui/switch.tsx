"use client"

import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/client/lib/utils"

const switchThumbTransition = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.8,
} as const

const MotionSwitchThumb = motion.create(SwitchPrimitive.Thumb)

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  const reducedMotion = useReducedMotion()

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center justify-start rounded-full border border-transparent px-px shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:justify-end data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
        className
      )}
      {...props}
    >
      <MotionSwitchThumb
        layout="position"
        transition={reducedMotion ? { duration: 0 } : switchThumbTransition}
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-background ring-0 group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
