import { connect } from "cloudflare:sockets";
import { assertSafeMailHost } from "../import/imap-guard";

const CRLF = "\r\n";
const TIMEOUT_MS = 30_000;
const MAX_LINE_BYTES = 16 * 1024;

export type SmtpCredentials = {
	host: string;
	port: number;
	security: "tls" | "starttls";
	username: string;
	password: string;
};

/** A small SMTP submission client for bounded queue jobs, never a mail server. */
export class SmtpConnection {
	private buffer = new Uint8Array(0);

	private constructor(
		private socket: Socket,
		private reader: ReadableStreamDefaultReader<Uint8Array>,
		private writer: WritableStreamDefaultWriter<Uint8Array>,
	) {}

	static async open(credentials: SmtpCredentials): Promise<SmtpConnection> {
		assertSafeMailHost(credentials.host);
		assertPort(credentials.port, credentials.security);
		const socket = connect(
			{ hostname: credentials.host, port: credentials.port },
			{ secureTransport: credentials.security === "tls" ? "on" : "starttls", allowHalfOpen: false },
		);
		const client = new SmtpConnection(socket, socket.readable.getReader(), socket.writable.getWriter());
		await client.expect([220]);
		await client.command("EHLO pogmail", [250]);
		if (credentials.security === "starttls") {
			await client.command("STARTTLS", [220]);
			client.replaceSocket(socket.startTls());
			await client.command("EHLO pogmail", [250]);
		}
		await client.authenticate(credentials.username, credentials.password);
		return client;
	}

	async send(from: string, recipient: string, mime: string): Promise<void> {
		await this.command(`MAIL FROM:<${from}>`, [250]);
		await this.command(`RCPT TO:<${recipient}>`, [250, 251]);
		await this.command("DATA", [354]);
		await this.write(dotStuff(mime));
		await this.expect([250]);
	}

	async close(): Promise<void> {
		try {
			await this.command("QUIT", [221]);
		} catch {
			// The remote server is allowed to close without a QUIT response.
		}
		await this.socket.close().catch(() => undefined);
	}

	private replaceSocket(socket: Socket) {
		this.reader.releaseLock();
		this.writer.releaseLock();
		this.socket = socket;
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
	}

	private async authenticate(username: string, password: string): Promise<void> {
		const plain = base64(`\0${username}\0${password}`);
		const response = await this.command(`AUTH PLAIN ${plain}`, [235, 334]);
		if (response.code === 235) return;
		// Servers that reject an initial response issue a 334 challenge. The reply is
		// still the complete PLAIN SASL payload, not LOGIN's username/password pair.
		await this.write(`${plain}${CRLF}`);
		await this.expect([235]);
	}

	private async command(command: string, expected: number[]): Promise<SmtpResponse> {
		await this.write(`${command}${CRLF}`);
		return this.expect(expected);
	}

	private async expect(expected: number[]): Promise<SmtpResponse> {
		let last: SmtpResponse | null = null;
		for (;;) {
			const line = await this.readLine();
			const match = line.match(/^(\d{3})([ -])(.*)$/);
			if (!match) throw new Error("SMTP server sent an invalid response");
			last = { code: Number(match[1]), more: match[2] === "-", text: match[3] ?? "" };
			if (!last.more) break;
		}
		if (!last || !expected.includes(last.code)) {
			throw new Error(`SMTP command failed: ${last?.code ?? "unknown"} ${last?.text ?? ""}`.slice(0, 500));
		}
		return last;
	}

	private async write(value: string): Promise<void> {
		await this.writer.write(new TextEncoder().encode(value));
	}

	private async readLine(): Promise<string> {
		for (;;) {
			const index = this.buffer.indexOf(0x0a);
			if (index !== -1) {
				if (index > MAX_LINE_BYTES) throw new Error("SMTP response line is too long");
				const line = this.buffer.slice(0, index);
				this.buffer = this.buffer.slice(index + 1);
				return new TextDecoder().decode(line).replace(/\r$/, "");
			}
			if (this.buffer.length > MAX_LINE_BYTES) throw new Error("SMTP response line is too long");
			await this.fill();
		}
	}

	private async fill(): Promise<void> {
		const result = await Promise.race([
			this.reader.read(),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SMTP server stopped responding")), TIMEOUT_MS)),
		]);
		if (result.done || !result.value) throw new Error("SMTP connection closed unexpectedly");
		const merged = new Uint8Array(this.buffer.length + result.value.length);
		merged.set(this.buffer);
		merged.set(result.value, this.buffer.length);
		this.buffer = merged;
	}
}

type SmtpResponse = { code: number; more: boolean; text: string };

function assertPort(port: number, security: SmtpCredentials["security"]) {
	if (!Number.isInteger(port) || ![465, 587].includes(port)) throw new Error("SMTP must use port 465 or 587");
	if ((port === 465) !== (security === "tls")) {
		throw new Error(port === 465 ? "Port 465 requires TLS from connect" : "Port 587 requires STARTTLS");
	}
}

function base64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function dotStuff(mime: string): string {
	const normalized = mime.replace(/\r?\n/g, CRLF).replace(/(^|\r\n)\./g, "$1..");
	return `${normalized.endsWith(CRLF) ? normalized : `${normalized}${CRLF}`}.${CRLF}`;
}
