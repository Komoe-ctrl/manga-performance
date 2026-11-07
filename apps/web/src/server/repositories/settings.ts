import { settingsSchema, type Settings } from "@manga/validation";
import type { PrismaClient } from "@manga/db";
import { contactInfo, DEFAULT_WHATSAPP_MESSAGE } from "@/lib/content/site";

const KEY = "cabinet";

/** Same defaults as the front mock, so switching `DATA_SOURCE` does not change the first load. */
export const DEFAULT_SETTINGS: Settings = {
  cabinetName: "MANGA PERFORMANCE",
  address: "Abidjan, Côte d'Ivoire",
  phone: contactInfo.phone,
  email: contactInfo.email,
  logoName: "",
  // TODO(client): follow-ups are internal reminders only. Does the client want automatic
  // emails to the prospect instead? (spec, section 14)
  followUps: { j7: true, j15: true, j30: false },
  vatPercent: 18,
  invoiceMentions: "",
  bankDetails: "[À fournir par le client]",
  whatsappNumber: contactInfo.whatsappNumber,
  whatsappMessage: DEFAULT_WHATSAPP_MESSAGE,
};

/** Cabinet settings: one JSON value, validated by zod on the way in and out. */
export function createSettingsRepository(prisma: PrismaClient) {
  return {
    async get(): Promise<Settings> {
      const row = await prisma.setting.findUnique({ where: { key: KEY } });
      const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(row?.value as object) });
      return parsed.success ? parsed.data : DEFAULT_SETTINGS;
    },

    async save(settings: Settings): Promise<Settings> {
      const value = settingsSchema.parse(settings);
      await prisma.setting.upsert({
        where: { key: KEY },
        create: { key: KEY, value },
        update: { value },
      });
      return value;
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
