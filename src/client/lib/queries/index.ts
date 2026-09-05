import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { qk } from "./keys";
import type { SessionUser } from "@/shared/contract/auth";
import type { Branding } from "@/shared/contract/settings";
import type {
	Folder,
	MailboxSummary,
	MessageCounts,
	MessageDetail,
	MessageStatus,
	MessageSummary,
} from "@/shared/contract/mail";

type List<T> = { items: T[] };
type Paged<T> = { items: T[]; nextCursor: number | null };

export function useSession() {
	return useQuery({
		queryKey: qk.session,
		queryFn: () => api.get<SessionUser>("/api/auth/me"),
		retry: false,
		staleTime: 5 * 60_000,
	});
}

export function useBranding() {
	return useQuery({
		queryKey: qk.branding,
		queryFn: () => api.get<Branding>("/api/branding"),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function useMailboxes() {
	return useQuery({
		queryKey: qk.mailboxes,
		queryFn: async () => (await api.get<List<MailboxSummary>>("/api/mailboxes")).items,
	});
}

export function useFolders() {
	return useQuery({
		queryKey: qk.folders,
		queryFn: async () => (await api.get<List<Folder>>("/api/folders")).items,
	});
}

export function useCounts() {
	return useQuery({
		queryKey: qk.counts,
		queryFn: () => api.get<MessageCounts>("/api/messages/counts"),
	});
}

export type MessageFilters = {
	status?: MessageStatus;
	mailboxId?: string;
	folderId?: string;
	starred?: "true" | "false";
	unread?: "true" | "false";
	snoozed?: "true" | "false";
	search?: string;
};

export function useMessages(filters: MessageFilters) {
	return useQuery({
		queryKey: qk.messages(filters),
		queryFn: () => api.get<Paged<MessageSummary>>("/api/messages", { query: filters }),
	});
}

export function useMessage(id: string | undefined) {
	return useQuery({
		queryKey: qk.message(id ?? ""),
		queryFn: () => api.get<MessageDetail>(`/api/messages/${id}`),
		enabled: Boolean(id),
	});
}

export function useThread(id: string | undefined) {
	return useQuery({
		queryKey: qk.thread(id ?? ""),
		queryFn: async () => (await api.get<List<MessageSummary>>(`/api/messages/${id}/thread`)).items,
		enabled: Boolean(id),
	});
}

export type MessagePatch = {
	read?: boolean;
	starred?: boolean;
	status?: MessageStatus;
	folderId?: string | null;
	snoozedUntil?: number | null;
};

/**
 * Patches a message and updates the cache in place. Optimistic: marking mail read
 * or starred has to feel instant while scanning a list.
 */
export function usePatchMessage() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: MessagePatch }) =>
			api.patch<MessageDetail>(`/api/messages/${id}`, patch),

		onMutate: async ({ id, patch }) => {
			await client.cancelQueries({ queryKey: ["messages"] });
			const snapshot = client.getQueriesData<Paged<MessageSummary>>({ queryKey: ["messages"] });

			for (const [key, page] of snapshot) {
				if (!page?.items) continue;
				client.setQueryData(key, {
					...page,
					items: page.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
				});
			}

			return { snapshot };
		},

		onError: (_error, _variables, context) => {
			for (const [key, page] of context?.snapshot ?? []) client.setQueryData(key, page);
		},

		onSettled: () => {
			void client.invalidateQueries({ queryKey: ["messages"] });
			void client.invalidateQueries({ queryKey: qk.counts });
		},
	});
}

export function useBulkPatch() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: (input: MessagePatch & { ids: string[] }) =>
			api.patch<{ updated: number }>("/api/messages/bulk", input),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["messages"] });
			void client.invalidateQueries({ queryKey: qk.counts });
		},
	});
}

export function useDeleteMessage() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: (id: string) => api.delete<{ ok: true }>(`/api/messages/${id}`),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["messages"] });
			void client.invalidateQueries({ queryKey: qk.counts });
		},
	});
}

export function useLogout() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: () => api.post<{ ok: true }>("/api/auth/logout"),
		onSuccess: () => client.clear(),
	});
}
