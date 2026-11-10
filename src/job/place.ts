import { hostname } from "node:os";

const SHORT = /^[a-z0-9](?:[a-z0-9-]{0,15})$/;

/**
 * What a local job runs on. A short hostname such as `mini` is the name; anything longer or odd stays `seat`.
 */
export function seatPlace(): string {
	const name = hostname().split(".")[0]?.toLowerCase() ?? "";
	return SHORT.test(name) ? name : "seat";
}

/** The host alias when the job record has one, otherwise the seat. */
export function jobPlace(host: string | undefined): string {
	const alias = host?.trim();
	return alias || seatPlace();
}
