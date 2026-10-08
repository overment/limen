import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBoard } from "./board.ts";
import { readDataset } from "./dataset.ts";
import { assembleHtml, readViewer } from "./html.ts";
import { buildModel, type PictureModel } from "./picture-model.ts";
import { readTickets } from "./tickets.ts";

/** With `root`, every cited source is checked against the project root and a missing path warns. */
export async function readPicture(dir: string, root?: string): Promise<PictureModel> {
	const dataset = await readDataset(dir);
	if (root === undefined) {
		return buildModel({ files: dataset.files, diagnostics: dataset.diagnostics });
	}
	const [tickets, board] = await Promise.all([readTickets(root), readBoard(root)]);
	return buildModel({
		files: dataset.files,
		diagnostics: [...dataset.diagnostics, ...tickets.diagnostics],
		tickets: tickets.tickets,
		board,
		exists: (path) => existsSync(join(root, path)),
	});
}

/** The page and its model. `live` is the event stream path that `limen picture serve` gives the page. */
export async function pictureHtml(
	dir: string,
	root?: string,
	tip?: string,
	live?: string,
): Promise<{ model: PictureModel; html: string }> {
	const model = await readPicture(dir, root);
	const viewer = await readViewer(fileURLToPath(new URL("../../picture/viewer/", import.meta.url)));
	return { model, html: assembleHtml(model, viewer, tip, live) };
}

export async function buildPicture(
	dir: string,
	out: string,
	json?: string,
	tip?: string,
	root?: string,
): Promise<PictureModel> {
	const { model, html } = await pictureHtml(dir, root, tip);
	await writeAtomic(out, html);
	if (json !== undefined) {
		await writeAtomic(json, `${JSON.stringify(model, null, 2)}\n`);
	}
	return model;
}

async function writeAtomic(file: string, text: string): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(tmp, text, { flag: "wx" });
		await rename(tmp, file);
	} catch (error) {
		await rm(tmp, { force: true });
		throw error;
	}
}
