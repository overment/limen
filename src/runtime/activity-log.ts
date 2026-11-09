import { appendFile } from "node:fs/promises";
import { atomicWrite } from "../job/record.ts";
import type { StreamEvent } from "./stream.ts";

// Coordinators and the picture watch the job folder; a streamed delta must not rewrite the same word many times a second.
const ACTIVITY_REFRESH_MS = 1_000;

export type StreamSeen = {
	activity: string;
	activityAt: number;
	assistant: string;
	stop: string;
	tool: string;
	progress: number;
};

/** Writes stream events into the seat's job folder. The engine may be local or on another machine. */
export async function recordStreamEvents(
	jobDir: string,
	events: readonly StreamEvent[],
	nextCount: () => number,
	seen: StreamSeen,
): Promise<void> {
	for (const event of events) {
		if (event.kind === "tool") {
			await recordTool(jobDir, event, nextCount, seen);
		} else if (event.kind === "activity") {
			await recordActivity(jobDir, event.name, seen);
		} else if (event.kind === "assistant") {
			seen.assistant = event.text;
			seen.stop = event.stopReason ?? "";
			if (event.text) {
				await appendFile(`${jobDir}/log`, `${event.text}\n`);
			}
		} else {
			seen.progress += 1;
			await appendFile(`${jobDir}/log`, `${event.line}\n`);
		}
	}
}

async function recordTool(
	jobDir: string,
	event: { readonly name: string; readonly detail?: string },
	nextCount: () => number,
	seen: StreamSeen,
): Promise<void> {
	seen.activity = "tool";
	seen.tool = event.detail ? `${event.name} ${event.detail}` : event.name;
	await atomicWrite(`${jobDir}/last-tool`, `${event.name}\n`);
	await atomicWrite(`${jobDir}/activity`, "tool\n");
	seen.activityAt = Date.now();
	await atomicWrite(`${jobDir}/tool-calls`, `${nextCount()}\n`);
	await appendFile(`${jobDir}/log`, event.detail ? `${event.name} ${event.detail}\n` : `${event.name}\n`);
}

async function recordActivity(jobDir: string, name: string, seen: StreamSeen): Promise<void> {
	if (seen.activity !== name || Date.now() - seen.activityAt >= ACTIVITY_REFRESH_MS) {
		await atomicWrite(`${jobDir}/activity`, `${name}\n`);
		seen.activityAt = Date.now();
	}
	if (seen.activity !== name) {
		seen.activity = name;
		await appendFile(`${jobDir}/log`, `${name}\n`);
	}
}
