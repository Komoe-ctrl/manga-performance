import { downloadResponse } from "@/server/client-space/download-route";

/** `GET /api/messages/:id/attachment`: admin, or the client the thread belongs to. Logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return downloadResponse((service, viewer) => service.attachmentDownload(viewer, id));
}
