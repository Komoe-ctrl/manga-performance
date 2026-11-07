import { generateHTML } from "@tiptap/html/server";
import StarterKit from "@tiptap/starter-kit";
import sanitizeHtml from "sanitize-html";

/** Rich text (blog articles, email bodies): TipTap JSON is the source of truth (spec, 6.8). */
export class RichTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RichTextError";
  }
}

const MAX_JSON_BYTES = 500_000;

const ALLOWED_TAGS = [
  "p", "br", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "code", "pre",
  "blockquote", "ul", "ol", "li", "a", "hr",
];

export interface SanitizeOptions {
  /** Rewrites every http(s) link (used to add click tracking to emails). */
  rewriteLink?: (href: string) => string;
}

/**
 * Strict allowlist: no scripts, styles, iframes, forms, images, event handlers, and only
 * http(s), mailto and tel links. Run on everything that is rendered with
 * `dangerouslySetInnerHTML` or put in an email.
 */
export function sanitizeRichHtml(html: string, options: SanitizeOptions = {}): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        const isWeb = /^https?:\/\//i.test(href);
        return {
          tagName,
          attribs: {
            ...(href ? { href: isWeb && options.rewriteLink ? options.rewriteLink(href) : href } : {}),
            ...(isWeb ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {}),
          },
        };
      },
    },
  });
}

export interface TiptapNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: TiptapNode[];
}

export function isTiptapDoc(value: unknown): value is TiptapNode & { type: "doc" } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "doc";
}

/** TipTap JSON -> sanitized HTML. Unknown nodes or marks are refused, not silently dropped. */
export function tiptapToHtml(doc: unknown, options: SanitizeOptions = {}): string {
  if (!isTiptapDoc(doc)) throw new RichTextError("Contenu invalide.");
  if (JSON.stringify(doc).length > MAX_JSON_BYTES) throw new RichTextError("Contenu trop volumineux.");
  let html: string;
  try {
    html = generateHTML(doc as Parameters<typeof generateHTML>[0], [StarterKit]);
  } catch {
    throw new RichTextError("Contenu invalide.");
  }
  return sanitizeRichHtml(html, options);
}

/** Plain text (paragraphs separated by a blank line) as a minimal TipTap document. */
export function textToTiptap(text: string): TiptapNode {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((paragraph) => {
      const lines = paragraph.split("\n");
      const content: TiptapNode[] = [];
      lines.forEach((line, index) => {
        if (index > 0) content.push({ type: "hardBreak" });
        if (line) content.push({ type: "text", text: line });
      });
      return { type: "paragraph", content };
    }),
  };
}

/** Every text of a document, one paragraph per block (for plain-text previews and checks). */
export function tiptapToText(node: unknown): string {
  const visit = (current: TiptapNode): string => {
    if (current.type === "text") return current.text ?? "";
    if (current.type === "hardBreak") return "\n";
    const inner = (current.content ?? []).map(visit).join("");
    return current.type === "doc" ? inner.replace(/\n\n$/, "") : `${inner}\n\n`;
  };
  return isTiptapDoc(node) ? visit(node).trim() : "";
}

/** Plain preview of some HTML, for excerpts and search. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}
