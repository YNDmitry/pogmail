import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { cn } from '@/client/lib/utils'

type ScrollFadeOrientation = 'vertical' | 'horizontal' | 'both'

type ScrollFadeProps = {
  children: ReactNode
  className?: string
  viewportClassName?: string
  viewportProps?: HTMLAttributes<HTMLDivElement>
  viewportRef?: Ref<HTMLDivElement>
  orientation?: ScrollFadeOrientation
  fadeColor?: string
  fadeSize?: number
}

const DEFAULT_FADE_COLOR = 'var(--pogpin-scroll-fade-bg, var(--card))'

export function ScrollFade({
  children,
  className,
  viewportClassName,
  viewportProps,
  viewportRef: externalViewportRef,
  orientation = 'vertical',
  fadeColor = DEFAULT_FADE_COLOR,
  fadeSize = 36,
}: ScrollFadeProps) {
  const viewportElRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false, left: false, right: false })

  const hasVerticalFade = orientation === 'vertical' || orientation === 'both'
  const hasHorizontalFade = orientation === 'horizontal' || orientation === 'both'

  const setViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportElRef.current = node
      if (typeof externalViewportRef === 'function') {
        externalViewportRef(node)
      } else if (externalViewportRef) {
        externalViewportRef.current = node
      }
    },
    [externalViewportRef],
  )

  const syncEdges = useCallback(() => {
    const viewport = viewportElRef.current
    if (!viewport) return

    const next = {
      top: hasVerticalFade && viewport.scrollTop > 8,
      bottom: hasVerticalFade && viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 8,
      left: hasHorizontalFade && viewport.scrollLeft > 8,
      right: hasHorizontalFade && viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 8,
    }

    setEdges((current) =>
      current.top === next.top &&
      current.bottom === next.bottom &&
      current.left === next.left &&
      current.right === next.right
        ? current
        : next,
    )
  }, [hasHorizontalFade, hasVerticalFade])

  const scheduleSync = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      syncEdges()
    })
  }, [syncEdges])

  useEffect(() => {
    const viewport = viewportElRef.current
    if (!viewport) return

    syncEdges()
    viewport.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)

    const resizeObserver = new ResizeObserver(scheduleSync)
    resizeObserver.observe(viewport)
    if (viewport.firstElementChild) resizeObserver.observe(viewport.firstElementChild)

    return () => {
      viewport.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
      resizeObserver.disconnect()
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [scheduleSync, syncEdges])

  return (
    <div className={cn('relative min-h-0 min-w-0', className)}>
      {edges.top ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10"
          style={{ height: fadeSize, background: `linear-gradient(to bottom, ${fadeColor}, transparent)` }}
        />
      ) : null}
      {edges.bottom ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
          style={{ height: fadeSize, background: `linear-gradient(to top, ${fadeColor}, transparent)` }}
        />
      ) : null}
      {edges.left ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10"
          style={{ width: fadeSize, background: `linear-gradient(to right, ${fadeColor}, transparent)` }}
        />
      ) : null}
      {edges.right ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10"
          style={{ width: fadeSize, background: `linear-gradient(to left, ${fadeColor}, transparent)` }}
        />
      ) : null}
      <div
        {...viewportProps}
        ref={setViewportRef}
        className={cn(
          'min-h-0 min-w-0',
          hasVerticalFade ? 'overflow-y-auto' : 'overflow-y-hidden',
          hasHorizontalFade ? 'overflow-x-auto' : 'overflow-x-hidden',
          viewportClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
