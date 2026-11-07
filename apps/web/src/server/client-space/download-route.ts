import { connection } from "next/server";
import { DomainError } from "../domain-error";
import { authErrorResponse, requireAdminOrClient } from "../auth/guards";
import type { Viewer } from "./client-space-service";
import { getClientSpace } from "./instance";

/**
 * Shared by the two download routes: authorize, build a 5-minute presigned URL, and
 * redirect to it. The browser fetches the file straight from storage; the URL carries
 * `Content-Disposition: attachment`. Not found and not yours look exactly the same.
 */
export async function downloadResponse(
  resolve: (service: ReturnType<typeof getClientSpace>, viewer: Viewer) => Promise<{ url: string }>,
): Promise<Response> {
  await connection();
  try {
    const session = await requireAdminOrClient();
    const viewer: Viewer = { userId: session.userId, role: session.role, clientId: session.clientId };
    const { url } = await resolve(getClientSpace(), viewer);
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    if (error instanceof DomainError && error.code === "NOT_FOUND") {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    throw error;
  }
}
