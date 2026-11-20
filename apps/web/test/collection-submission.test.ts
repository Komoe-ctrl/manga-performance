import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_SUBMISSION_BYTES, createSubmissionService } from "@/server/collection/submission-service";
import type { CollectionActor } from "@/server/collection/scope";
import { createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";
import { FILES, MemoryStorage } from "./memory-storage";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

class FakeQueue {
  jobs: { submissionId: string; dedupeKey?: string }[] = [];
  fail = false;
  compute: { periodId: string; dedupeKey?: string }[] = [];
  async enqueueHotelCompute(job: { periodId: string }, options?: { dedupeKey?: string }) {
    if (this.fail) throw new Error("boss down");
    this.compute.push({ ...job, dedupeKey: options?.dedupeKey });
  }
  async enqueueParseSubmission(job: { submissionId: string }, options?: { dedupeKey?: string }) {
    if (this.fail) throw new Error("boss down");
    this.jobs.push({ ...job, dedupeKey: options?.dedupeKey });
  }
}

const actorOf = (u: { id: string; role: CollectionActor["role"]; clientId: string | null }): CollectionActor => ({ userId: u.id, role: u.role, clientId: u.clientId });

async function seed() {
  const clientA = await createClientCompany("Groupe A");
  const clientB = await createClientCompany("Groupe B");
  const a1 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A1", sector: "HOTELLERIE" } });
  const a2 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A2", sector: "HOTELLERIE" } });
  const b1 = await db().entity.create({ data: { clientId: clientB.id, name: "Hôtel B1", sector: "HOTELLERIE" } });
  const period = async (entityId: string, status: "A_VENIR" | "ATTENDU" | "EN_RETARD" | "EN_CONTROLE" | "REJETE" | "VALIDE" | "ACCEPTE_AVEC_RESERVE" = "ATTENDU", templateId = "hotel_mensuel") => {
    const plan = await db().collectionPlan.create({ data: { entityId, templateId, startsOn: day(2026, 1, 1) } });
    return db().collectionPeriod.create({ data: { planId: plan.id, periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31), dueAt: day(2026, 11, 3), status } });
  };
  return {
    clientA,
    p1: await period(a1.id),
    p2: await period(a2.id),
    pb: await period(b1.id),
    direction: await createUser({ role: "CLIENT_DIRECTION", clientId: clientA.id }),
    contributor: await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: clientA.id }),
    analyst: await createUser({ role: "CLIENT_ANALYSTE", clientId: clientA.id }),
    admin: await createUser({ role: "ADMIN" }),
    a1,
    period,
  };
}

let storage: MemoryStorage;
let queue: FakeQueue;
const service = () => createSubmissionService({ prisma: db(), storage, queue, now: () => day(2026, 11, 5) });

/** Plays the browser: requests the ticket, "uploads" the file, returns the key. */
async function upload(actor: CollectionActor, periodId: string, filename = "depot.xlsx", content: string = FILES.xlsx) {
  const ticket = await service().requestUpload(actor, periodId, { filename, sizeBytes: content.length });
  storage.put(ticket.key, content);
  return ticket;
}

beforeEach(async () => {
  await resetDatabase();
  storage = new MemoryStorage();
  queue = new FakeQueue();
});
afterAll(shutdown);

describe("requestUpload", () => {
  it("returns a presigned URL bound to xlsx and to the exact size, under the client's prefix", async () => {
    const s = await seed();
    const ticket = await service().requestUpload(actorOf(s.direction), s.p1.id, { filename: "Octobre.xlsx", sizeBytes: 5000 });
    expect(ticket.key).toMatch(new RegExp(`^clients/${s.clientA.id}/.+\\.xlsx$`));
    expect(storage.uploads[0]).toMatchObject({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contentLength: 5000 });
  });

  it("refuses .xlsm and .xls with a clear message, and any other type", async () => {
    const s = await seed();
    const ask = (filename: string) => service().requestUpload(actorOf(s.direction), s.p1.id, { filename, sizeBytes: 100 });
    await expect(ask("macro.xlsm")).rejects.toMatchObject({ code: "MACRO_NOT_ALLOWED", message: expect.stringContaining("macros") });
    await expect(ask("ancien.xls")).rejects.toMatchObject({ code: "OLD_FORMAT" });
    await expect(ask("rapport.pdf")).rejects.toMatchObject({ code: "TYPE_NOT_ALLOWED" });
    await expect(ask("sans-extension")).rejects.toMatchObject({ code: "TYPE_NOT_ALLOWED" });
  });

  it("refuses an empty file and one above 10 MB", async () => {
    const s = await seed();
    const size = (sizeBytes: number) => service().requestUpload(actorOf(s.direction), s.p1.id, { filename: "a.xlsx", sizeBytes });
    await expect(size(0)).rejects.toMatchObject({ code: "EMPTY" });
    await expect(size(MAX_SUBMISSION_BYTES + 1)).rejects.toMatchObject({ code: "TOO_LARGE", message: expect.stringContaining("10 Mo") });
    await expect(size(MAX_SUBMISSION_BYTES)).resolves.toBeTruthy();
  });

  it("applies the entity scope: another client's period and a missing one answer the same", async () => {
    const s = await seed();
    for (const id of [s.pb.id, "does-not-exist"]) {
      await expect(service().requestUpload(actorOf(s.direction), id, { filename: "a.xlsx", sizeBytes: 100 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("keeps a contributor to their assigned entity, and refuses the analyst", async () => {
    const s = await seed();
    await db().entityAssignment.create({ data: { userId: s.contributor.id, entityId: s.a1.id } });
    await expect(service().requestUpload(actorOf(s.contributor), s.p1.id, { filename: "a.xlsx", sizeBytes: 100 })).resolves.toBeTruthy();
    await expect(service().requestUpload(actorOf(s.contributor), s.p2.id, { filename: "a.xlsx", sizeBytes: 100 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service().requestUpload(actorOf(s.analyst), s.p1.id, { filename: "a.xlsx", sizeBytes: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the admin deposit on behalf of a client, under that client's prefix", async () => {
    const s = await seed();
    const ticket = await service().requestUpload(actorOf(s.admin), s.p1.id, { filename: "a.xlsx", sizeBytes: 100 });
    expect(ticket.key.startsWith(`clients/${s.clientA.id}/`)).toBe(true);
  });

  it("only opens deposits on expected, late or rejected periods", async () => {
    const s = await seed();
    const messages: Record<string, RegExp> = { A_VENIR: /pas encore ouverte/, EN_CONTROLE: /déjà en cours/, VALIDE: /déjà validée/, ACCEPTE_AVEC_RESERVE: /déjà acceptée/ };
    let n = 0;
    const fresh = async () => (await db().entity.create({ data: { clientId: s.clientA.id, name: `Entité ${(n += 1)}`, sector: "HOTELLERIE" } })).id;
    for (const [status, message] of Object.entries(messages)) {
      const p = await s.period(await fresh(), status as "A_VENIR", "resto_mensuel");
      await expect(service().requestUpload(actorOf(s.direction), p.id, { filename: "a.xlsx", sizeBytes: 100 })).rejects.toMatchObject({ code: "PERIOD_CLOSED", message: expect.stringMatching(message) });
    }
    for (const status of ["ATTENDU", "EN_RETARD", "REJETE"] as const) {
      const p = await s.period(await fresh(), status, "btp_chantiers");
      await expect(service().requestUpload(actorOf(s.direction), p.id, { filename: "a.xlsx", sizeBytes: 100 })).resolves.toBeTruthy();
    }
  });

  it("refuses a period whose template is unknown", async () => {
    const s = await seed();
    const p = await s.period(s.a1.id, "ATTENDU", "inconnu");
    await expect(service().requestUpload(actorOf(s.direction), p.id, { filename: "a.xlsx", sizeBytes: 100 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("confirmUpload", () => {
  it("creates version 1, moves the period to EN_CONTROLE, queues the check once, and audits", async () => {
    const s = await seed();
    const ticket = await upload(actorOf(s.direction), s.p1.id, "Octobre 2026.xlsx");
    const result = await service().confirmUpload(actorOf(s.direction), s.p1.id, { key: ticket.key, originalName: "Octobre 2026.xlsx" });
    expect(result.version).toBe(1);

    const submission = await db().submission.findUniqueOrThrow({ where: { id: result.submissionId } });
    expect(submission).toMatchObject({ version: 1, status: "EN_CONTROLE", templateId: "hotel_mensuel", templateVersion: 1, uploadedBy: s.direction.id, originalName: "Octobre 2026.xlsx", storageKey: ticket.key });
    expect(submission.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect((await db().collectionPeriod.findUniqueOrThrow({ where: { id: s.p1.id } })).status).toBe("EN_CONTROLE");
    expect(queue.jobs).toEqual([{ submissionId: result.submissionId, dedupeKey: result.submissionId }]);
    expect(await db().auditLog.count({ where: { action: "submission.upload", entityId: result.submissionId, actorId: s.direction.id } })).toBe(1);
  });

  it("keeps every version: a rejected period takes a version 2 on the next deposit", async () => {
    const s = await seed();
    const first = await upload(actorOf(s.direction), s.p1.id);
    const v1 = await service().confirmUpload(actorOf(s.direction), s.p1.id, { key: first.key, originalName: "v1.xlsx" });
    await db().submission.update({ where: { id: v1.submissionId }, data: { status: "REJETE" } });
    await db().collectionPeriod.update({ where: { id: s.p1.id }, data: { status: "REJETE" } });

    const second = await upload(actorOf(s.direction), s.p1.id);
    const v2 = await service().confirmUpload(actorOf(s.direction), s.p1.id, { key: second.key, originalName: "v2.xlsx" });
    expect(v2.version).toBe(2);
    expect(await db().submission.count({ where: { periodId: s.p1.id } })).toBe(2);
    expect((await db().submission.findUniqueOrThrow({ where: { id: v1.submissionId } })).status).toBe("REJETE");
  });

  it("refuses a second deposit while the first is being checked", async () => {
    const s = await seed();
    const first = await upload(actorOf(s.direction), s.p1.id);
    await service().confirmUpload(actorOf(s.direction), s.p1.id, { key: first.key, originalName: "a.xlsx" });
    await expect(service().requestUpload(actorOf(s.direction), s.p1.id, { filename: "b.xlsx", sizeBytes: 100 })).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    // Even with a ticket obtained earlier.
    const second = await upload(actorOf(s.admin), s.p2.id);
    await expect(service().confirmUpload(actorOf(s.direction), s.p1.id, { key: second.key, originalName: "b.xlsx" })).rejects.toBeTruthy();
  });

  it("lets only one of two concurrent confirmations through", async () => {
    const s = await seed();
    const a = await upload(actorOf(s.direction), s.p1.id);
    const b = await upload(actorOf(s.direction), s.p1.id);
    const results = await Promise.allSettled([
      service().confirmUpload(actorOf(s.direction), s.p1.id, { key: a.key, originalName: "a.xlsx" }),
      service().confirmUpload(actorOf(s.direction), s.p1.id, { key: b.key, originalName: "b.xlsx" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().submission.count({ where: { periodId: s.p1.id } })).toBe(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it("reads the object back: a missing file, a file that is not an Excel file, and a key of another client are refused", async () => {
    const s = await seed();
    const ticket = await service().requestUpload(actorOf(s.direction), s.p1.id, { filename: "a.xlsx", sizeBytes: 100 });
    await expect(service().confirmUpload(actorOf(s.direction), s.p1.id, { key: ticket.key, originalName: "a.xlsx" })).rejects.toMatchObject({ code: "FILE_MISSING" });

    storage.put(ticket.key, FILES.exe);
    await expect(service().confirmUpload(actorOf(s.direction), s.p1.id, { key: ticket.key, originalName: "a.xlsx" })).rejects.toMatchObject({ code: "INVALID_CONTENT" });
    expect(storage.deleted).toContain(ticket.key);

    storage.put("clients/someone-else/x.xlsx", FILES.xlsx);
    await expect(service().confirmUpload(actorOf(s.direction), s.p1.id, { key: "clients/someone-else/x.xlsx", originalName: "a.xlsx" })).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(await db().submission.count()).toBe(0);
    expect((await db().collectionPeriod.findUniqueOrThrow({ where: { id: s.p1.id } })).status).toBe("ATTENDU");
  });

  it("refuses a Word file renamed .xlsx, and an object above 10 MB", async () => {
    const s = await seed();
    const word = await service().requestUpload(actorOf(s.direction), s.p1.id, { filename: "a.xlsx", sizeBytes: FILES.docx.length });
    storage.put(word.key, FILES.docx);
    await expect(service().confirmUpload(actorOf(s.direction), s.p1.id, { key: word.key, originalName: "a.xlsx" })).rejects.toMatchObject({ code: "INVALID_CONTENT" });

    const big = await service().requestUpload(actorOf(s.direction), s.p1.id, { filename: "a.xlsx", sizeBytes: 100 });
    storage.put(big.key, new Uint8Array(MAX_SUBMISSION_BYTES + 1).fill(0));
    storage.objects.get(big.key)!.set(Buffer.from(FILES.xlsx, "latin1"));
    await expect(service().confirmUpload(actorOf(s.direction), s.p1.id, { key: big.key, originalName: "a.xlsx" })).rejects.toBeTruthy();
    expect(storage.deleted).toContain(big.key);
  });

  it("refuses the analyst, another client's period and a .xlsm name", async () => {
    const s = await seed();
    const ticket = await upload(actorOf(s.direction), s.p1.id);
    await expect(service().confirmUpload(actorOf(s.analyst), s.p1.id, { key: ticket.key, originalName: "a.xlsx" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service().confirmUpload(actorOf(s.direction), s.pb.id, { key: ticket.key, originalName: "a.xlsx" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service().confirmUpload(actorOf(s.direction), s.p1.id, { key: ticket.key, originalName: "a.xlsm" })).rejects.toMatchObject({ code: "MACRO_NOT_ALLOWED" });
  });

  it("sanitises the stored original name", async () => {
    const s = await seed();
    const ticket = await upload(actorOf(s.direction), s.p1.id);
    const r = await service().confirmUpload(actorOf(s.direction), s.p1.id, { key: ticket.key, originalName: "..\\..\\etc\\Octobre;2026.xlsx" });
    expect((await db().submission.findUniqueOrThrow({ where: { id: r.submissionId } })).originalName).toBe("Octobre2026.xlsx");
  });

  it("gives the period back when the check cannot be queued", async () => {
    const s = await seed();
    const ticket = await upload(actorOf(s.direction), s.p1.id);
    queue.fail = true;
    await expect(service().confirmUpload(actorOf(s.direction), s.p1.id, { key: ticket.key, originalName: "a.xlsx" })).rejects.toMatchObject({ code: "QUEUE_UNAVAILABLE" });
    expect((await db().collectionPeriod.findUniqueOrThrow({ where: { id: s.p1.id } })).status).toBe("ATTENDU");
    expect((await db().submission.findFirstOrThrow({ where: { periodId: s.p1.id } })).status).toBe("ERREUR_TECHNIQUE");
  });
});

describe("forceAccept (admin)", () => {
  async function rejected() {
    const s = await seed();
    const ticket = await upload(actorOf(s.direction), s.p1.id);
    const { submissionId } = await service().confirmUpload(actorOf(s.direction), s.p1.id, { key: ticket.key, originalName: "a.xlsx" });
    await db().submission.update({ where: { id: submissionId }, data: { status: "REJETE", report: { errors: [{ code: "X" }] } } });
    await db().collectionPeriod.update({ where: { id: s.p1.id }, data: { status: "REJETE" } });
    return { s, submissionId };
  }

  it("accepts with reserve, records the comment and the reviewer, and audits", async () => {
    const { s, submissionId } = await rejected();
    await service().forceAccept(s.admin.id, s.p1.id, "  Écart justifié par la direction  ");
    expect(await db().submission.findUniqueOrThrow({ where: { id: submissionId } })).toMatchObject({ status: "ACCEPTE_AVEC_RESERVE", reviewComment: "Écart justifié par la direction", reviewedBy: s.admin.id });
    expect((await db().collectionPeriod.findUniqueOrThrow({ where: { id: s.p1.id } })).status).toBe("ACCEPTE_AVEC_RESERVE");
    const audit = await db().auditLog.findFirstOrThrow({ where: { action: "submission.force", entityId: submissionId } });
    expect(audit.actorId).toBe(s.admin.id);
    expect(JSON.stringify(audit.diff)).toContain("Écart justifié");
  });

  it("requires a real comment", async () => {
    const { s } = await rejected();
    for (const comment of ["", "   ", "ok"]) {
      await expect(service().forceAccept(s.admin.id, s.p1.id, comment)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect((await db().collectionPeriod.findUniqueOrThrow({ where: { id: s.p1.id } })).status).toBe("REJETE");
  });

  it("only works on a rejected period, once", async () => {
    const { s } = await rejected();
    await service().forceAccept(s.admin.id, s.p1.id, "Accepté par le consultant");
    await expect(service().forceAccept(s.admin.id, s.p1.id, "Accepté par le consultant")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service().forceAccept(s.admin.id, s.p2.id, "Accepté par le consultant")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service().forceAccept(s.admin.id, "nope", "Accepté par le consultant")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses when the latest deposit is not the rejected one", async () => {
    const s = await seed();
    const p = await s.period(s.a1.id, "REJETE", "resto_mensuel");
    await expect(service().forceAccept(s.admin.id, p.id, "Pas de dépôt du tout")).rejects.toMatchObject({ code: "CONFLICT" });
    await db().submission.create({ data: { periodId: p.id, version: 1, templateId: "resto_mensuel", templateVersion: 1, storageKey: "k1", originalName: "a.xlsx", sizeBytes: 1, checksum: "x", uploadedBy: "u", status: "EN_CONTROLE" } });
    await expect(service().forceAccept(s.admin.id, p.id, "Dépôt encore en cours")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
