import { Readable } from "node:stream";
import { Document, Page, StyleSheet, Text, View, renderToStream } from "@react-pdf/renderer";
import { formatCell, formatDateTime } from "./format";
import type { ExportTable } from "./types";

// Charter: navy and gold, as for the invoice.
const NAVY = "#1a2b4a";
const GOLD = "#f5b700";
const MUTED = "#475569";
const BORDER = "#e2e8f0";

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 44, paddingHorizontal: 32, fontFamily: "Helvetica", fontSize: 8, color: "#1e293b" },
  brand: { fontSize: 9, fontFamily: "Helvetica-Bold", color: NAVY },
  goldBar: { width: 40, height: 3, backgroundColor: GOLD, marginTop: 3, marginBottom: 8 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: NAVY },
  meta: { color: MUTED, marginTop: 3, lineHeight: 1.4 },
  tableHead: { flexDirection: "row", backgroundColor: NAVY, color: "#ffffff", paddingVertical: 5, paddingHorizontal: 3, fontFamily: "Helvetica-Bold", marginTop: 10 },
  row: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 3, borderBottomWidth: 1, borderBottomColor: BORDER },
  cell: { paddingRight: 4 },
  right: { textAlign: "right" },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", color: MUTED, fontSize: 7 },
});

const isNumeric = (type: string | undefined) => type === "money" || type === "int";

function ExportDocument({ table, generatedAt }: { table: ExportTable; generatedAt: Date }) {
  const total = table.columns.reduce((sum, column) => sum + column.width, 0);
  const width = (w: number) => `${(w / total) * 100}%`;
  return (
    <Document title={table.title} author="MANGA PERFORMANCE">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.brand}>MANGA PERFORMANCE</Text>
        <View style={styles.goldBar} />
        <Text style={styles.title}>{table.title}</Text>
        <Text style={styles.meta}>
          {table.rows.length} ligne(s) · généré le {formatDateTime(generatedAt)}
          {table.filterSummary.length > 0 ? ` · ${table.filterSummary.join(" · ")}` : ""}
        </Text>

        <View style={styles.tableHead} fixed>
          {table.columns.map((column) => (
            <Text key={column.header} style={[styles.cell, { width: width(column.width) }, ...(isNumeric(column.type) ? [styles.right] : [])]}>
              {column.header}
            </Text>
          ))}
        </View>
        {table.rows.map((row, index) => (
          <View key={index} style={styles.row} wrap={false}>
            {row.map((value, i) => (
              <Text key={i} style={[styles.cell, { width: width(table.columns[i].width) }, ...(isNumeric(table.columns[i].type) ? [styles.right] : [])]}>
                {formatCell(value, table.columns[i].type)}
              </Text>
            ))}
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>Document confidentiel : données personnelles, ne pas diffuser.</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function streamPdf(table: ExportTable, generatedAt: Date): Promise<ReadableStream<Uint8Array>> {
  const stream = await renderToStream(<ExportDocument table={table} generatedAt={generatedAt} />);
  return Readable.toWeb(stream as unknown as Readable) as unknown as ReadableStream<Uint8Array>;
}
