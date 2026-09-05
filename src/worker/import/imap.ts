import { connect } from "cloudflare:sockets";
import { assertSafeImapHost } from "./imap-guard";

export type ImapCredentials = {
	host: string;
	port: number;
	username: string;
	password: string;
};

const CRLF = "\r\n";
const TIMEOUT_MS = 30_000;

/**
 * A deliberately small IMAP client: enough to list folders, search a mailbox and
 * fetch whole messages. Anything more (IDLE, partial fetch, extensions) belongs in
 * a library, and no maintained one runs on workerd today.
 */
export class ImapConnection {
	private tag = 0;
	private buffer = new Uint8Array(0);

	private constructor(
		private readonly socket: Socket,
		private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
		private readonly writer: WritableStreamDefaultWriter<Uint8Array>,
	) {}

	static async open(credentials: ImapCredentials): Promise<ImapConnection> {
		assertSafeImapHost(credentials.host);

		const socket = connect(
			{ hostname: credentials.host, port: credentials.port },
			// IMAPS only. STARTTLS would mean speaking plaintext first, and there is
			// no reason to offer that for a one-off import.
			{ secureTransport: "on", allowHalfOpen: false },
		);

		const connection = new ImapConnection(
			socket,
			socket.readable.getReader(),
			socket.writable.getWriter(),
		);

		const greeting = await connection.readLine();
		if (!greeting.startsWith("* OK")) throw new Error("The server did not greet us as an IMAP server");

		await connection.command(
			`LOGIN ${quote(credentials.username)} ${quote(credentials.password)}`,
		);

		return connection;
	}

	async close(): Promise<void> {
		try {
			await this.command("LOGOUT");
		} catch {
			// A server that drops the connection on LOGOUT is not an error worth raising.
		}
		await this.socket.close().catch(() => undefined);
	}

	/** Folder names, as the server spells them. */
	async listFolders(): Promise<string[]> {
		const lines = await this.command('LIST "" "*"');
		return lines
			.filter((line) => line.startsWith("* LIST"))
			.map(parseFolderName)
			.filter((name): name is string => name !== null);
	}

	async selectFolder(folder: string): Promise<void> {
		await this.command(`SELECT ${quote(folder)}`);
	}

	async searchAll(): Promise<string[]> {
		const lines = await this.command("UID SEARCH ALL");
		const results = lines.find((line) => line.startsWith("* SEARCH"));
		return results ? results.slice("* SEARCH".length).trim().split(/\s+/).filter(Boolean) : [];
	}

	/** The whole message, so it can be parsed exactly like inbound mail. */
	async fetchMessage(uid: string): Promise<Uint8Array> {
		const tag = this.nextTag();
		await this.write(`${tag} UID FETCH ${uid} (RFC822)${CRLF}`);

		let body: Uint8Array | null = null;

		for (;;) {
			const line = await this.readLine();

			// `{1234}` at the end of a line means the next 1234 bytes are literal data
			// rather than a protocol line, so they have to be read by length.
			const literal = line.match(/\{(\d+)\}$/);
			if (literal?.[1]) {
				body = await this.readBytes(Number(literal[1]));
				continue;
			}

			if (line.startsWith(tag)) {
				if (!line.toUpperCase().includes(" OK")) throw new Error(`Fetch failed: ${line}`);
				if (!body) throw new Error("The server returned no message body");
				return body;
			}
		}
	}

	private nextTag(): string {
		return `a${String(++this.tag).padStart(4, "0")}`;
	}

	private async command(command: string): Promise<string[]> {
		const tag = this.nextTag();
		await this.write(`${tag} ${command}${CRLF}`);

		const lines: string[] = [];
		for (;;) {
			const line = await this.readLine();
			lines.push(line);

			if (line.startsWith(tag)) {
				if (!line.toUpperCase().includes(" OK")) {
					// Never echo the command back: it may contain the password.
					throw new Error(`IMAP command failed: ${line}`);
				}
				return lines;
			}
		}
	}

	private async write(value: string): Promise<void> {
		await this.writer.write(new TextEncoder().encode(value));
	}

	private async fill(): Promise<void> {
		const result = await Promise.race([
			this.reader.read(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("The IMAP server stopped responding")), TIMEOUT_MS),
			),
		]);

		if (result.done || !result.value) throw new Error("The IMAP connection closed unexpectedly");

		const merged = new Uint8Array(this.buffer.length + result.value.length);
		merged.set(this.buffer);
		merged.set(result.value, this.buffer.length);
		this.buffer = merged;
	}

	private async readLine(): Promise<string> {
		for (;;) {
			const index = this.buffer.indexOf(0x0a);
			if (index !== -1) {
				const line = this.buffer.slice(0, index);
				this.buffer = this.buffer.slice(index + 1);
				return new TextDecoder().decode(line).replace(/\r$/, "");
			}
			await this.fill();
		}
	}

	private async readBytes(length: number): Promise<Uint8Array> {
		while (this.buffer.length < length) await this.fill();

		const bytes = this.buffer.slice(0, length);
		this.buffer = this.buffer.slice(length);
		return bytes;
	}
}

/** IMAP strings are quoted with backslash escaping, not JSON encoding. */
function quote(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function parseFolderName(line: string): string | null {
	const quoted = line.match(/"([^"]*)"\s*$/);
	if (quoted?.[1]) return quoted[1];

	const bare = line.trim().split(/\s+/).pop();
	return bare && bare !== "NIL" ? bare : null;
}
