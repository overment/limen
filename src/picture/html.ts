import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { escapeHtml } from "./markdown.ts";
import type { PictureModel } from "./picture-model.ts";

export type Viewer = {
	readonly template: string;
	readonly css: string;
	readonly js: string;
	readonly layersCss: string;
	readonly layersJs: string;
};
export const MARKERS = {
	css: "<!-- ARCHMAP:CSS -->",
	js: "<!-- ARCHMAP:JS -->",
	data: "<!-- ARCHMAP:DATA -->",
} as const;

// The template is checked before the other files are read, so a broken template names itself.
export async function readViewer(dir: string): Promise<Viewer> {
	const template = await readFile(join(dir, "template.html"), "utf8");
	validateTemplate(template);
	const [css, js, layersCss, layersJs] = await Promise.all([
		readFile(join(dir, "viewer.css"), "utf8"),
		readFile(join(dir, "viewer.js"), "utf8"),
		readFile(join(dir, "layers.css"), "utf8"),
		readFile(join(dir, "layers.js"), "utf8"),
	]);
	return { template, css, js, layersCss, layersJs };
}

function validateTemplate(template: string): void {
	for (const [name, marker] of Object.entries(MARKERS)) {
		const count = template.split(marker).length - 1;
		if (count !== 1) {
			throw new Error(
				`viewer/template.html must contain the ${name.toUpperCase()} marker exactly once (found ${count})`,
			);
		}
	}
	if (template.indexOf(MARKERS.data) > template.indexOf(MARKERS.js)) {
		throw new Error("viewer/template.html must place the DATA marker before the JS marker");
	}
}

// No '<' can terminate the JSON script block, even inside untrusted metadata.
export function embedJson(model: PictureModel): string {
	return JSON.stringify(model).replace(/</g, "\\u003c");
}

export function assembleHtml(model: PictureModel, viewer: Viewer, tip?: string): string {
	validateTemplate(viewer.template);
	const tipAttribute = tip === undefined ? "" : ` data-tip="${escapeHtml(tip)}"`;
	const parts: Record<string, string> = {
		// Layers sit on top of the viewer: their CSS comes after it, their script before it.
		[MARKERS.css]: [viewer.css, viewer.layersCss]
			.map((css) => `<style>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`)
			.join("\n"),
		[MARKERS.data]: `<script type="application/json" id="archmap-data"${tipAttribute}>${embedJson(model)}</script>`,
		[MARKERS.js]: [viewer.layersJs, viewer.js]
			.map((js) => `<script>\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`)
			.join("\n"),
	};
	// Inserted text is never rescanned, and replacement strings keep literal '$'.
	return viewer.template.replace(/<!-- ARCHMAP:(?:CSS|JS|DATA) -->/g, (marker) => parts[marker]!);
}
