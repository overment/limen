import { hostQueueLines } from "../runtime/hosts.ts";
import { queueReport } from "../runtime/start-queue.ts";

/** `limen queue`: the seat's start queue in start order, the gate, and one line per host. */
export async function queueCommand(args: readonly string[]): Promise<void> {
	if (args.length > 0) {
		throw new Error("queue takes no arguments");
	}
	const hosts = await hostQueueLines();
	console.log([await queueReport(), ...(hosts ? [hosts] : [])].join("\n"));
}
