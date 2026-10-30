import { writeSecretFile } from "./atomicFile.mjs";
import { DEFAULT_MODEL, DEFAULT_SETTINGS, LEGACY_SETTINGS_FILENAME, MAX_PROMPT_CHARS, MODELS, PLUGIN_DIR_NAME, SETTINGS_FILENAME } from "./constants.mjs";
import { join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
// src/settings.ts
/**
* Host-side settings for dsh-groq-speech.
*
* Stored at `$DSH_HOME/dsh-groq-speech/groq-speech.json` (or
* `~/.dsh/dsh-groq-speech/groq-speech.json`). The file is validated on every
* read and write and never contains the Groq API key — the key belongs to
* `ctx.credentials` only.
*
* The 0.1.0 layout kept the file directly in `$DSH_HOME`; that location is
* still read when the new file is missing, so an upgrade keeps the user's
* recognition and polish settings.
*/
/** Old direct-Groq polish route; DSH now exposes Groq as a normal route. */
const LEGACY_GROQ_POLISH_PROVIDER = "groq-api";
const DSH_GROQ_PROVIDER = "groq";
/** Provider/model names stored for the polish pass: no control chars. */
const MAX_NAME_CHARS = 200;
/** Anything in C0/C1 plus DEL cannot appear in a provider/model id. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
/** Language hints accepted by the store (the picker offers a narrower list). */
const LANGUAGE_CODE = /^[a-z]{2,3}$/;
/**
* Expand a leading `~` to the current user's home directory. `~user/...` is
* deliberately left alone, matching the harness home-path helper.
*
* @param value configured path.
* @returns the path with `~` (or `~/`) expanded.
*/
function expandHome(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
	return value;
}
/**
* Resolve the DeepSeek Harness home: `$DSH_HOME` when set, otherwise `~/.dsh`.
*
* The configured value is `~`-expanded and resolved to an absolute path, so
* `DSH_HOME=~/harness` means `$HOME/harness` — never a literal `./~` directory
* relative to the server's working directory.
*
* Kept local on purpose — the host half must load with no runtime dependency
* beyond Node built-ins, so no `@deepseek-ai/*` helper package is imported here.
*
* @param env environment to read `DSH_HOME` from.
* @returns the absolute harness home directory.
*/
function dshHomeDir(env = process.env) {
	const configured = env && typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
	return resolve(configured === "" ? join(homedir(), ".dsh") : expandHome(configured));
}
/**
* Plugin-owned data directory under the DSH home.
*
* @param env environment to read `DSH_HOME` from.
* @returns `$DSH_HOME/dsh-groq-speech`.
*/
function pluginDir(env = process.env) {
	return join(dshHomeDir(env), PLUGIN_DIR_NAME);
}
/**
* Current settings path, inside the plugin data directory.
*
* @param env environment to read `DSH_HOME` from.
* @returns absolute path to `groq-speech.json`.
*/
function settingsPath(env = process.env) {
	return join(pluginDir(env), SETTINGS_FILENAME);
}
/**
* 0.1.0 settings path, directly inside the DSH home.
*
* @param env environment to read `DSH_HOME` from.
* @returns absolute path to the legacy `groq-speech.json`.
*/
function legacySettingsPath(env = process.env) {
	return join(dshHomeDir(env), LEGACY_SETTINGS_FILENAME);
}
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizeLanguage(value) {
	return typeof value === "string" && LANGUAGE_CODE.test(value) ? value : "auto";
}
function normalizeName(value) {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (trimmed === "" || CONTROL_CHARS.test(trimmed)) return "";
	return trimmed.slice(0, MAX_NAME_CHARS);
}
/**
* Validate and normalize a settings document.
*
* Unknown keys are dropped; invalid values fall back to defaults instead of
* throwing, so a hand-edited file can never break plugin startup or a request.
*
* @param value parsed JSON or a partial patch.
* @returns a fully populated settings document.
*/
function normalizeSettings(value) {
	const source = isPlainObject(value) ? value : {};
	const polish = isPlainObject(source.polish) ? source.polish : {};
	const provider = normalizeName(polish.provider);
	return {
		model: MODELS.includes(source.model) ? source.model : DEFAULT_MODEL,
		language: normalizeLanguage(source.language),
		polish: {
			provider: provider === LEGACY_GROQ_POLISH_PROVIDER ? DSH_GROQ_PROVIDER : provider,
			model: normalizeName(polish.model),
			prompt: typeof polish.prompt === "string" ? polish.prompt.slice(0, MAX_PROMPT_CHARS) : ""
		}
	};
}
/**
* Merge a partial settings patch over the current document, then normalize.
*
* Only the documented fields survive; a non-object `polish` patch leaves the
* current polish settings untouched.
*
* @param current current settings document.
* @param patch partial update from the browser.
* @returns the merged, normalized document.
*/
function mergeSettings(current, patch) {
	const base = normalizeSettings(current);
	if (!isPlainObject(patch)) return base;
	const next = {
		model: Object.prototype.hasOwnProperty.call(patch, "model") ? patch.model : base.model,
		language: Object.prototype.hasOwnProperty.call(patch, "language") ? patch.language : base.language,
		polish: { ...base.polish }
	};
	if (isPlainObject(patch.polish)) {
		const polish = next.polish;
		for (const key of [
			"provider",
			"model",
			"prompt"
		]) if (Object.prototype.hasOwnProperty.call(patch.polish, key)) polish[key] = patch.polish[key];
	}
	return normalizeSettings(next);
}
/**
* Read one settings file, or null when it is missing or unreadable.
*
* @param file absolute path.
* @returns the parsed document, or null.
*/
function readSettingsFile(file) {
	try {
		return normalizeSettings(JSON.parse(readFileSync(file, "utf8")));
	} catch {
		return null;
	}
}
/**
* Read and validate the settings file.
*
* A missing, unreadable, or malformed file yields the defaults — settings are
* advisory and must never take a request down. When the current path does not
* exist yet, the 0.1.0 file in `$DSH_HOME` is used as a one-time source.
*
* @param file explicit settings path (tests).
* @param env environment to read `DSH_HOME` from.
* @returns the effective settings document.
*/
function readSettings(file, env = process.env) {
	const target = file ?? settingsPath(env);
	if (existsSync(target)) return readSettingsFile(target) ?? normalizeSettings(DEFAULT_SETTINGS);
	if (file === void 0) {
		const legacy = legacySettingsPath(env);
		if (existsSync(legacy)) return readSettingsFile(legacy) ?? normalizeSettings(DEFAULT_SETTINGS);
	}
	return normalizeSettings(DEFAULT_SETTINGS);
}
/**
* Validate and persist settings atomically (temp file + rename, mode 0600).
*
* @param settings desired settings document.
* @param file explicit settings path (tests).
* @returns the persisted document.
*/
function writeSettings(settings, file) {
	const normalized = normalizeSettings(settings);
	writeSecretFile(file ?? settingsPath(), `${JSON.stringify(normalized, null, 2)}\n`);
	return normalized;
}
export { dshHomeDir, legacySettingsPath, mergeSettings, normalizeSettings, pluginDir, readSettings, settingsPath, writeSettings };
