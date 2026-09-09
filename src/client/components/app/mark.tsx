import { useTheme } from "next-themes";
import { cn } from "@/client/lib/utils";
import logoDark from "@/client/assets/logo.svg";
import logoLight from "@/client/assets/logo-light.svg";

/**
 * The product mark. Its dark tile keeps the white speech bubble visible on both
 * light and dark application surfaces, including at favicon-like sizes.
 */
export function Mark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  return (
    <img
      src={isLight ? logoLight : logoDark}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0 rounded-[22%] p-[5%] object-contain", className)}
    />
  );
}
