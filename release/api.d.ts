/**
 * Browser JSON API for the Groq Speech settings section.
 *
 * Every request is fenced to loopback / trusted hosts and same-origin, and no
 * response contains key material: `status` reports only presence, source, and
 * writability from `ctx.credentials.describe()`. Key management is owned by
 * Settings → Models; this API has no action that can set or clear a key.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/**
 * A browser-facing failure with an HTTP status and stable code.
 * Messages here are fixed strings; callers never pass secrets in.
 */
export declare class ApiFailure extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export interface ApiResult {
    status: number;
    body: unknown;
}
export interface DispatchOptions {
    /** Environment used for the key fallback (tests). */
    env?: NodeJS.ProcessEnv;
}
export interface HandlerOptions {
    trustedHosts?: string[];
    env?: NodeJS.ProcessEnv;
}
/**
 * Execute one parsed API action.
 *
 * Returns an HTTP status plus the exact response envelope; throws
 * {@link ApiFailure} for a client-visible failure.
 *
 * @param ctx host context.
 * @param payload parsed request body carrying `action`.
 * @param options environment override.
 * @returns the response envelope.
 */
export declare function dispatchAction(ctx: unknown, payload: unknown, options?: DispatchOptions): Promise<ApiResult>;
/**
 * Handle one HTTP request against the browser API.
 *
 * @param ctx host context.
 * @param req incoming request.
 * @param res response.
 * @param options trusted hosts and environment override.
 */
export declare function handleApiRequest(ctx: unknown, req: IncomingMessage, res: ServerResponse, options?: HandlerOptions): Promise<void>;
/**
 * Build the `webServer` prefix handler.
 *
 * @param ctx host context.
 * @param options trusted hosts and environment override.
 * @returns a prefix-route handler.
 */
export declare function createApiHandler(ctx: unknown, options?: HandlerOptions): ApiHandler;
