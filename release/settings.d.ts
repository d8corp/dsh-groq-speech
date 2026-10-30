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
import type { GroqSpeechSettings } from './contracts';
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
export declare function dshHomeDir(env?: NodeJS.ProcessEnv): string;
/**
 * Plugin-owned data directory under the DSH home.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns `$DSH_HOME/dsh-groq-speech`.
 */
export declare function pluginDir(env?: NodeJS.ProcessEnv): string;
/**
 * Current settings path, inside the plugin data directory.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns absolute path to `groq-speech.json`.
 */
export declare function settingsPath(env?: NodeJS.ProcessEnv): string;
/**
 * 0.1.0 settings path, directly inside the DSH home.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns absolute path to the legacy `groq-speech.json`.
 */
export declare function legacySettingsPath(env?: NodeJS.ProcessEnv): string;
/**
 * Validate and normalize a settings document.
 *
 * Unknown keys are dropped; invalid values fall back to defaults instead of
 * throwing, so a hand-edited file can never break plugin startup or a request.
 *
 * @param value parsed JSON or a partial patch.
 * @returns a fully populated settings document.
 */
export declare function normalizeSettings(value: unknown): GroqSpeechSettings;
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
export declare function mergeSettings(current: unknown, patch: unknown): GroqSpeechSettings;
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
export declare function readSettings(file?: string, env?: NodeJS.ProcessEnv): GroqSpeechSettings;
/**
 * Validate and persist settings atomically (temp file + rename, mode 0600).
 *
 * @param settings desired settings document.
 * @param file explicit settings path (tests).
 * @returns the persisted document.
 */
export declare function writeSettings(settings: unknown, file?: string): GroqSpeechSettings;
