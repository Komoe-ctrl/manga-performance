import { downloadResponse } from "@/server/client-space/download-route";

/** `GET /api/deliverables/:id/download`: admin, or the client the file belongs to. Logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return downloadResponse((service, viewer) => service.deliverableDownload(viewer, id));
}
