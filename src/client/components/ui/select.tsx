import * as React from 'react'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { Select as SelectPrimitive } from 'radix-ui'

import { cn } from '@/client/lib/utils'

const SelectMotionContext = React.createContext<{
  open: boolean
  reducedMotion: boolean
} | null>(null)

function Select({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const reducedMotion = useReducedMotion() ?? false
  const currentOpen = open ?? internalOpen

  return (
    <SelectMotionContext.Provider value={{ open: currentOpen, reducedMotion }}>
      <SelectPrimitive.Root
        data-slot="select"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(nextOpen) => {
          if (open === undefined) setInternalOpen(nextOpen)
          onOpenChange?.(nextOpen)
        }}
        {...props}
      />
    </SelectMotionContext.Provider>
  )
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default'
}) {
  const motionContext = React.useContext(SelectMotionContext)

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center cursor-pointer justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 data-[state=open]:border-transparent data-[state=open]:bg-transparent data-[state=open]:shadow-none dark:data-[state=open]:bg-transparent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <motion.span
          animate={{ rotate: motionContext?.open ? 180 : 0 }}
          transition={motionContext?.reducedMotion ? { duration: 0 } : undefined}
          className="inline-flex opacity-50"
        >
          <ChevronDownIcon className="size-4" />
        </motion.span>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'item-aligned',
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const motionContext = React.useContext(SelectMotionContext)
  const reducedMotion = motionContext?.reducedMotion ?? false

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          'relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--pogpin-shell-border)] bg-[var(--pogpin-shell-panel)] text-[var(--pogpin-shell-text)] shadow-xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        align={align}
        {...props}
        asChild
      >
        <motion.div
          initial={
            reducedMotion
              ? false
              : {
                  opacity: 0,
                  clipPath: 'inset(calc(50% - 18px) -24px round 0.75rem)',
                }
          }
          animate={{
            opacity: 1,
            clipPath: 'inset(-24px round 0.75rem)',
          }}
          transition={reducedMotion ? { duration: 0 } : undefined}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            className={cn(
              'p-1.5',
              // Width follows the trigger; height must not — clamping the
              // viewport to the trigger's height (shadcn's default) leaves a
              // list showing one row.
              position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1',
            )}
          >
            {children}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </motion.div>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('px-2.5 py-1.5 text-[0.7rem] text-[var(--pogpin-shell-text-muted)]', className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-8 pl-2.5 text-[0.8rem] outline-hidden select-none focus:bg-[var(--pogpin-shell-fill-soft)] focus:text-[var(--pogpin-shell-text)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2.5 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
