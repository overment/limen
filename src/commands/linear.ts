import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { limenRoot } from "../git.ts";

/** The Linear mirror toggle is one file: spec/linear.md on, spec/linear.md.off parked. Mirroring itself is agent work; this only moves the config and reports. */
export async function linearCommand(args: readonly string[], cwd: string): Promise<void> {
	const mode = args[0] ?? "status";
	if (args.length > 1 || (mode !== "on" && mode !== "off" && mode !== "status")) throw new Error("linear takes one of: on, off, status");
	const config = `${limenRoot(cwd)}/spec/linear.md`;
	const parked = `${config}.off`;
	if (mode === "off") {
		if (!existsSync(config)) {
			console.log("linear mirror already off");
			return;
		}
		await rename(config, parked);
		console.log("linear mirror off (config kept at spec/linear.md.off)");
		return;
	}
	if (mode === "on" && !existsSync(config)) {
		if (!existsSync(parked)) throw new Error("no linear config: write spec/linear.md naming Team and Project (see the installed package's templates/linear.md)");
		await rename(parked, config);
	}
	if (existsSync(config)) {
		console.log(`linear mirror on\n${await identity(config)}`);
		return;
	}
	console.log(existsSync(parked) ? "linear mirror off (config parked at spec/linear.md.off)" : "linear mirror off (no config)");
}

async function identity(path: string): Promise<string> {
	return (await readFile(path, "utf8"))
		.split("\n")
		.filter((line) => /^(Team|Project): /.test(line))
		.join("\n");
}
