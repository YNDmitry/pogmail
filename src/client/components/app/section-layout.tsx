import type { ReactNode } from "react";
import { PageHeader } from "@/client/components/app/primitives";
import {
  SectionNav,
  type SectionLink,
} from "@/client/components/app/section-nav";

/**
 * The shape Settings and Administration share: a heading, a column of tabs, and
 * the screen the tab chose.
 *
 * One component rather than the same markup in two route files, because the two
 * had already drifted — one was `max-w-5xl` and the other `max-w-6xl`, so moving
 * between them shifted the whole page sideways. The heading and the tabs carry
 * view-transition names, which is what keeps them still while the panel beside
 * them changes; see `styles.css`.
 */
export function SectionLayout({
  title,
  description,
  links,
  children,
}: {
  title: string;
  description: string;
  links: SectionLink[];
  children: ReactNode;
}) {
  return (
    <div className="mx-auto space-y-6 px-4 py-8">
      <PageHeader
        transitionName="section-heading"
        title={title}
        description={description}
      />

      <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <SectionNav links={links} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
