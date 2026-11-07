import type { PrismaClient } from "@manga/db";
import { ClientSpaceError } from "./client-space-service";

/** The front speaks prospect ids; the database speaks `Client.id`. */
export async function clientIdOfProspect(prisma: PrismaClient, prospectId: string): Promise<string> {
  const client = await prisma.client.findFirst({ where: { prospectId, deletedAt: null }, select: { id: true } });
  if (!client) throw new ClientSpaceError("CLIENT_NOT_FOUND", "Ce prospect n'est pas encore client.");
  return client.id;
}
