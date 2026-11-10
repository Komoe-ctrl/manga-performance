import { existsSync } from "node:fs";
import { join } from "node:path";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { buildInvoiceView, type InvoiceDocumentData, type InvoiceView } from "./invoice-document";

// Charter: navy and gold (same values as the web app and the emails).
// The logo ships in the web app's public folder; without it the header keeps the text brand.
const LOGO_PATH = join(process.cwd(), "public", "images", "logo.png");
const logo = existsSync(LOGO_PATH) ? LOGO_PATH : null;

const NAVY = "#1a2b4a";
const GOLD = "#f5b700";
const MUTED = "#475569";
const BORDER = "#e2e8f0";

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1e293b" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28 },
  logo: { width: 64, height: 56, marginBottom: 8 },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold", color: NAVY },
  goldBar: { width: 48, height: 3, backgroundColor: GOLD, marginTop: 4, marginBottom: 6 },
  muted: { color: MUTED, lineHeight: 1.4 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", color: NAVY },
  number: { fontSize: 12, marginTop: 2 },
  parties: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  partyLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", marginBottom: 4 },
  clientName: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 2 },
  tableHead: { flexDirection: "row", backgroundColor: NAVY, color: "#ffffff", paddingVertical: 6, paddingHorizontal: 6, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: BORDER },
  colLabel: { flex: 5 },
  colQty: { flex: 1.2, textAlign: "right" },
  colPrice: { flex: 2, textAlign: "right" },
  colTotal: { flex: 2, textAlign: "right" },
  totals: { alignSelf: "flex-end", width: 230, marginTop: 14 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalStrong: { fontFamily: "Helvetica-Bold", fontSize: 11, color: NAVY },
  section: { marginTop: 22 },
  notice: { marginTop: 26, padding: 8, borderWidth: 1, borderColor: BORDER, color: MUTED, fontSize: 8, lineHeight: 1.4 },
  watermark: { position: "absolute", top: 330, left: 90, fontSize: 90, fontFamily: "Helvetica-Bold", color: "#e2e8f0", transform: "rotate(-30deg)" },
});

function InvoicePage({ view }: { view: InvoiceView }) {
  return (
    <Page size="A4" style={styles.page}>
      {view.watermark && <Text style={styles.watermark} fixed>{view.watermark}</Text>}

      <View style={styles.header}>
        <View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          {logo && <Image src={logo} style={styles.logo} />}
          <Text style={styles.brand}>{view.cabinet.name}</Text>
          <View style={styles.goldBar} />
          <Text style={styles.muted}>{view.cabinet.address}</Text>
          <Text style={styles.muted}>{view.cabinet.phone}</Text>
          <Text style={styles.muted}>{view.cabinet.email}</Text>
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{view.title}</Text>
          <Text style={styles.number}>N° {view.number}</Text>
          {view.fneLine && <Text style={styles.muted}>{view.fneLine}</Text>}
          {view.creditNoteLine && <Text style={styles.muted}>{view.creditNoteLine}</Text>}
          {view.meta.map((item) => (
            <Text key={item.label} style={styles.muted}>{item.label} : {item.value}</Text>
          ))}
        </View>
      </View>

      <View style={styles.parties}>
        <View>
          <Text style={styles.partyLabel}>Facturé à</Text>
          <Text style={styles.clientName}>{view.client.name}</Text>
          {view.client.lines.map((line) => (
            <Text key={line} style={styles.muted}>{line}</Text>
          ))}
        </View>
      </View>

      <View style={styles.tableHead}>
        <Text style={styles.colLabel}>Désignation</Text>
        <Text style={styles.colQty}>Qté</Text>
        <Text style={styles.colPrice}>Prix unitaire HT</Text>
        <Text style={styles.colTotal}>Total HT</Text>
      </View>
      {view.rows.map((row, index) => (
        <View key={index} style={styles.row} wrap={false}>
          <Text style={styles.colLabel}>{row.label}</Text>
          <Text style={styles.colQty}>{row.quantity}</Text>
          <Text style={styles.colPrice}>{row.unitPrice}</Text>
          <Text style={styles.colTotal}>{row.total}</Text>
        </View>
      ))}

      <View style={styles.totals} wrap={false}>
        {view.totals.map((total) => (
          <View key={total.label} style={styles.totalRow}>
            <Text style={total.strong ? styles.totalStrong : undefined}>{total.label}</Text>
            <Text style={total.strong ? styles.totalStrong : undefined}>{total.value}</Text>
          </View>
        ))}
      </View>

      {view.paymentLines.length > 0 && (
        <View style={styles.section} wrap={false}>
          <Text style={styles.partyLabel}>Règlement et mentions</Text>
          {view.paymentLines.map((line) => (
            <Text key={line} style={styles.muted}>{line}</Text>
          ))}
        </View>
      )}

      <Text style={styles.notice}>{view.notice}</Text>
    </Page>
  );
}

/** Renders the invoice as a PDF, on demand (spec, 6.4). */
export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  const view = buildInvoiceView(data);
  return renderToBuffer(
    <Document title={`${view.title} ${view.number}`} author={view.cabinet.name} creator={view.cabinet.name}>
      <InvoicePage view={view} />
    </Document>,
  );
}
