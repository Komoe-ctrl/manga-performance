import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as downloadDeliverable } from "@/app/api/deliverables/[id]/download/route";
import { GET as exportRoute } from "@/app/api/collection/export/route";
import { GET as downloadAttachment } from "@/app/api/messages/[id]/attachment/route";
import { GET as templateRoute } from "@/app/api/collection/template/[periodId]/route";
import * as collection from "@/server/actions/collection";
import * as space from "@/server/actions/client-space";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";
import { FILES, MemoryStorage } from "./memory-storage";

/*
 * Recette A1 (db): a user of client A gets nothing of client B, through the screens' Server Actions and through the
 * download routes. Every request is made with A's session and B's identifiers, which is what an attacker would do.
 */

const shared = vi.hoisted(() => ({ storage: undefined as unknown }));

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/queue", () => ({
  getEnqueuer: async () => ({ enqueueEmail: async () => undefined, enqueueFanout: async () => undefined, enqueueParseSubmission: async () => undefined, enqueueHotelCompute: async () => undefined }),
}));
vi.mock("@/server/storage/object-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage/object-storage")>()),
  getStorage: () => shared.storage,
}));

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const call = (route: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>, id: string) => route(new Request(`https://app.example.com/api/x/${id}`), { params: Promise.resolve({ id }) });
const callTemplate = (periodId: string) => templateRoute(new Request(`https://app.example.com/api/collection/template/${periodId}`), { params: Promise.resolve({ periodId }) });

interface Tenant {
  clientId: string;
  prospectId: string;
  name: string;
  entityId: string;
  entityName: string;
  planId: string;
  periodId: string;
  submissionId: string;
  deliverableId: string;
  messageId: string;
  userEmails: Record<"direction" | "contributor" | "analyst", string>;
}

async function tenant(label: string): Promise<Tenant> {
  const company = await createClientCompany(`Société ${label}`);
  const prospectId = (await db().client.findUniqueOrThrow({ where: { id: company.id } })).prospectId;
  const entityName = `Hôtel ${label}`;
  const entity = await db().entity.create({ data: { clientId: company.id, name: entityName, sector: "HOTELLERIE" } });
  const plan = await db().collectionPlan.create({ data: { entityId: entity.id, templateId: "hotel_mensuel", startsOn: day(2026, 1, 1) } });
  const period = await db().collectionPeriod.create({ data: { planId: plan.id, periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31), dueAt: day(2026, 11, 3), status: "VALIDE" } });

  const submissionKey = `clients/${company.id}/depot-${label}.xlsx`;
  (shared.storage as MemoryStorage).put(submissionKey, FILES.xlsx);
  const submission = await db().submission.create({ data: { periodId: period.id, version: 1, templateId: "hotel_mensuel", templateVersion: 1, storageKey: submissionKey, originalName: `depot-${label}.xlsx`, sizeBytes: 10, checksum: "x", uploadedBy: "u", status: "VALIDE" } });
  await db().hotelKpiResult.create({ data: { periodId: period.id, submissionId: submission.id, version: 1, kpis: { chambresDisponibles: 1000, gop: 5, revpar: 1, trevpar: 1, goppar: 1, gopMarginPct: 40, tauxOccupationPct: 70, adr: 1, poidsOtaPct: null }, alerts: [], paramsSnapshot: { input: { nombreChambres: 40 } }, validatedAt: day(2026, 11, 5) } });

  const direction = await createUser({ role: "CLIENT_DIRECTION", clientId: company.id });
  const contributor = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: company.id });
  const analyst = await createUser({ role: "CLIENT_ANALYSTE", clientId: company.id });
  await db().entityAssignment.create({ data: { userId: contributor.id, entityId: entity.id } });

  const deliverableKey = `clients/${company.id}/livrable-${label}.pdf`;
  (shared.storage as MemoryStorage).put(deliverableKey, FILES.pdf);
  const deliverable = await db().deliverable.create({ data: { clientId: company.id, title: `Livrable ${label}`, storageKey: deliverableKey, mimeType: "application/pdf", sizeBytes: 10, checksum: "x", publishedBy: direction.id } });
  const attachmentKey = `clients/${company.id}/pj-${label}.pdf`;
  (shared.storage as MemoryStorage).put(attachmentKey, FILES.pdf);
  const message = await db().message.create({ data: { clientId: company.id, authorId: direction.id, fromRole: "CLIENT_DIRECTION", body: `Message ${label}`, attachmentKey, attachmentName: `pj-${label}.pdf`, attachmentMime: "application/pdf", attachmentSize: 10 } });
  await db().notification.create({ data: { userId: direction.id, type: "NEW_DELIVERABLE", payload: { deliverableId: deliverable.id, title: `Livrable ${label}` } } });

  return {
    clientId: company.id,
    prospectId,
    name: `Société ${label}`,
    entityId: entity.id,
    entityName,
    planId: plan.id,
    periodId: period.id,
    submissionId: submission.id,
    deliverableId: deliverable.id,
    messageId: message.id,
    userEmails: { direction: direction.email, contributor: contributor.email, analyst: analyst.email },
  };
}

let a: Tenant;
let b: Tenant;

const asUser = async (email: string) => actAs((await login(email)).cookie);
const leaks = (value: unknown) => {
  const text = JSON.stringify(value);
  return [b.name, b.entityName, b.entityId, b.clientId, b.prospectId, b.periodId, b.submissionId, b.deliverableId, b.messageId, `Livrable B`, `Message B`].filter((marker) => text.includes(marker));
};

beforeEach(async () => {
  await resetDatabase();
  shared.storage = new MemoryStorage();
  actAs(null);
  a = await tenant("A");
  b = await tenant("B");
});
afterAll(shutdown);

const ROLES = ["direction", "contributor", "analyst"] as const;

describe.each(ROLES)("as the %s of client A, with client B's identifiers", (role) => {
  const login = () => asUser(a.userEmails[role]);

  it("the collection overview, period detail and file downloads reveal nothing of B", async () => {
    await login();
    const overview = await collection.getCollectionOverviewAction();
    expect(overview.ok).toBe(true);
    expect(leaks(overview), "overview leaks B").toEqual([]);
    if (overview.ok) expect(overview.data.rows.every((r) => r.entity.id === a.entityId)).toBe(true);

    // By direct identifier: answered exactly as an object that does not exist.
    for (const result of [await collection.getPeriodDetailAction(b.periodId), await collection.downloadSubmissionAction(b.submissionId)]) {
      expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(leaks(result)).toEqual([]);
    }
    expect(await collection.getPeriodDetailAction("n-existe-pas")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("deposits, the Excel template and the exports cannot target B", async () => {
    await login();
    expect(await collection.requestDepositUploadAction({ periodId: b.periodId, filename: "depot.xlsx", sizeBytes: 10 })).toMatchObject({ ok: false });
    expect(await collection.confirmDepositAction({ periodId: b.periodId, key: `clients/${b.clientId}/depot-B.xlsx`, originalName: "depot.xlsx" })).toMatchObject({ ok: false });
    expect((await callTemplate(b.periodId)).status).toBe(404);

    // Filters only narrow the session's scope: asking for B's client or entity never widens it. Whatever the answer
    // (a refusal, or an export of A's own scope, empty here), nothing of B is in it.
    for (const query of [`clientId=${b.clientId}`, `entityId=${b.entityId}`, `clientId=${b.clientId}&entityId=${b.entityId}`]) {
      for (const format of ["", "&format=zip"]) {
        const response = await exportRoute(new Request(`https://app.example.com/api/collection/export?templateId=hotel_mensuel&from=2026-10&to=2026-10&${query}${format}`));
        const bytes = Buffer.from(await response.arrayBuffer());
        if (response.status !== 200) continue;
        if (format) expect(bytes.toString("latin1"), `zip ${query} lists B's file`).not.toContain("depot-B");
        else {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
          const cells: string[] = [];
          workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value)))));
          expect(leaks(cells), `export ${query} leaks B`).toEqual([]);
        }
      }
    }
    // And an export of A's own scope does contain A's entity, so the check above is not vacuous.
    const own = await exportRoute(new Request(`https://app.example.com/api/collection/export?templateId=hotel_mensuel&from=2026-10&to=2026-10&entityId=${a.entityId}&format=zip`));
    if (role === "contributor") expect(own.status).toBe(403); // contributors deposit; they do not export
    else {
      expect(own.status).toBe(200);
      expect(Buffer.from(await own.arrayBuffer()).toString("latin1")).toContain("depot-A");
    }
  });

  it("the pilot, deliverables, messages and notifications are the signed-in client's own", async () => {
    await login();
    // The client id of the request is ignored: the session decides.
    const pilot = await collection.getPilotResultsAction({ clientId: b.clientId });
    if (role === "contributor") expect(pilot).toMatchObject({ ok: false, code: "FORBIDDEN" });
    else {
      expect(pilot.ok).toBe(true);
      expect(leaks(pilot), "pilot leaks B").toEqual([]);
      if (pilot.ok) {
        expect(pilot.data.hotels.map((h) => h.id)).toEqual([a.entityId]);
        expect(pilot.data.clientId).toBe(a.clientId);
      }
    }

    for (const result of [await space.listMyDeliverablesAction(), await space.listMyMessagesAction(), await space.listMyNotificationsAction({}), await space.listMyUnreadNotificationsAction(), await space.getMyCompanyAction()]) {
      expect(result.ok).toBe(true);
      expect(leaks(result), "client space leaks B").toEqual([]);
    }
    // Marking B's deliverable as seen is a silent no-op: nothing of B changes.
    await space.markDeliverableSeenAction(b.deliverableId);
    expect(await db().notification.count({ where: { readAt: { not: null } } })).toBe(0);
    expect((await call(downloadDeliverable, b.deliverableId)).status).toBe(404);
    expect((await call(downloadAttachment, b.messageId)).status).toBe(404);
  });

  it("the back-office actions are closed to a client", async () => {
    await login();
    for (const result of [
      await space.listClientDeliverablesAction(b.prospectId),
      await space.listClientMessagesAction(b.prospectId),
      await collection.listCollectionEntitiesAction(),
      await collection.listCollectionPeopleAction(),
      await collection.validatePilotPeriodAction({ periodId: b.periodId }),
      await collection.getCpraResultsAction({ periodId: b.periodId }),
    ]) {
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(leaks(result)).toEqual([]);
    }
  });
});

describe("a client can still reach its own data (the guard is not a blanket refusal)", () => {
  it("lets A read its own period, deliverable and files", async () => {
    await asUser(a.userEmails.direction);
    expect(await collection.getPeriodDetailAction(a.periodId)).toMatchObject({ ok: true });
    expect(await collection.downloadSubmissionAction(a.submissionId)).toMatchObject({ ok: true });
    expect((await call(downloadDeliverable, a.deliverableId)).status).toBe(302);
    expect((await call(downloadAttachment, a.messageId)).status).toBe(302);
    const pilot = await collection.getPilotResultsAction({});
    expect(pilot.ok && pilot.data.results.map((r) => r.hotelId)).toEqual([a.entityId]);
  });

  it("keeps the contributor on the entity they are assigned to", async () => {
    const second = await db().entity.create({ data: { clientId: a.clientId, name: "Hôtel A2 (non affecté)", sector: "HOTELLERIE" } });
    const plan = await db().collectionPlan.create({ data: { entityId: second.id, templateId: "hotel_mensuel", startsOn: day(2026, 1, 1) } });
    const period = await db().collectionPeriod.create({ data: { planId: plan.id, periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31), dueAt: day(2026, 11, 3), status: "ATTENDU" } });
    await asUser(a.userEmails.contributor);
    const overview = await collection.getCollectionOverviewAction();
    expect(overview.ok && overview.data.rows.map((r) => r.entity.id)).toEqual([a.entityId]);
    expect(await collection.getPeriodDetailAction(period.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await callTemplate(period.id)).status).toBe(404);
    // The direction of the same client does see it.
    await asUser(a.userEmails.direction);
    expect(await collection.getPeriodDetailAction(period.id)).toMatchObject({ ok: true });
  });
});
