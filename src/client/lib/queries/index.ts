import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { qk } from "./keys";
import { useToast } from "@/client/components/app/toast-host";
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
type Paged<T> = { items: T[]; nextCursor: number | null; nextCursorId?: string | null };
type MessageCursor = { cursor: number; cursorId?: string } | null;

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
  /** Received mail that has not been moved to a custom folder. */
  inbox?: "true";
  starred?: "true" | "false";
	unread?: "true" | "false";
	snoozed?: "true" | "false";
	search?: string;
};

export function useMessages(filters: MessageFilters) {
	return useInfiniteQuery({
		queryKey: qk.messages(filters),
		initialPageParam: null as MessageCursor,
		queryFn: ({ pageParam, signal }) => api.get<Paged<MessageSummary>>("/api/messages", {
			query: { ...filters, ...pageParam }, signal,
		}),
		getNextPageParam: (page): MessageCursor | undefined => page.nextCursor === null ? undefined : {
			cursor: page.nextCursor, ...(page.nextCursorId ? { cursorId: page.nextCursorId } : {}),
		},
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
	expectedLocation?: { status: MessageStatus; folderId: string | null };
};

/**
 * Patches a message and updates the cache in place. Optimistic: marking mail read
 * or starred has to feel instant while scanning a list.
 */
export function usePatchMessage() {
	const client = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: MessagePatch }) =>
			api.patch<MessageDetail>(`/api/messages/${id}`, patch),

		onMutate: async ({ id, patch }) => {
			await client.cancelQueries({ queryKey: ["messages"] });
			const snapshot = client.getQueriesData<InfiniteData<Paged<MessageSummary>>>({ queryKey: qk.messageLists });
			const detail = client.getQueryData<MessageDetail>(qk.message(id));
			for (const [key, data] of snapshot) {
				if (!data) continue;
				client.setQueryData(key, {
					...data, pages: data.pages.map((page) => ({
						...page, items: page.items.map((item) => item.id === id ? { ...item, ...patch } : item),
					})),
				});
			}
			if (detail) client.setQueryData(qk.message(id), { ...detail, ...patch });
			return { snapshot, detail, id };
		},

		onError: (error, _variables, context) => {
			for (const [key, data] of context?.snapshot ?? []) client.setQueryData(key, data);
			if (context?.detail) client.setQueryData(qk.message(context.id), context.detail);
			toast.fail("Could not update the message", error.message);
		},

		onSettled: () => {
			void client.invalidateQueries({ queryKey: ["messages"] });
			void client.invalidateQueries({ queryKey: qk.counts });
		},
	});
}

export function useBulkPatch() {
	const client = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (input: MessagePatch & { ids: string[] }) =>
			api.patch<{ updated: number }>("/api/messages/bulk", input),
		onError: (error) => toast.fail("Could not update the messages", error.message),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["messages"] });
			void client.invalidateQueries({ queryKey: qk.counts });
		},
	});
}

/** Conversation actions affect members in the selected location, not other locations or mailboxes. */
export async function resolveMessageRows(client: QueryClient, rows: MessageSummary[], conversations: boolean): Promise<MessageSummary[]> {
	if (!conversations) return rows;
	const groups = new Map(rows.map((row) => [JSON.stringify([row.mailboxId, row.threadId, row.status, row.folderId, row.status === "draft" ? row.id : null]), row]));
	const members = await Promise.all([...groups.values()].map(async (row) => {
		if (row.status === "draft") return [row];
		const thread = await client.fetchQuery({
			queryKey: qk.thread(row.id),
			queryFn: async () => (await api.get<List<MessageSummary>>(`/api/messages/${row.id}/thread`)).items,
			staleTime: 30_000,
		});
		const matches = thread.filter((item) => item.mailboxId === row.mailboxId && item.status === row.status && item.folderId === row.folderId);
		if (!matches.length) throw new Error("This conversation moved. Refresh before trying again.");
		return matches;
	}));
	return [...new Map(members.flat().map((row) => [row.id, row])).values()];
}

/** One reversible move path for row, reader, keyboard and bulk actions. */
export function useMoveMessages(conversations = false) {
	const client = useQueryClient();
	const patch = usePatchMessage();
	const bulk = useBulkPatch();
	const toast = useToast();
	return async (rows: MessageSummary[], location: { status: MessageStatus; folderId: string | null }, title: string) => {
		if (!rows.length) return;
		try {
			rows = await resolveMessageRows(client, rows, conversations);
		} catch (error) {
			toast.fail("Could not load the conversation", error instanceof Error ? error.message : undefined);
			throw error;
		}
		const previous = rows.map(({ id, status, folderId }) => ({ id, status, folderId }));
		if (rows.length === 1) await patch.mutateAsync({ id: rows[0]!.id, patch: location });
		else await bulk.mutateAsync({ ids: rows.map((row) => row.id), ...location });
		toast.undo(rows.length === 1 ? title : `${title} · ${rows.length}`, async () => {
			await Promise.all(previous.map(({ id, ...original }) => patch.mutateAsync({
				id, patch: { ...original, expectedLocation: location },
			})));
			toast.ok("Move undone");
		});
	};
}

export function useDeleteMessage() {
	const client = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (id: string) => api.delete<{ ok: true }>(`/api/messages/${id}`),
		onError: (error) => toast.fail("Could not delete the message", error.message),
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
