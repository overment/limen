import { finishWebhookEnv, sendTestPing } from "../integrations/finish-webhook.ts";
import { limenRoot } from "../project/git.ts";

/** `limen webhook test` sends one `webhook.test` event to the plant's finish webhook targets through the real sender. */
export async function webhookCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args.length !== 1 || args[0] !== "test") {
		throw new Error("webhook accepts only: test");
	}
	const root = limenRoot(cwd);
	const config = finishWebhookEnv(root, cwd);
	if (!config) {
		throw new Error(
			`no finish webhook config for ${root}: create .limen/finish-webhook.env or set LIMEN_FINISH_WEBHOOK_ENV`,
		);
	}
	const status = sendTestPing(root, config);
	if (status !== 0) {
		process.exitCode = status;
	}
}
