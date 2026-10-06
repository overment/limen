import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Project loader: installed package hooks, including opt-in informational group delivery. */
export default async function limen(pi: unknown): Promise<void> {
	const root = process.env.LIMEN_PACKAGE?.trim() || findPackage();
	for (const name of ["wake", "communication", "steering", "group-peer"] as const) {
		const loaded = await import(pathToFileURL(join(root, "hook", `${name}.ts`)).href);
		await loaded.default(pi);
	}
}

function findPackage(): string {
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) {
			continue;
		}
		const bin = join(dir, "limen");
		if (!existsSync(bin)) {
			continue;
		}
		return join(dirname(realpathSync(bin)), "..");
	}
	throw new Error("limen is not on PATH; cannot load package hooks");
}
