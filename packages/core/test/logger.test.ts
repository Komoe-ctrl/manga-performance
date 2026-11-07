import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTED_PATHS } from "../src/logger";
import { maskPii } from "../src/mask";

describe("createLogger", () => {
  it("creates a logger tagged with the service name and level", () => {
    const logger = createLogger({ service: "web", level: "debug" });
    expect(logger.level).toBe("debug");
    expect(logger.bindings()).toEqual({ service: "web" });
  });

  it("falls back to LOG_LEVEL then to info", () => {
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    expect(createLogger({ service: "x" }).level).toBe("warn");
    delete process.env.LOG_LEVEL;
    expect(createLogger({ service: "x" }).level).toBe("info");
    if (previous !== undefined) process.env.LOG_LEVEL = previous;
  });

  it("never emits secrets and masks personal data", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    // Same configuration as createLogger, but writing to an in-memory sink.
    const logger = pino(
      {
        redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
        formatters: { log: (o) => maskPii(o) },
      },
      sink,
    );
    logger.info({
      password: "hunter2",
      user: { token: "tok_123", email: "jean@acme.ci", phone: "+2250102030405" },
      message: "secret client message",
    });
    const out = lines.join("");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("tok_123");
    expect(out).not.toContain("secret client message");
    expect(out).not.toContain("jean@acme.ci");
    expect(out).toContain("j***@acme.ci");
    expect(out).toContain("+225***0405");
  });
});
