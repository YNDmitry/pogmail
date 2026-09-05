"use client"

import {
  AlertCircleIcon,
  CheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      expand
      gap={8}
      visibleToasts={4}
      offset={{ right: 16, bottom: 24 }}
      mobileOffset={16}
      swipeDirections={["left", "right"]}
      containerAriaLabel="Notifications"
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: "Dismiss notification",
      }}
      icons={{
        success: <CheckIcon className="size-3.5" />,
        info: <InfoIcon className="size-3.5" />,
        warning: <TriangleAlertIcon className="size-3.5" />,
        error: <AlertCircleIcon className="size-3.5" />,
        loading: <LoaderCircleIcon className="size-3.5 animate-spin" />,
        close: <XIcon className="size-3.5" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
