import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { readOptional } from "./inherit.ts";
import { seatDir, withSeatLock } from "./seat.ts";

/**
 * Ticket numbers. A plant has taken a number when a ticket folder in any lane, a row of its archive register, a local
 * `limen/*` branch or a job label names it. Plants that share a series take numbers from one seat folder,
 * `.limen/series/<name>/`: `plants` holds one plant root per line, `mark` the highest number `ticket new` issued, and
 * `ticket new` holds `mark.lock` from reading the mark to writing the ticket.
 */
export type Series = { readonly name: string; readonly dir: string; readonly plants: readonly string[] };

/** One row of the register of tickets a plant moved out of its lanes. */
export type ArchiveRow = {
	/** Line in the register, from 1. */
	readonly line: number;
	readonly path: string;
	/** The ticket the row archives; empty when its path names no `FNNN-slug` folder, as in the high-water row. */
	readonly code: string;
	readonly number: number;
	readonly title: string;
	/** The lane the ticket left, such as done; the folder above its month folder, or above the ticket folder. */
	readonly lane: string;
	readonly month: string;
};

/** The plant's tracked archive register: a header line, then one tab-separated row per archived ticket. */
export const ARCHIVE = "spec/features/archive.tsv";
const COLUMNS = ["path", "number", "title", "close_month", "archive_date", "last_commit", "manifest_digest"];
const SERIES_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const seriesRoot = () => join(seatDir(), "series");

export const ticketCode = (number: number) => `F${String(number).padStart(3, "0")}`;

/**
 * Calls `create` with the next free code and returns its result. In a series the code is above the mark and above
 * every number each plant of the series has taken, and the lock holds until `create` returns.
 */
export function withNextTicketCode<T>(root: string, plant: string, create: (code: string) => T): T {
	const series = plantSeries(plant);
	if (!series) {
		return create(ticketCode(highestTaken([root, plant]) + 1));
	}
	return withSeatLock(join(series.dir, "mark"), () => {
		const next = Math.max(readMark(series), highestTaken([root, plant, ...series.plants])) + 1;
		writeAtomic(join(series.dir, "mark"), `${ticketCode(next)}\n`);
		return create(ticketCode(next));
	});
}

/** Codes a ticket outside the plant's own lanes holds: its archive rows, then the other plants of its series. */
export function takenElsewhere(root: string): ReadonlyMap<string, string> {
	const taken = new Map<string, string>();
	const self = real(root);
	const take = (code: string, where: string) => {
		if (code && !taken.has(code)) {
			taken.set(code, where);
		}
	};
	for (const row of archiveRows(self)) {
		take(row.code, `${ARCHIVE}:${row.line}`);
	}
	for (const plant of plantSeries(self)?.plants.filter((other) => other !== self) ?? []) {
		for (const folder of ticketFolders(plant)) {
			take(folder.code, join(plant, folder.path));
		}
		for (const row of archiveRows(plant)) {
			take(row.code, `${join(plant, ARCHIVE)}:${row.line}`);
		}
	}
	return taken;
}

/** The rows of the plant's archive register; none when it has no register. */
export function archiveRows(root: string): ArchiveRow[] {
	let text: string;
	try {
		text = readFileSync(join(root, ARCHIVE), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
	const lines = text.split(/\r?\n/);
	const head = lines[0]?.split("\t").map((name) => name.trim()) ?? [];
	const names = head.includes("number") ? head : COLUMNS;
	const rows: ArchiveRow[] = [];
	for (const [index, line] of lines.entries()) {
		if (!line.trim() || (index === 0 && names === head)) {
			continue;
		}
		const cells = line.split("\t");
		const cell = (name: string) => cells[names.indexOf(name)]?.trim() ?? "";
		const path = cell("path").replace(/\/+$/, "");
		const code = /^(F\d+)-/.exec(basename(path))?.[1] ?? "";
		const number = Number(/^F?(\d+)$/i.exec(cell("number"))?.[1] ?? code.slice(1));
		const folders = path.split("/");
		const dated = /^\d{4}-\d\d$/.test(folders.at(-2) ?? "");
		const lane = folders.at(dated ? -3 : -2) ?? "";
		const month = cell("close_month") || (dated ? (folders.at(-2) ?? "") : "");
		rows.push({ line: index + 1, path, code, number: number || 0, title: cell("title"), lane, month });
	}
	return rows;
}

/** Ticket folders in every lane, month folders included: `spec/features/<lane>/[<month>/]FNNN-slug`. */
export function ticketFolders(root: string): { readonly code: string; readonly path: string }[] {
	const found: { code: string; path: string }[] = [];
	const visit = (path: string, depth: number) => {
		for (const name of subdirectories(join(root, path))) {
			const code = /^(F\d+)-/.exec(name)?.[1];
			if (code) {
				found.push({ code, path: `${path}/${name}` });
			} else if (depth < 2) {
				visit(`${path}/${name}`, depth + 1);
			}
		}
	};
	visit("spec/features", 0);
	return found;
}

/** The series that names this plant; undefined when none does. */
export function plantSeries(plant: string): Series | undefined {
	const self = real(plant);
	const named = subdirectories(seriesRoot())
		.map(readSeries)
		.filter((series) => series.plants.includes(self));
	if (named.length > 1) {
		const names = named.map((series) => series.name).join(" and ");
		throw new Error(`${self} is in series ${names}; name it in one: limen ticket series NAME PLANT [PLANT ...]`);
	}
	return named[0];
}

/** Names the plants of a series, replacing its earlier list. A plant that another series names is refused. */
export function setSeries(name: string, plants: readonly string[]): Series {
	if (!SERIES_NAME.test(name) || plants.length === 0) {
		throw new Error("limen ticket series NAME PLANT [PLANT ...]: NAME is letters, digits, '.', '_' or '-'");
	}
	const roots = [...new Set(plants.map(real))];
	const missing = roots.find((root) => !statSync(root, { throwIfNoEntry: false })?.isDirectory());
	if (missing) {
		throw new Error(`${missing} is not a folder; name each plant by its root folder`);
	}
	for (const other of subdirectories(seriesRoot()).filter((each) => each !== name)) {
		const shared = readSeries(other).plants.find((plant) => roots.includes(plant));
		if (shared) {
			throw new Error(`${shared} is in series ${other}; a plant takes numbers from one series`);
		}
	}
	const dir = join(seriesRoot(), name);
	mkdirSync(dir, { recursive: true });
	writeAtomic(join(dir, "plants"), `${roots.join("\n")}\n`);
	return { name, dir, plants: roots };
}

export function readMark(series: Series): number {
	return Number(/F?(\d+)/i.exec(readOptional(join(series.dir, "mark")) ?? "")?.[1] ?? 0);
}

/** The number `ticket new` in a plant of the series would take now; read without the lock. */
export function seriesNext(series: Series): number {
	return Math.max(readMark(series), highestTaken(series.plants)) + 1;
}

function readSeries(name: string): Series {
	const dir = join(seriesRoot(), name);
	const plants = (readOptional(join(dir, "plants")) ?? "").split(/\r?\n/).filter((line) => line.trim());
	return { name, dir, plants: plants.map((plant) => real(plant.trim())) };
}

/** The highest number the plants have taken, each plant once. */
function highestTaken(plants: readonly string[]): number {
	let highest = 0;
	for (const plant of new Set(plants.map(real))) {
		// A number can live only on a branch or in a job before its folder reaches this checkout (the two F778 tickets).
		const branches = spawnSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/limen/"], {
			cwd: plant,
			encoding: "utf8",
		});
		const jobs = join(plant, ".limen", "jobs");
		const labels = subdirectories(jobs).map((id) => `${id}\n${readOptional(join(jobs, id, "label")) ?? ""}`);
		const named = `${branches.stdout ?? ""}\n${labels.join("\n")}`.matchAll(/\bf(\d{3,4})\b/gi);
		for (const number of [
			...ticketFolders(plant).map((folder) => folder.code.slice(1)),
			...archiveRows(plant).map((row) => row.number),
			...[...named].map((match) => match[1]),
		]) {
			highest = Math.max(highest, Number(number));
		}
	}
	return highest;
}

function subdirectories(path: string): string[] {
	try {
		return readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function writeAtomic(path: string, text: string): void {
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, text, { flag: "wx" });
	try {
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
