import { inflateRawSync } from "node:zlib";

/**
 * Inspection d'une archive `.xlsx` AVANT de l'ouvrir (avenant n°1, §4.8 et §7). Refuse les anciens
 * `.xls`, les classeurs avec macros (`.xlsm` renommé), les archives qui annoncent une taille
 * décompressée démesurée (zip bomb) et les noms d'entrées qui cherchent à sortir du dossier.
 *
 * Les tailles de l'annuaire peuvent être falsifiées : chaque entrée est donc **réellement**
 * décompressée avec un budget global (`maxOutputLength`), qui s'interrompt dès qu'il est dépassé,
 * sans jamais allouer plus que le budget.
 */

export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 1000;
/** Rapport de compression au-delà duquel une grosse entrée est suspecte (un XML se compresse ~10 à 20 fois). */
export const MAX_COMPRESSION_RATIO = 200;
const RATIO_FLOOR_BYTES = 1024 * 1024;

export type ArchiveErrorCode = "OLD_FORMAT" | "NOT_A_ZIP" | "MACRO" | "TOO_LARGE" | "SUSPICIOUS";

export type ArchiveCheck = { ok: true; entries: number; uncompressedBytes: number } | { ok: false; code: ArchiveErrorCode; message: string };

const fail = (code: ArchiveErrorCode, message: string): ArchiveCheck => ({ ok: false, code, message });

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const ZIP64_MARK = 0xffffffff;

export function inspectXlsxArchive(buffer: Uint8Array): ArchiveCheck {
  const b = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1) {
    return fail("OLD_FORMAT", "Ce fichier est au format Excel ancien (.xls) : ouvrez-le dans Excel et enregistrez-le au format .xlsx.");
  }
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) return fail("NOT_A_ZIP", "Le fichier n'est pas un classeur Excel .xlsx valide.");

  // The end-of-central-directory record sits in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return fail("NOT_A_ZIP", "Le fichier est endommagé ou incomplet : l'archive Excel est illisible.");

  const count = b.readUInt16LE(eocd + 10);
  const directoryOffset = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || directoryOffset === ZIP64_MARK) return fail("TOO_LARGE", "L'archive est trop volumineuse pour être contrôlée.");
  if (count > MAX_ARCHIVE_ENTRIES) return fail("SUSPICIOUS", "L'archive contient un nombre anormal de fichiers internes.");

  const entries: { method: number; compressed: number; localOffset: number }[] = [];
  const tooLarge = () => fail("TOO_LARGE", `Le contenu du fichier dépasse ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} Mo une fois décompressé : il est refusé.`);
  let offset = directoryOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > b.length || b.readUInt32LE(offset) !== CENTRAL) return fail("NOT_A_ZIP", "Le fichier est endommagé : l'annuaire de l'archive est illisible.");
    const compressed = b.readUInt32LE(offset + 20);
    const uncompressed = b.readUInt32LE(offset + 24);
    const nameLength = b.readUInt16LE(offset + 28);
    const extraLength = b.readUInt16LE(offset + 30);
    const commentLength = b.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength > b.length) return fail("NOT_A_ZIP", "Le fichier est endommagé : l'annuaire de l'archive est illisible.");
    const name = b.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (name.startsWith("/") || name.includes("..") || name.includes("\\")) return fail("SUSPICIOUS", "L'archive contient un chemin interne non autorisé.");
    if (/(^|\/)vbaProject\.bin$/i.test(name) || /^xl\/macrosheets\//i.test(name)) {
      return fail("MACRO", "Les classeurs avec macros (.xlsm) sont refusés : enregistrez le fichier au format .xlsx (sans macros).");
    }
    if (compressed === ZIP64_MARK || uncompressed === ZIP64_MARK) return fail("TOO_LARGE", "L'archive est trop volumineuse pour être contrôlée.");
    if (uncompressed > RATIO_FLOOR_BYTES && uncompressed / Math.max(1, compressed) > MAX_COMPRESSION_RATIO) {
      return fail("SUSPICIOUS", "L'archive a un taux de compression anormal : le fichier est refusé par sécurité.");
    }
    total += uncompressed;
    if (total > MAX_UNCOMPRESSED_BYTES) return tooLarge();
    entries.push({ method: b.readUInt16LE(offset + 10), compressed, localOffset: b.readUInt32LE(offset + 42) });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  // The directory may lie: really inflate every entry, within one shared budget.
  let budget = MAX_UNCOMPRESSED_BYTES;
  let actual = 0;
  for (const entry of entries) {
    if (entry.localOffset + 30 > b.length || b.readUInt32LE(entry.localOffset) !== 0x04034b50) return fail("NOT_A_ZIP", "Le fichier est endommagé : une entrée de l'archive est illisible.");
    const start = entry.localOffset + 30 + b.readUInt16LE(entry.localOffset + 26) + b.readUInt16LE(entry.localOffset + 28);
    const data = b.subarray(start, start + entry.compressed);
    let size: number;
    if (entry.method === 0) size = data.length;
    else if (entry.method === 8) {
      try {
        // `maxOutputLength` stops the inflation at the budget: no more than that is ever allocated.
        size = inflateRawSync(data, { maxOutputLength: budget + 1 }).length;
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return tooLarge();
        return fail("NOT_A_ZIP", "Le fichier est endommagé : une entrée de l'archive ne peut pas être décompressée.");
      }
    } else return fail("SUSPICIOUS", "L'archive utilise une méthode de compression non prise en charge.");
    actual += size;
    budget -= size;
    if (budget < 0) return tooLarge();
  }
  return { ok: true, entries: count, uncompressedBytes: actual };
}
