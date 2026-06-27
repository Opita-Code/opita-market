/**
 * Webhook gateway — barrel export.
 */

export * from "./errors.js";
export * from "./types.js";
export { processWompiWebhook, verifyTimestamp } from "./gateway.js";
