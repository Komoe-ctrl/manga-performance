import { render } from "@react-email/render";
import type { EmailJob } from "./jobs";
import type { Cabinet } from "./layout";
import { buildEmail } from "./templates";

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Plain-text alternative, always produced (spec, section 8). */
  text: string;
}

export async function renderEmail(job: EmailJob, cabinet: Cabinet): Promise<RenderedEmail> {
  const { subject, element } = buildEmail(job, cabinet);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
