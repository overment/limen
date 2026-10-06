import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { isTerminal } from "./job.ts";

// The notify/ record of who heard a job: claims, delivered slots, unconfirmed attempts, subscribers, and the ready marker.
const DEFAULT_FALLBACK_GRACE_MS = 5 * 60_000;
export const CLAIM_STALE_MS = 30_000;
const WAKE_ATTEMPTS = 2;
export function deliverySettled(job: string, session: string): boolean {
	if (!isTerminal(text(join(job, "state")))) {
		return false;
	}
	if (claimSlots(job).length > 0) {
		return false;
	}
	if (!routable(job)) {
		return true;
	}
	const delivered = deliveredSlots(job);
	if (subscribed(job, session)) {
		return delivered.includes(session) || delivered.includes("_fallback");
	}
	return completionSlots(delivered).length > 0;
}
export type DeliveryCallbacks = {
	readonly blocked: () => void;
	readonly protected: (claim: string) => boolean;
	readonly pending: (claim: string, delivered: string) => void;
	readonly accepted: (claim: string) => void;
	readonly released: (claim: string) => void;
};
export function claimDelivery(
	job: string,
	slot: string,
	eligible: () => boolean,
	send: () => false | void | Promise<void>,
	callbacks: DeliveryCallbacks,
): boolean {
	const claim = join(job, "notify", "claims", slot);
	const delivered = join(job, "notify", "delivered", slot);
	if (unsuccessfulAttempts(claim) >= WAKE_ATTEMPTS) {
		return false;
	}
	mkdirSync(join(job, "notify", "claims"), { recursive: true });
	mkdirSync(join(job, "notify", "delivered"), { recursive: true });
	if (!callbacks.protected(claim)) {
		const recovered = recoverClaim(claim);
		if (recovered) {
			callbacks.released(claim);
		}
		if (recovered === "blocked") {
			callbacks.blocked();
		}
	}
	if (existsSync(delivered) || existsSync(claim)) {
		return false;
	}
	try {
		mkdirSync(claim);
		writeFileSync(join(claim, "owner"), `${process.pid}\n${new Date().toISOString()}\n`);
	} catch {
		return false;
	}
	if (existsSync(delivered)) {
		try {
			appendFileSync(join(job, "log"), `[limen ${new Date().toISOString()}] dropped duplicate wake for ${slot}\n`);
		} catch {
			// The released claim is the durable fact.
		}
		rmSync(claim, { recursive: true, force: true });
		return false;
	}
	const sameKind = claimSlots(job).filter((name) => receiptFamily(name) === receiptFamily(slot));
	// Claims in flight count as attempts: same-family claims plus failures never exceed the ceiling.
	if (!eligible() || sameKind.length + unsuccessfulAttempts(claim) > WAKE_ATTEMPTS) {
		rmSync(claim, { recursive: true, force: true });
		return false;
	}
	callbacks.pending(claim, delivered);
	const reject = () => {
		callbacks.released(claim);
		if (recordUnconfirmed(claim, "wake injection failed")) {
			callbacks.blocked();
		}
	};
	try {
		const injected = send();
		if (injected === false) {
			callbacks.released(claim);
			rmSync(claim, { recursive: true, force: true });
			return false;
		}
		const accept = () => {
			if (!existsSync(claim)) {
				callbacks.released(claim);
				return;
			}
			writeFileSync(join(claim, "accepted"), "1\n");
			callbacks.accepted(claim);
		};
		if (injected instanceof Promise) {
			injected.then(accept, reject);
		} else {
			accept();
		}
		return true;
	} catch {
		reject();
		return false;
	}
}
function recoverClaim(claim: string): "released" | "blocked" | undefined {
	try {
		if (!existsSync(claim) || existsSync(join(claim, "blocked"))) {
			return undefined;
		}
		if (Date.now() - statSync(claim).mtimeMs < CLAIM_STALE_MS) {
			return undefined;
		}
		if (existsSync(join(claim, "accepted"))) {
			const live = join(claim, "live");
			if (text(live) !== "closed" && existsSync(live) && Date.now() - statSync(live).mtimeMs < CLAIM_STALE_MS) {
				return undefined;
			}
			if (recordUnconfirmed(claim)) {
				return "blocked";
			}
			return existsSync(claim) ? undefined : "released";
		}
		rmSync(claim, { recursive: true, force: true });
		return "released";
	} catch {
		// Another coordinator recovered it first.
	}
	return undefined;
}
export function refreshClaim(claim: string): void {
	try {
		writeFileSync(join(claim, "live"), `${new Date().toISOString()}\n`);
	} catch {
		// A missing claim was confirmed or recovered between the sweep and this heartbeat.
	}
}
function attemptsPath(claim: string): string {
	return join(dirname(dirname(claim)), "unconfirmed", receiptFamily(claim.slice(claim.lastIndexOf("/") + 1)));
}
function unsuccessfulAttempts(claim: string): number {
	return text(attemptsPath(claim))
		.split("\n")
		.reduce((sum, line) => sum + Number(line), 0);
}
export function recordUnconfirmed(
	claim: string,
	reason = "wake turn errored, aborted or remained unconfirmed",
): boolean {
	try {
		if (!existsSync(claim) || existsSync(join(claim, "blocked"))) {
			return false;
		}
		writeFileSync(join(claim, "unsuccessful"), "1\n", { flag: "wx" });
		const attemptsFile = attemptsPath(claim);
		mkdirSync(dirname(attemptsFile), { recursive: true });
		// Append atomically: competing subscribers must not overwrite each other's failure.
		appendFileSync(attemptsFile, "1\n");
		const attempts = unsuccessfulAttempts(claim);
		if (attempts < WAKE_ATTEMPTS) {
			rmSync(claim, { recursive: true, force: true });
		} else {
			writeFileSync(
				join(claim, "blocked"),
				`automatic retries stopped after ${WAKE_ATTEMPTS} unsuccessful attempts\n`,
				{ flag: "wx" },
			);
		}
		try {
			const stopped = attempts >= WAKE_ATTEMPTS ? "; automatic retries stopped; claim retained for human recovery" : "";
			appendFileSync(
				join(dirname(dirname(dirname(claim))), "log"),
				`[limen ${new Date().toISOString()}] ${reason}; unsuccessful wake attempt ${attempts}/${WAKE_ATTEMPTS}${stopped}\n`,
			);
		} catch {
			// The allowance and retained claim remain authoritative if logging fails.
		}
		return attempts >= WAKE_ATTEMPTS;
	} catch {
		return false;
	}
}
export function confirmClaim(claim: string, delivered: string): void {
	try {
		if (
			!existsSync(join(claim, "accepted")) ||
			existsSync(join(claim, "blocked")) ||
			unsuccessfulAttempts(claim) >= WAKE_ATTEMPTS
		) {
			return;
		}
		if (!existsSync(delivered)) {
			renameSync(claim, delivered);
		} else {
			rmSync(claim, { recursive: true, force: true });
		}
	} catch {
		// Another coordinator confirmed or recovered it first.
	}
}
export function deliveredSlots(job: string): string[] {
	try {
		return readdirSync(join(job, "notify", "delivered"));
	} catch {
		return [];
	}
}
export function claimSlots(job: string): string[] {
	try {
		return readdirSync(join(job, "notify", "claims"));
	} catch {
		return [];
	}
}
export function recoverClaims(job: string, protectedClaim: (claim: string) => boolean = () => false): boolean {
	let blocked = false;
	for (const slot of claimSlots(job)) {
		const claim = join(job, "notify", "claims", slot);
		if (!protectedClaim(claim) && recoverClaim(claim) === "blocked") {
			blocked = true;
		}
	}
	return blocked;
}
export function claimMarker(job: string, kind: string, slot: string): boolean {
	const root = join(job, "notify", kind);
	mkdirSync(root, { recursive: true });
	try {
		writeFileSync(join(root, slot), "1\n", { flag: "wx" });
		return true;
	} catch {
		return false;
	}
}
export function deliveryExists(job: string, slot: string): boolean {
	return existsSync(join(job, "notify", "delivered", slot));
}
export function subscribed(job: string, session: string): boolean {
	return routable(job) && existsSync(join(job, "notify", "subscribers", session));
}
export function routable(job: string): boolean {
	return existsSync(join(job, "notify", "ready"));
}
export function enrollLegacyRunning(job: string): void {
	mkdirSync(join(job, "notify", "subscribers"), { recursive: true });
	try {
		writeFileSync(join(job, "notify", "ready"), "1\n", { flag: "wx" });
	} catch {
		// Another coordinator enrolled it first.
	}
}
export function subscribeSession(job: string, session: string): void {
	mkdirSync(join(job, "notify", "subscribers"), { recursive: true });
	try {
		writeFileSync(join(job, "notify", "subscribers", session), `${new Date().toISOString()}\n`, { flag: "wx" });
	} catch {
		// Already subscribed.
	}
}
export function oldEnoughForFallback(job: string, stamp = join(job, "finished-at")): boolean {
	const finished = Date.parse(text(stamp));
	const since = Number.isFinite(finished) ? finished : statSync(existsSync(stamp) ? stamp : join(job, "state")).mtimeMs;
	return Date.now() - since >= fallbackGraceMs();
}
function fallbackGraceMs(): number {
	const raw = Number(process.env.LIMEN_WAKE_FALLBACK_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FALLBACK_GRACE_MS;
}
export function sessionOwnsJobs(jobs: string, session: string): boolean {
	try {
		for (const id of readdirSync(jobs)) {
			if (existsSync(join(jobs, id, "notify", "subscribers", session))) {
				return true;
			}
		}
	} catch {
		// Missing jobs directory means this session owns nothing here.
	}
	return false;
}
function isAdvisorySlot(slot: string): boolean {
	return slot.startsWith("_advisory.");
}
export function receiptFamily(slot: string): "_advisory" | "_uncertainty" | "_completion" {
	if (isAdvisorySlot(slot)) {
		return "_advisory";
	}
	if (slot.startsWith("_uncertainty.")) {
		return "_uncertainty";
	}
	return "_completion";
}
export function completionSlots(names: readonly string[]): string[] {
	return names.filter((name) => receiptFamily(name) === "_completion");
}
function text(path: string): string {
	if (!existsSync(path)) {
		return "";
	}
	return readFileSync(path, "utf8").trim();
}
