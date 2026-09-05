/** Every API failure is this shape; there is exactly one error envelope. */
export type ApiErrorBody = { error: string; details?: unknown };

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly details?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;

/** Cursor-paginated list shape, used by every collection endpoint. */
export type Page<T> = { items: T[]; nextCursor: string | null };
