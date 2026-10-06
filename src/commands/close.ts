import { closeFeatureTabs } from "../integrations/herdr.ts";
import { limenRoot } from "../project/git.ts";

export async function closeCommand(args: readonly string[], cwd: string): Promise<void> {
	const feature = args[0];
	if (!feature || args.length !== 1) {
		throw new Error("close requires a feature like F012");
	}
	console.log(await closeFeatureTabs({ root: limenRoot(cwd), feature }));
}
