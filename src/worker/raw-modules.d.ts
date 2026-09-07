/** Vite's `?raw` suffix, used to ship the update workflow inside the Worker bundle. */
declare module "*?raw" {
	const content: string;
	export default content;
}

/**
 * Vite's `import.meta.glob`, declared narrowly rather than by pulling in
 * `vite/client`: the Worker program must not gain DOM types.
 */
interface ImportMeta {
	glob<T>(
		pattern: string,
		options?: { query?: string; import?: string; eager?: boolean },
	): Record<string, T>;
}
