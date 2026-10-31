/**
 * Read the official voice-input selection and switch it to Groq Whisper.
 *
 * The official bundle owns the selection (persisted per profile), so this
 * module only reports it and offers one explicit action. Every read is
 * best-effort: a profile without the voice-input bundle reports
 * `available: false` instead of failing the settings page.
 */
import type { VoiceInputStatus } from './contracts';
/**
 * Describe the current voice-input provider selection.
 *
 * @param ctx host context.
 * @returns the selection; `available` is false when it cannot be read.
 */
export declare function readVoiceInputStatus(ctx: unknown): VoiceInputStatus;
/**
 * Check whether the official service is ready to switch to Groq Whisper.
 *
 * @param ctx host context.
 * @returns true when the provider is registered and configure is callable.
 */
export declare function canSelectVoiceProvider(ctx: unknown): boolean;
/**
 * Make Groq Whisper the selected voice-input provider.
 *
 * @param ctx host context.
 * @returns the selection after the official service applied the change.
 */
export declare function selectGroqProvider(ctx: unknown): Promise<VoiceInputStatus>;
