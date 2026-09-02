import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { limenRoot } from "../git.ts";

/** The Linear mirror toggle is one file: spec/linear.md on, spec/linear.md.off parked. Mirroring itself is agent work; this only moves the config and reports. */
export async function linearCommand(args: readonly string[], cwd: string): Promise<void> {
	const [mode = "status", ...rest] = args;
	if (mode !== "on" && mode !== "off" && mode !== "status") throw new Error("linear takes one of: on, off, status");
	const fresh = parseIdentity(rest, mode);
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
		if (existsSync(parked)) {
			if (fresh) throw new Error("config already parked at spec/linear.md.off; run limen linear on without options, or edit that file");
			await rename(parked, config);
		} else if (fresh) {
			await writeFile(config, `# Linear mirror\nTeam: ${fresh.team}\nProject: ${fresh.project}\n`, { flag: "wx" });
			console.log("config written; creating the Linear project and any backfill remain coordinator work");
		} else throw new Error("no linear config: run limen linear on --team <name> --project <name>, or write spec/linear.md (see the installed package's templates/linear.md)");
	} else if (fresh) throw new Error("spec/linear.md already exists; edit it instead of passing --team/--project");
	if (existsSync(config)) {
		console.log(`linear mirror on\n${await identity(config)}`);
		return;
	}
	console.log(existsSync(parked) ? "linear mirror off (config parked at spec/linear.md.off)" : "linear mirror off (no config)");
}

function parseIdentity(rest: readonly string[], mode: string): { readonly team: string; readonly project: string } | undefined {
	if (rest.length === 0) return undefined;
	if (mode !== "on") throw new Error(`linear ${mode} takes no options`);
	let team: string | undefined;
	let project: string | undefined;
	for (let index = 0; index < rest.length; index += 2) {
		const flag = rest[index];
		const value = rest[index + 1];
		if ((flag !== "--team" && flag !== "--project") || !value) throw new Error("linear on takes --team <name> --project <name>");
		if (flag === "--team") team = value;
		else project = value;
	}
	if (!team || !project) throw new Error("linear on takes --team and --project together");
	return { team, project };
}

async function identity(path: string): Promise<string> {
	return (await readFile(path, "utf8"))
		.split("\n")
		.filter((line) => /^(Team|Project): /.test(line))
		.join("\n");
}
