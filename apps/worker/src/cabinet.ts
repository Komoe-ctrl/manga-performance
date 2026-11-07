import type { PrismaClient } from "@manga/db";
import { FALLBACK_CABINET, type Cabinet } from "@manga/emails";

/** Firm details for the email footer, from the settings (falls back to defaults). */
export async function loadCabinet(prisma: PrismaClient): Promise<Cabinet> {
  const row = await prisma.setting.findUnique({ where: { key: "cabinet" } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const pick = (key: string, fallback: string) =>
    typeof value[key] === "string" && value[key] ? (value[key] as string) : fallback;
  return {
    name: pick("cabinetName", FALLBACK_CABINET.name),
    address: pick("address", FALLBACK_CABINET.address),
    phone: pick("phone", FALLBACK_CABINET.phone),
    email: pick("email", FALLBACK_CABINET.email),
  };
}
