import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Chemin dans l'archive (les `/` créent des dossiers). */
  name: string;
  data: Uint8Array;
}

/** Nom d'entrée sûr : pas de remontée, pas de chemin absolu, pas de caractère de contrôle ni réservé. */
export function safeZipName(name: string): string {
  return (
    name
      .split(/[\\/]+/)
      .map((part) =>
        part
          .normalize("NFC")
          .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/^\.+/, ""),
      )
      .filter(Boolean)
      .join("/") || "fichier"
  );
}

// 2026-01-01 00:00 in DOS format: archives are reproducible, and never carry the machine's clock.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/**
 * Archive ZIP (méthode « deflate »), en mémoire. Les noms sont assainis et rendus uniques. Pas de ZIP64 :
 * au plus 65 000 fichiers et 4 Go, ce que l'appelant plafonne bien en dessous.
 */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const used = new Set<string>();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    let name = safeZipName(entry.name);
    if (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${stem} (${n})${ext}`.toLowerCase())) n++;
      name = `${stem} (${n})${ext}`;
    }
    used.add(name.toLowerCase());

    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const body = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
