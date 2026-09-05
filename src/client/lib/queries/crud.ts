import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "../api";

type List<T> = { items: T[] };

/**
 * Most admin screens are the same shape: list a collection, create, patch, delete,
 * invalidate. These three hooks cover that so each screen only writes what is
 * genuinely different about it.
 */
export function useList<T>(key: QueryKey, path: string, query?: Record<string, string | undefined>) {
	return useQuery({
		queryKey: query ? [...key, query] : key,
		queryFn: async () => (await api.get<List<T>>(path, { query })).items,
	});
}

export function useCreate<TInput, TResult>(key: QueryKey, path: string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: TInput) => api.post<TResult>(path, input),
		onSuccess: () => client.invalidateQueries({ queryKey: key }),
	});
}

export function useUpdate<TInput, TResult>(key: QueryKey, path: (id: string) => string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ id, input }: { id: string; input: TInput }) => api.patch<TResult>(path(id), input),
		onSuccess: () => client.invalidateQueries({ queryKey: key }),
	});
}

export function useReplace<TInput, TResult>(key: QueryKey, path: (id: string) => string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: ({ id, input }: { id: string; input: TInput }) => api.put<TResult>(path(id), input),
		onSuccess: () => client.invalidateQueries({ queryKey: key }),
	});
}

export function useRemove(key: QueryKey, path: (id: string) => string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.delete<{ ok: true }>(path(id)),
		onSuccess: () => client.invalidateQueries({ queryKey: key }),
	});
}
