import { cn } from '@/client/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn(
        'pogpin-skeleton relative overflow-hidden rounded-md bg-[var(--pogpin-shell-fill-soft)]',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
