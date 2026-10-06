import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

/** Each command words its own flag errors; parseArgs words them differently. */
export type FlagRules<Name extends string> = {
	/** A `--name` the table does not hold, a boolean given `=value`, or a word the rules below turn away. */
	readonly unknown: (word: string, next: string | undefined) => string;
	/** A string flag with no value, an empty value, or a separate value that starts with `--`. Gets `--name`. */
	readonly missing: (flag: string) => string;
	/** A second use of a flag without `multiple`. No rule, or no message, and the last use wins. */
	readonly repeated?: (flag: string) => string | undefined;
	/** String flags whose separate value may start with `--`, such as a label. */
	readonly dashValues?: readonly Name[];
	/** `false`: every word that is not a flag or a flag's value goes to `unknown`. */
	readonly positionals?: boolean;
	/** `false`: a lone `--` goes to `unknown` instead of ending the flags. */
	readonly endOfFlags?: boolean;
};

/**
 * Parse a command's flags with parseArgs and the command's own messages, checked in argument order. Only a word that
 * starts with `--` is a flag; `-x` and `-` stay positionals, as task text may hold them.
 */
export function parseFlags<T extends ParseArgsOptionsConfig>(
	args: readonly string[],
	table: T,
	rules: FlagRules<keyof T & string>,
) {
	const { tokens } = parseArgs({
		args: [...args],
		options: table,
		allowPositionals: true,
		strict: false,
		tokens: true,
	});
	const flags: string[] = [];
	const positionals: string[] = [];
	const seen = new Set<string>();
	let lastIndex = -1;
	for (const token of tokens) {
		const word = args[token.index] ?? "";
		const next = args[token.index + 1];
		if (token.kind === "option-terminator" && rules.endOfFlags === false) {
			throw new Error(rules.unknown(word, next));
		}
		if (token.kind === "option-terminator") {
			continue;
		}
		const positional = token.kind === "positional" || !token.rawName.startsWith("--");
		if (positional && rules.positionals === false) {
			throw new Error(rules.unknown(word, next));
		}
		if (positional) {
			// `-abc` gives one token per letter, all at one index.
			if (token.index !== lastIndex) {
				positionals.push(word);
			}
			lastIndex = token.index;
			continue;
		}
		const option = Object.hasOwn(table, token.name) ? table[token.name] : undefined;
		if (!option || (option.type === "boolean" && token.inlineValue)) {
			throw new Error(rules.unknown(word, next));
		}
		// Without strict mode, parseArgs takes the next flag as the value: `--onto --yes`.
		const flagAsValue = !token.inlineValue && token.value?.startsWith("--") && !rules.dashValues?.includes(token.name);
		if (option.type === "string" && (!token.value || flagAsValue)) {
			throw new Error(rules.missing(token.rawName));
		}
		const again = seen.has(token.name) && !option.multiple ? rules.repeated?.(token.rawName) : undefined;
		if (again) {
			throw new Error(again);
		}
		seen.add(token.name);
		flags.push(option.type === "string" ? `--${token.name}=${token.value}` : `--${token.name}`);
	}
	return parseArgs({ args: [...flags, "--", ...positionals], options: table, allowPositionals: true });
}
