/**
 * dsh-groq-speech — host plugin entry.
 *
 * Registers a Groq Whisper `SpeechProvider` with the experimental voice-input
 * registry, the same-origin settings API used by the browser half, and the
 * post-uninstall data cleanup watcher. Neither registration throws when the
 * user has no key: a missing key is a normal state surfaced in the settings
 * page and as a transcription error.
 */
import type { ApiHandler } from './api';
import type { SpeechProvider } from './provider';
interface PluginContext {
    baseUrl?: unknown;
    webStartup?: {
        trustedHosts?: unknown;
    };
    webServer: {
        register(route: {
            kind: 'prefix';
            path: string;
            handler: ApiHandler;
        }): unknown;
    };
    speechToText: {
        register(provider: SpeechProvider): unknown;
    };
    effect(callback: () => unknown, label: string): unknown;
}
/** Plugin identity used by the composed profile. */
export declare const name = "groq-speech";
/** Services required before mounting. */
export declare const inject: string[];
/**
 * Mount the provider, the browser API and the uninstall watcher.
 *
 * @param ctx host context.
 */
export declare function apply(ctx: PluginContext): void;
export {};
