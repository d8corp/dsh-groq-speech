import { createApiHandler } from "./api.mjs";
import { API_PREFIX } from "./constants.mjs";
import { buildTrustedHosts } from "./fence.mjs";
import { createProvider } from "./provider.mjs";
import { cancelUninstallCleanup, profileDeclaresPackage, watchForUninstallCleanup } from "./uninstall.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// src/index.ts
/**
* dsh-groq-speech — host plugin entry.
*
* Registers a Groq Whisper `SpeechProvider` with the experimental voice-input
* registry, the same-origin settings API used by the browser half, and the
* post-uninstall data cleanup watcher. Neither registration throws when the
* user has no key: a missing key is a normal state surfaced in the settings
* page and as a transcription error.
*/
/**
* Resolve the profile directory from the loader context. The loader sets
* `baseUrl` to the directory of the profile configuration, which is also the
* directory holding `package.json`.
*
* @param baseUrl context base URL, usually a `file:` URL.
* @returns an absolute directory path, or null when it cannot be resolved.
*/
function resolveProfileDir(baseUrl) {
	if (typeof baseUrl !== "string" || baseUrl.trim() === "") return null;
	try {
		const value = baseUrl.startsWith("file:") ? fileURLToPath(new URL(".", baseUrl)) : baseUrl;
		return resolve(value);
	} catch {
		return null;
	}
}
/** Plugin identity used by the composed profile. */
const name = "groq-speech";
/** Services required before mounting. */
const inject = [
	"speechToText",
	"webServer",
	"webStartup",
	"credentials",
	"llm"
];
/**
* Mount the provider, the browser API and the uninstall watcher.
*
* @param ctx host context.
*/
function apply(ctx) {
	cancelUninstallCleanup();
	const provider = createProvider(ctx);
	ctx.effect(() => {
		return ctx.speechToText.register(provider);
	}, "dsh-groq-speech: provider");
	const trustedHosts = buildTrustedHosts(ctx.webStartup?.trustedHosts, (message) => {
		console.warn("[dsh-groq-speech] ignoring invalid trusted host:", message);
	});
	const handler = createApiHandler(ctx, { trustedHosts });
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler
	}), "dsh-groq-speech: api");
	const profileDir = resolveProfileDir(ctx.baseUrl);
	if (profileDir !== null && profileDeclaresPackage(profileDir) === true) {
		const watchedProfileDir = profileDir;
		ctx.effect(() => () => {
			watchForUninstallCleanup({ profileDir: watchedProfileDir });
		}, "dsh-groq-speech: uninstall cleanup");
	}
}
export { apply, inject, name };
