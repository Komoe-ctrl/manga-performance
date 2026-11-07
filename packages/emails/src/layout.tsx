/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

/** Firm details shown in every email footer (spec, section 8). */
export interface Cabinet {
  name: string;
  address: string;
  phone: string;
  email: string;
}

/** Used when the settings are not available (e.g. before the first save). */
export const FALLBACK_CABINET: Cabinet = {
  name: "MANGA PERFORMANCE",
  address: "Abidjan, Côte d'Ivoire",
  phone: "+225 07 59 56 50 81",
  email: "diakfode@hotmail.com",
};

// Charter: navy and gold (same values as the web app).
export const COLORS = { navy: "#1a2b4a", gold: "#f5b700", text: "#1e293b", muted: "#475569", border: "#e2e8f0" };

const fonts = "Helvetica, Arial, sans-serif";

export function Layout({
  preview,
  cabinet,
  children,
}: {
  preview: string;
  cabinet: Cabinet;
  children: ReactNode;
}) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f1f5f9", margin: 0, padding: "24px 0", fontFamily: fonts, color: COLORS.text }}>
        <Container style={{ maxWidth: 560, margin: "0 auto" }}>
          <Section style={{ backgroundColor: COLORS.navy, padding: "20px 28px", borderRadius: "8px 8px 0 0" }}>
            <Text style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#ffffff", letterSpacing: 0.5 }}>
              {cabinet.name}
            </Text>
            <Text style={{ margin: "6px 0 0", height: 3, width: 48, backgroundColor: COLORS.gold, lineHeight: "3px", fontSize: 1 }}>
              &nbsp;
            </Text>
          </Section>
          <Section style={{ backgroundColor: "#ffffff", padding: "28px", borderRadius: "0 0 8px 8px" }}>{children}</Section>
          <Section style={{ padding: "16px 8px" }}>
            <Hr style={{ borderColor: COLORS.border, margin: "0 0 12px" }} />
            <Text style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: COLORS.muted }}>
              {cabinet.name} · {cabinet.address}
              <br />
              {cabinet.phone} · {cabinet.email}
            </Text>
            <Text style={{ margin: "8px 0 0", fontSize: 11, color: COLORS.muted }}>
              Cet email a été envoyé automatiquement, merci de ne pas y répondre directement.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700, color: COLORS.navy }}>{children}</Text>;
}

export function P({ children }: { children: ReactNode }) {
  return <Text style={{ margin: "0 0 14px", fontSize: 15, lineHeight: "24px" }}>{children}</Text>;
}

export function Small({ children }: { children: ReactNode }) {
  return <Text style={{ margin: "14px 0 0", fontSize: 12, lineHeight: "18px", color: COLORS.muted }}>{children}</Text>;
}

export function Cta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "20px 0" }}>
      <Button
        href={href}
        style={{
          backgroundColor: COLORS.gold,
          color: COLORS.navy,
          fontWeight: 700,
          fontSize: 15,
          padding: "12px 24px",
          borderRadius: 999,
          textDecoration: "none",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

const DISPLAY_TZ = "Africa/Abidjan";

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: DISPLAY_TZ }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: DISPLAY_TZ }).format(new Date(iso));
}

/** `YYYY-MM-DD` (a calendar day, no timezone) as a long French date. */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** FCFA has no subdivision: whole numbers only. */
export function formatFcfa(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount).replace(/[  ]/g, " ")} FCFA`;
}
