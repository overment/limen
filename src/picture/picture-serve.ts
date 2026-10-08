import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { activityReader } from "./activity.ts";
import { pictureHtml } from "./picture-build.ts";

const HOST = "127.0.0.1";
const EVENTS = "/events";
const READ_MS = 1_000;
const PING_MS = 15_000;

export type ServeOptions = {
	readonly dir: string;
	readonly root: string;
	readonly jobsRoot: string;
	readonly port: number;
	readonly tip: () => string | undefined;
};

/**
 * Serves the picture on 127.0.0.1 and pushes job activity to the page over Server-Sent Events.
 * The page is built per request, so a reload shows the current tickets and board; activity is read once a second
 * and sent only when it changed.
 */
export async function servePicture(options: ServeOptions): Promise<{ url: string; close(): Promise<void> }> {
	// One build before listening, so a missing or broken picture fails the command, not the first page load.
	await pictureHtml(options.dir, options.root, options.tip(), EVENTS);
	const read = activityReader(options.jobsRoot);
	const first = await read();
	let snapshot = JSON.stringify(first);
	let jobs = JSON.stringify(first.jobs);
	let reading = false;
	const clients = new Set<ServerResponse>();
	const refresh = async () => {
		if (reading) {
			return;
		}
		reading = true;
		try {
			const next = await read();
			snapshot = JSON.stringify(next);
			const changed = JSON.stringify(next.jobs);
			if (changed !== jobs) {
				jobs = changed;
				for (const client of clients) {
					client.write(`event: activity\ndata: ${snapshot}\n\n`);
				}
			}
		} catch (error) {
			console.error(`picture serve: reading jobs failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			reading = false;
		}
	};
	const server = createServer();
	const port = await listen(server, options.port);
	server.on("request", (request: IncomingMessage, response: ServerResponse) => {
		respond(request, response, options, port, () => snapshot, clients).catch((error: unknown) => {
			if (!response.headersSent) {
				response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
			}
			response.end(error instanceof Error ? error.message : String(error));
		});
	});
	const reader = setInterval(() => {
		void refresh();
	}, READ_MS);
	// A named event, not an SSE comment: the page sees it and can tell a stalled feed from a quiet one.
	const pinger = setInterval(() => {
		for (const client of clients) {
			client.write(`event: ping\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
		}
	}, PING_MS);
	return {
		url: `http://${HOST}:${port}/`,
		close: async () => {
			clearInterval(reader);
			clearInterval(pinger);
			for (const client of clients) {
				client.end();
			}
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

async function respond(
	request: IncomingMessage,
	response: ServerResponse,
	options: ServeOptions,
	port: number,
	snapshot: () => string,
	clients: Set<ServerResponse>,
): Promise<void> {
	// Another site that rebinds its name to 127.0.0.1 sends its own Host; only this address may read job activity.
	if (request.headers.host !== `${HOST}:${port}` && request.headers.host !== `localhost:${port}`) {
		response.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("wrong host\n");
		return;
	}
	const path = new URL(request.url ?? "/", `http://${HOST}`).pathname;
	if (request.method !== "GET" || !["/", "/activity.json", EVENTS].includes(path)) {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found\n");
		return;
	}
	if (path === "/") {
		const { html } = await pictureHtml(options.dir, options.root, options.tip(), EVENTS);
		response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
		return;
	}
	if (path === "/activity.json") {
		response
			.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
			.end(`${snapshot()}\n`);
		return;
	}
	response.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-store",
		connection: "keep-alive",
	});
	response.write(`retry: 2000\n\nevent: activity\ndata: ${snapshot()}\n\n`);
	clients.add(response);
	request.on("close", () => clients.delete(response));
}

async function listen(server: Server, port: number): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", (error: NodeJS.ErrnoException) =>
			reject(error.code === "EADDRINUSE" ? new Error(`port ${port} on ${HOST} is in use; pass another --port`) : error),
		);
		server.listen(port, HOST, () => resolve());
	});
	const address = server.address();
	return typeof address === "object" && address ? address.port : port;
}
