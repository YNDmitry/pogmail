/** Vite's `?raw` suffix, used to ship the update workflow inside the Worker bundle. */
declare module "*?raw" {
	const content: string;
	export default content;
}
