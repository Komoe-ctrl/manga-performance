import { describe, expect, it } from "vitest";
import {
  FILE_KINDS,
  MAX_UPLOAD_BYTES,
  attachmentDisposition,
  detectFileKind,
  extensionOf,
  isKeyOfClient,
  kindFromExtension,
  newStorageKey,
  sanitizeFilename,
  validateUploadRequest,
} from "../src/files";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string, pad = 0) => new Uint8Array([...Buffer.from(text, "latin1"), ...new Array(pad).fill(0)]);

describe("extensions", () => {
  it("reads the last extension, case-insensitively, ignoring directories", () => {
    expect(extensionOf("Rapport.FINAL.PDF")).toBe("pdf");
    expect(extensionOf("C:\\dossier.v2\\fichier")).toBe("");
    expect(extensionOf(".htaccess")).toBe("");
    expect(extensionOf("")).toBe("");
  });
  it("maps the whitelist, including jpeg", () => {
    expect(kindFromExtension("a.pdf")).toBe("pdf");
    expect(kindFromExtension("a.xlsx")).toBe("xlsx");
    expect(kindFromExtension("a.DOCX")).toBe("docx");
    expect(kindFromExtension("a.png")).toBe("png");
    expect(kindFromExtension("a.jpeg")).toBe("jpg");
    expect(kindFromExtension("a.jpg")).toBe("jpg");
  });
  it.each(["a.exe", "a.html", "a.svg", "a.zip", "a.xls", "a.doc", "a.js", "a.php", "a.pdf.exe", "a"])("refuses %s", (name) => {
    expect(kindFromExtension(name)).toBeNull();
  });
});

describe("validateUploadRequest", () => {
  const ok = { filename: "bilan.pdf", mimeType: "application/pdf", sizeBytes: 1000 };

  it("accepts a consistent request and returns the canonical type", () => {
    expect(validateUploadRequest(ok)).toEqual({ ok: true, kind: "pdf", mime: "application/pdf" });
    expect(validateUploadRequest({ ...ok, filename: "photo.JPEG", mimeType: "image/jpeg" })).toMatchObject({ ok: true, kind: "jpg", mime: "image/jpeg" });
    expect(validateUploadRequest({ ...ok, filename: "photo.jpg", mimeType: "image/jpg" })).toMatchObject({ ok: true });
  });
  it("lets the extension decide when the browser declares nothing useful", () => {
    expect(validateUploadRequest({ ...ok, filename: "t.xlsx", mimeType: "" })).toMatchObject({ ok: true, kind: "xlsx" });
    expect(validateUploadRequest({ ...ok, filename: "t.docx", mimeType: "application/octet-stream" })).toMatchObject({ ok: true, kind: "docx" });
  });
  it("ignores mime parameters", () => {
    expect(validateUploadRequest({ ...ok, mimeType: "application/pdf; charset=binary" })).toMatchObject({ ok: true });
  });
  it("refuses empty, oversized and invalid sizes", () => {
    expect(validateUploadRequest({ ...ok, sizeBytes: 0 })).toEqual({ ok: false, reason: "EMPTY" });
    expect(validateUploadRequest({ ...ok, sizeBytes: -1 })).toEqual({ ok: false, reason: "EMPTY" });
    expect(validateUploadRequest({ ...ok, sizeBytes: 1.5 })).toEqual({ ok: false, reason: "EMPTY" });
    expect(validateUploadRequest({ ...ok, sizeBytes: MAX_UPLOAD_BYTES })).toMatchObject({ ok: true });
    expect(validateUploadRequest({ ...ok, sizeBytes: MAX_UPLOAD_BYTES + 1 })).toEqual({ ok: false, reason: "TOO_LARGE" });
  });
  it("refuses unknown types and extension/type mismatches", () => {
    expect(validateUploadRequest({ ...ok, filename: "virus.exe", mimeType: "application/pdf" })).toEqual({ ok: false, reason: "TYPE_NOT_ALLOWED" });
    expect(validateUploadRequest({ ...ok, mimeType: "text/html" })).toEqual({ ok: false, reason: "TYPE_MISMATCH" });
    expect(validateUploadRequest({ ...ok, filename: "a.png", mimeType: "application/pdf" })).toEqual({ ok: false, reason: "TYPE_MISMATCH" });
  });
});

describe("detectFileKind (magic numbers)", () => {
  const ooxml = (folder: string) => ascii(`PK\x03\x04\x14\x00\x06\x00\x08\x00\x00\x00[Content_Types].xml\x00\x00PK\x03\x04${folder}document.xml`, 100);

  it("recognises PDF, PNG and JPEG", () => {
    expect(detectFileKind(ascii("%PDF-1.7\n%âãÏÓ"))).toBe("pdf");
    expect(detectFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("png");
    expect(detectFileKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("jpg");
  });
  it("accepts a PDF header after a short preamble, but not deep in the file", () => {
    expect(detectFileKind(ascii(`\n\n  junk${" ".repeat(100)}%PDF-1.4`))).toBe("pdf");
    expect(detectFileKind(ascii(`${"x".repeat(2000)}%PDF-1.4`))).toBeNull();
  });
  it("tells Word from Excel inside the ZIP container", () => {
    expect(detectFileKind(ooxml("word/"))).toBe("docx");
    expect(detectFileKind(ooxml("xl/"))).toBe("xlsx");
  });
  it("picks whichever folder comes first when both appear", () => {
    expect(detectFileKind(ascii("PK\x03\x04[Content_Types].xml word/ xl/", 10))).toBe("docx");
    expect(detectFileKind(ascii("PK\x03\x04[Content_Types].xml xl/ word/", 10))).toBe("xlsx");
  });
  it("rejects plain ZIPs, other Office formats and unknown content", () => {
    expect(detectFileKind(ascii("PK\x03\x04plain archive content", 20))).toBeNull();
    expect(detectFileKind(ascii("PK\x03\x04[Content_Types].xml ppt/slides", 20))).toBeNull();
    expect(detectFileKind(ascii("MZ\x90\x00 this is an executable"))).toBeNull();
    expect(detectFileKind(ascii("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectFileKind(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(detectFileKind(new Uint8Array())).toBeNull();
  });
  it("does not trust a name: an executable renamed .pdf is not a PDF", () => {
    expect(detectFileKind(ascii("MZ\x90\x00\x03"))).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("drops paths, control characters and header-breaking characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\moi\\bilan.pdf")).toBe("bilan.pdf");
    expect(sanitizeFilename('evil"\r\nX-Injected: 1.pdf')).toBe("evilX-Injected 1.pdf");
    expect(sanitizeFilename("a<b>c|d*e?.pdf")).toBe("abcde.pdf");
  });
  it("keeps accents, trims, and never returns an empty or hidden name", () => {
    expect(sanitizeFilename("  Bilan  prévisionnel 2026.pdf ")).toBe("Bilan prévisionnel 2026.pdf");
    expect(sanitizeFilename("...")).toBe("fichier");
    expect(sanitizeFilename("")).toBe("fichier");
    expect(sanitizeFilename(".hidden.pdf")).toBe("hidden.pdf");
    expect(sanitizeFilename("x".repeat(300)).length).toBe(100);
  });
});

describe("storage keys", () => {
  it("builds unique, non-guessable keys under the client's prefix", () => {
    const a = newStorageKey("client123", "pdf");
    const b = newStorageKey("client123", "pdf");
    expect(a).toMatch(/^clients\/client123\/[A-Za-z0-9_-]{24}\.pdf$/);
    expect(a).not.toBe(b);
  });
  it("only recognises keys of the given client, without escapes", () => {
    const key = newStorageKey("c1", "png");
    expect(isKeyOfClient(key, "c1")).toBe(true);
    expect(isKeyOfClient(key, "c2")).toBe(false);
    expect(isKeyOfClient("clients/c1/../c2/x.pdf", "c1")).toBe(false);
    expect(isKeyOfClient("clients/c1/sub/x.pdf", "c1")).toBe(false);
    expect(isKeyOfClient("public/blog/x.png", "c1")).toBe(false);
    expect(isKeyOfClient("clients/c10/x.pdf", "c1")).toBe(false);
  });
});

describe("attachmentDisposition", () => {
  it("forces a download with an ASCII fallback and a UTF-8 name", () => {
    expect(attachmentDisposition("Bilan été.pdf")).toBe(`attachment; filename="Bilan _t_.pdf"; filename*=UTF-8''Bilan%20%C3%A9t%C3%A9.pdf`);
  });
  it("cannot be used to inject headers", () => {
    const value = attachmentDisposition('a"\r\nSet-Cookie: x=1.pdf');
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.startsWith("attachment;")).toBe(true);
  });
  it("covers every supported kind", () => {
    expect(Object.keys(FILE_KINDS)).toEqual(["pdf", "xlsx", "docx", "png", "jpg"]);
  });
});
