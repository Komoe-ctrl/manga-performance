import pino, { type Logger } from "pino";
import { maskPii } from "./mask";

/** Fields that must never reach the logs (spec, section 5). */
export const REDACTED_PATHS = [
  "password",
  "newPassword",
  "token",
  "secret",
  "authorization",
  "cookie",
  "body",
  "content",
  "message",
  "*.password",
  "*.newPassword",
  "*.token",
  "*.secret",
  "*.authorization",
  "*.cookie",
  "*.body",
  "*.content",
  "*.message",
  "req.headers.authorization",
  "req.headers.cookie",
];

export interface LoggerOptions {
  service: string;
  level?: string;
}

/** JSON logger (pino) with secret redaction and email/phone masking. */
export function createLogger({ service, level }: LoggerOptions): Logger {
  return pino({
    level: level ?? process.env.LOG_LEVEL ?? "info",
    base: { service },
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    formatters: {
      log: (object) => maskPii(object),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
