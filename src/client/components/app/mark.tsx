import { useMemo } from "react";
import type { Identity } from "@/client/lib/identity";
import { cn } from "@/client/lib/utils";

/**
 * The instance mark, drawn from the seed rather than authored.
 *
 * Open arcs sweep around one centre; the seed decides how many there are, how
 * far each bends, and how far each turns from the last. It is geometry, not
 * illustration — it stays crisp at 16px in a tab and at 480px behind the sign-in
 * screen, and it is the same figure at both sizes.
 */

const VIEW = 100;
const CENTRE = VIEW / 2;

function arcPath(radius: number, startDeg: number, sweepDeg: number): string {
	const start = (startDeg * Math.PI) / 180;
	const end = ((startDeg + sweepDeg) * Math.PI) / 180;

	const x0 = CENTRE + radius * Math.cos(start);
	const y0 = CENTRE + radius * Math.sin(start);
	const x1 = CENTRE + radius * Math.cos(end);
	const y1 = CENTRE + radius * Math.sin(end);

	return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${
		sweepDeg > 180 ? 1 : 0
	} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

type Stroke = { d: string; depth: number; width: number };

/**
 * `strokes` is the whole mark. `detail` trades stroke count for legibility: a
 * favicon-sized mark with fourteen arcs is a smudge, so small renders thin out.
 */
function buildStrokes(identity: Identity, detail: number): Stroke[] {
	const count = Math.max(3, Math.round((5 + identity.density * 9) * detail));
	const sweep = 96 + identity.curve * 150;
	const turn = 18 + identity.rhythm * 104;
	const inner = 13;
	const outer = 40;
	const step = count > 1 ? (outer - inner) / (count - 1) : 0;
	const width = Math.min(7.5, Math.max(2.6, 46 / count));

	return Array.from({ length: count }, (_, index) => ({
		d: arcPath(inner + step * index, -90 + turn * index, sweep),
		// Position in the stack, which walks the coral ramp from light to deep so
		// the mark has depth without any one stroke being a gradient.
		depth: index / Math.max(1, count - 1),
		width,
	}));
}

export function Mark({
	identity,
	className,
	detail = 1,
	animate = false,
	title,
}: {
	identity: Identity;
	className?: string;
	detail?: number;
	animate?: boolean;
	title?: string;
}) {
	const strokes = useMemo(() => buildStrokes(identity, detail), [identity, detail]);

	return (
		<svg
			viewBox={`0 0 ${VIEW} ${VIEW}`}
			className={cn("shrink-0 overflow-visible", animate && "mark-draw", className)}
			role={title ? "img" : "presentation"}
			aria-label={title}
			aria-hidden={title ? undefined : true}
		>
			{strokes.map((stroke, index) => (
				<path
					key={stroke.d}
					d={stroke.d}
					fill="none"
					strokeLinecap="round"
					strokeWidth={stroke.width}
					stroke={`color-mix(in oklab, var(--pogpin-brand-300) ${(100 - stroke.depth * 100).toFixed(1)}%, var(--pogpin-brand-700))`}
					style={{ "--i": index } as React.CSSProperties}
				/>
			))}
		</svg>
	);
}
