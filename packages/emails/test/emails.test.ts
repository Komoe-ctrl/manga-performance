import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrevoProvider,
  DevMailboxProvider,
  FALLBACK_CABINET,
  PermanentEmailError,
  createEmailProvider,
  emailJobSchema,
  fanoutJobSchema,
  parseAddress,
  renderEmail,
  type EmailJob,
} from "../src/index";

const url = "https://app.example.com/lien?token=abc";
const day = "2026-11-06T09:00:00Z";

const jobs: EmailJob[] = [
  { template: "invitation", to: "awa@lagune.ci", data: { name: "Awa Koné", url, expiresAt: day } },
  { template: "password-reset", to: "awa@lagune.ci", data: { name: "Awa Koné", url } },
  { template: "newsletter-confirmation", to: "awa@lagune.ci", data: { url } },
  { template: "new-deliverable", to: "awa@lagune.ci", data: { name: "Awa Koné", title: "Tableau de bord T3", url } },
  { template: "new-message", to: "awa@lagune.ci", data: { name: "Awa Koné", url } },
  { template: "payment-reminder", to: "awa@lagune.ci", data: { name: "Awa Koné", invoiceNumber: "2026-012", amountDue: 1_250_000, dueAt: day, url } },
  { template: "new-lead", to: "admin@example.com", data: { contactName: "Awa Koné", companyName: "Lagune Hôtel", sourceLabel: "le chatbot", returning: false, url } },
  {
    template: "daily-digest",
    to: "admin@example.com",
    data: {
      date: "2026-11-06",
      overdue: [{ company: "Baobab BTP", rule: "J+7", dueAt: "2026-11-01T09:00:00Z", url }],
      today: [{ company: "Lagune Hôtel", rule: "J+15", dueAt: day, url }],
      adminUrl: "https://app.example.com/admin/relances",
    },
  },
];

describe("templates", () => {
  it.each(jobs.map((job) => [job.template, job] as const))("%s renders HTML, text and a subject", async (_name, job) => {
    const email = await renderEmail(job, FALLBACK_CABINET);
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.html).toContain("<html");
    expect(email.html).toContain('lang="fr"');
    expect(email.text.length).toBeGreaterThan(20);
    // Charter and footer (spec, section 8).
    expect(email.html).toContain("#1a2b4a");
    expect(email.html).toContain("#f5b700");
    expect(email.text).toContain(FALLBACK_CABINET.phone);
    expect(email.text).toContain(FALLBACK_CABINET.email);
    expect(email.text).not.toMatch(/<[a-z][^>]*>/i); // no markup left in the plain text
  });

  it("includes the single-use link in both versions", async () => {
    const email = await renderEmail(jobs[0]!, FALLBACK_CABINET);
    expect(email.html).toContain(url);
    expect(email.text).toContain(url);
  });

  it("escapes user-provided values", async () => {
    const email = await renderEmail(
      { template: "new-deliverable", to: "a@b.ci", data: { name: "<script>alert(1)</script>", title: "<img src=x onerror=alert(1)>", url } },
      { ...FALLBACK_CABINET, name: "Cabinet <b>X</b>" },
    );
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain("<b>X</b>");
  });

  it("formats FCFA and dates in French, and never prints message content", async () => {
    const reminder = await renderEmail(jobs[5]!, FALLBACK_CABINET);
    expect(reminder.text).toContain("1 250 000 FCFA");
    expect(reminder.text).toContain("novembre 2026");
    const message = await renderEmail(jobs[4]!, FALLBACK_CABINET);
    expect(message.text).toContain("jamais envoyé par email");
  });

  it("words the new-lead email differently for a returning contact", async () => {
    const returning = await renderEmail(
      { template: "new-lead", to: "admin@example.com", data: { contactName: "Awa", companyName: "Lagune", sourceLabel: "le chatbot", returning: true, url } },
      FALLBACK_CABINET,
    );
    expect(returning.subject).toContain("Nouveau message de Awa");
    expect(returning.text).toContain("Une note a été ajoutée");
  });

  it("lists overdue and due-today follow-ups in the digest", async () => {
    const digest = await renderEmail(jobs[7]!, FALLBACK_CABINET);
    expect(digest.subject).toBe("Relances du jour : 1 à faire, 1 en retard");
    expect(digest.text).toContain("En retard (1)");
    expect(digest.text).toContain("Baobab BTP");
    expect(digest.text).toContain("vendredi 6 novembre 2026");
  });
});

describe("job schemas", () => {
  it("accepts every template's payload", () => {
    for (const job of jobs) expect(emailJobSchema.safeParse(job).success).toBe(true);
  });

  it("rejects unknown templates, bad addresses and non-http links", () => {
    expect(emailJobSchema.safeParse({ ...jobs[0], template: "spam" }).success).toBe(false);
    expect(emailJobSchema.safeParse({ ...jobs[0], to: "not-an-email" }).success).toBe(false);
    const evil = { template: "password-reset", to: "a@b.ci", data: { name: "A", url: "javascript:alert(1)" } };
    expect(emailJobSchema.safeParse(evil).success).toBe(false);
  });

  it("rejects data that belongs to another template", () => {
    expect(emailJobSchema.safeParse({ template: "invitation", to: "a@b.ci", data: { url } }).success).toBe(false);
  });

  it("validates fan-out jobs, with or without an email", () => {
    expect(fanoutJobSchema.safeParse({ type: "NEW_LEAD", audience: "ADMINS", payload: { prospectId: "p1" } }).success).toBe(true);
    expect(fanoutJobSchema.safeParse({ type: "NEW_LEAD", audience: { userId: "u1" }, payload: {}, email: jobs[6] }).success).toBe(true);
    expect(fanoutJobSchema.safeParse({ type: "", audience: "ADMINS", payload: {} }).success).toBe(false);
    expect(fanoutJobSchema.safeParse({ type: "X", audience: "EVERYONE", payload: {} }).success).toBe(false);
  });
});

describe("parseAddress", () => {
  it("handles named, quoted and bare addresses", () => {
    expect(parseAddress("Manga Performance <no-reply@example.com>")).toEqual({ name: "Manga Performance", email: "no-reply@example.com" });
    expect(parseAddress('"Manga, Performance" <a@b.ci>')).toEqual({ name: "Manga, Performance", email: "a@b.ci" });
    expect(parseAddress("<a@b.ci>")).toEqual({ email: "a@b.ci" });
    expect(parseAddress(" a@b.ci ")).toEqual({ email: "a@b.ci" });
  });
});

const message = {
  from: "Cabinet <no-reply@example.com>",
  to: "awa@lagune.ci",
  subject: "Sujet",
  html: "<p>Bonjour</p>",
  text: "Bonjour",
};

describe("BrevoProvider", () => {
  const reply = (status: number, body: unknown = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("posts the message with the API key and returns the provider message id", async () => {
    const fetchImpl = reply(201, { messageId: "<abc@brevo>" });
    const result = await new BrevoProvider("key-123", fetchImpl).send({ ...message, headers: { "List-Unsubscribe": "<https://x>" } });
    expect(result.messageId).toBe("<abc@brevo>");

    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("key-123");
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: "Cabinet", email: "no-reply@example.com" },
      to: [{ email: "awa@lagune.ci" }],
      subject: "Sujet",
      htmlContent: "<p>Bonjour</p>",
      textContent: "Bonjour",
      headers: { "List-Unsubscribe": "<https://x>" },
    });
  });

  it("treats 4xx as permanent and 429/5xx as retryable, without leaking the message", async () => {
    await expect(new BrevoProvider("k", reply(401)).send(message)).rejects.toBeInstanceOf(PermanentEmailError);
    await expect(new BrevoProvider("k", reply(400)).send(message)).rejects.toBeInstanceOf(PermanentEmailError);
    for (const status of [429, 500, 503]) {
      const error = await new BrevoProvider("k", reply(status)).send(message).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(PermanentEmailError);
      expect(error.message).toBe(`Brevo answered ${status}`);
      expect(error.message).not.toContain("lagune.ci");
    }
  });

  it("propagates network failures so the job is retried", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(new BrevoProvider("k", down).send(message)).rejects.toThrow("ECONNRESET");
  });
});

describe("DevMailboxProvider", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes an HTML and a text file per email", async () => {
    dir = await mkdtemp(join(tmpdir(), "mailbox-"));
    const provider = new DevMailboxProvider(join(dir, "nested"));
    const first = await provider.send(message);
    await provider.send({ ...message, subject: "Autre --> <script>" });

    const files = (await readdir(join(dir, "nested"))).sort();
    expect(files).toHaveLength(4);
    expect(first.messageId).toMatch(/^dev-mailbox:/);
    const html = await readFile(join(dir, "nested", files.find((f) => f.endsWith(".html"))!), "utf8");
    expect(html).toContain("To: awa@lagune.ci");
    expect(html).toContain("<p>Bonjour</p>");
    const second = await readFile(join(dir, "nested", files.filter((f) => f.endsWith(".html"))[1]!), "utf8");
    expect(second.split("\n")[0]).not.toMatch(/-->.*-->/); // a subject cannot close the header comment
  });
});

describe("createEmailProvider", () => {
  const options = { mailboxDirectory: "/tmp/mailbox" };

  it("uses the dev mailbox with the placeholder key outside production", () => {
    expect(createEmailProvider({ NODE_ENV: "development", EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "change-me" }, options).name).toBe("dev-mailbox");
    expect(createEmailProvider({ NODE_ENV: "test", EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "change-me" }, options).name).toBe("dev-mailbox");
  });

  it("uses Brevo with a real key, and always in production", () => {
    expect(createEmailProvider({ NODE_ENV: "development", EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "xkeysib-real" }, options).name).toBe("brevo");
    expect(createEmailProvider({ NODE_ENV: "production", EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "change-me" }, options).name).toBe("brevo");
  });

  it("does not pretend to support Resend yet", () => {
    expect(() => createEmailProvider({ NODE_ENV: "development", EMAIL_PROVIDER: "resend", BREVO_API_KEY: "k" }, options)).toThrow(/not implemented/);
  });
});
