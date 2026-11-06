/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Link, Text } from "@react-email/components";
import type { ReactElement } from "react";
import type { EmailJob } from "./jobs";
import {
  COLORS,
  Cta,
  Layout,
  P,
  Small,
  Title,
  formatDate,
  formatDateTime,
  formatDay,
  formatFcfa,
  type Cabinet,
} from "./layout";

type Data<T extends EmailJob["template"]> = Extract<EmailJob, { template: T }>["data"];

export interface BuiltEmail {
  subject: string;
  element: ReactElement;
}

function Invitation({ data, cabinet }: { data: Data<"invitation">; cabinet: Cabinet }) {
  return (
    <Layout preview="Activez votre accès à l'espace client" cabinet={cabinet}>
      <Title>Bienvenue, {data.name}</Title>
      <P>Votre accès à l&apos;espace client de {cabinet.name} est prêt. Choisissez votre mot de passe pour l&apos;activer.</P>
      <Cta href={data.url}>Activer mon accès</Cta>
      <Small>Ce lien est valable jusqu&apos;au {formatDateTime(data.expiresAt)} et ne peut être utilisé qu&apos;une seule fois.</Small>
      <Small>Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur : {data.url}</Small>
    </Layout>
  );
}

function PasswordReset({ data, cabinet }: { data: Data<"password-reset">; cabinet: Cabinet }) {
  return (
    <Layout preview="Réinitialisation de votre mot de passe" cabinet={cabinet}>
      <Title>Réinitialisation du mot de passe</Title>
      <P>Bonjour {data.name}, vous avez demandé à choisir un nouveau mot de passe.</P>
      <Cta href={data.url}>Choisir un nouveau mot de passe</Cta>
      <Small>Ce lien est valable une heure et ne peut être utilisé qu&apos;une seule fois. Si vous n&apos;êtes pas à l&apos;origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.</Small>
      <Small>Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur : {data.url}</Small>
    </Layout>
  );
}

function NewsletterConfirmation({ data, cabinet }: { data: Data<"newsletter-confirmation">; cabinet: Cabinet }) {
  return (
    <Layout preview="Confirmez votre inscription à la newsletter" cabinet={cabinet}>
      <Title>Confirmez votre inscription</Title>
      <P>Merci de votre intérêt pour la newsletter de {cabinet.name}. Un dernier clic pour confirmer votre adresse.</P>
      <Cta href={data.url}>Confirmer mon inscription</Cta>
      <Small>Ce lien est valable 48 heures. Si vous n&apos;avez rien demandé, ignorez simplement cet email : vous ne recevrez rien.</Small>
      <Small>Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur : {data.url}</Small>
    </Layout>
  );
}

function NewDeliverable({ data, cabinet }: { data: Data<"new-deliverable">; cabinet: Cabinet }) {
  return (
    <Layout preview="Un nouveau livrable est disponible" cabinet={cabinet}>
      <Title>Nouveau livrable disponible</Title>
      <P>Bonjour {data.name}, le document « {data.title} » vient d&apos;être publié dans votre espace client.</P>
      <Cta href={data.url}>Accéder à mon espace</Cta>
    </Layout>
  );
}

function NewMessage({ data, cabinet }: { data: Data<"new-message">; cabinet: Cabinet }) {
  return (
    <Layout preview="Vous avez un nouveau message" cabinet={cabinet}>
      <Title>Nouveau message</Title>
      <P>Bonjour {data.name}, vous avez reçu un nouveau message dans votre espace client.</P>
      <Cta href={data.url}>Lire le message</Cta>
      <Small>Par sécurité, le contenu des messages n&apos;est jamais envoyé par email.</Small>
    </Layout>
  );
}

function PaymentReminder({ data, cabinet }: { data: Data<"payment-reminder">; cabinet: Cabinet }) {
  return (
    <Layout preview={`Rappel : facture ${data.invoiceNumber}`} cabinet={cabinet}>
      <Title>Rappel de paiement</Title>
      <P>
        Bonjour {data.name}, sauf erreur de notre part, la facture <strong>{data.invoiceNumber}</strong> d&apos;un montant restant dû de{" "}
        <strong>{formatFcfa(data.amountDue)}</strong> était à régler au {formatDate(data.dueAt)}.
      </P>
      <Cta href={data.url}>Consulter la facture</Cta>
      <Small>Si le règlement a été effectué entre-temps, merci de ne pas tenir compte de ce message.</Small>
    </Layout>
  );
}

function NewLead({ data, cabinet }: { data: Data<"new-lead">; cabinet: Cabinet }) {
  return (
    <Layout preview={data.returning ? "Un contact existant vous a réécrit" : "Nouveau prospect"} cabinet={cabinet}>
      <Title>{data.returning ? "Un contact existant vous a réécrit" : "Nouveau prospect"}</Title>
      <P>
        <strong>{data.contactName}</strong> ({data.companyName}) vous a contacté via {data.sourceLabel}.
        {data.returning ? " Une note a été ajoutée à sa fiche." : ""}
      </P>
      <Cta href={data.url}>Ouvrir la fiche</Cta>
    </Layout>
  );
}

function FollowUpList({ title, items }: { title: string; items: Data<"daily-digest">["today"] }) {
  if (items.length === 0) return null;
  return (
    <>
      <Text style={{ margin: "18px 0 6px", fontSize: 15, fontWeight: 700, color: COLORS.navy }}>
        {title} ({items.length})
      </Text>
      {items.map((item) => (
        <Text key={`${item.url}-${item.rule}`} style={{ margin: "0 0 6px", fontSize: 14, lineHeight: "20px" }}>
          • <Link href={item.url} style={{ color: COLORS.navy }}>{item.company}</Link> — {item.rule}, prévue le {formatDate(item.dueAt)}
        </Text>
      ))}
    </>
  );
}

function DailyDigest({ data, cabinet }: { data: Data<"daily-digest">; cabinet: Cabinet }) {
  const total = data.today.length + data.overdue.length;
  return (
    <Layout preview={`${total} relance${total > 1 ? "s" : ""} à traiter`} cabinet={cabinet}>
      <Title>Vos relances du {formatDay(data.date)}</Title>
      <FollowUpList title="En retard" items={data.overdue} />
      <FollowUpList title="À faire aujourd'hui" items={data.today} />
      <Cta href={data.adminUrl}>Ouvrir les relances</Cta>
    </Layout>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Subject and body for each template (all French, spec section 8). */
export function buildEmail(job: EmailJob, cabinet: Cabinet): BuiltEmail {
  switch (job.template) {
    case "invitation":
      return { subject: `Activez votre accès à l'espace client ${cabinet.name}`, element: <Invitation data={job.data} cabinet={cabinet} /> };
    case "password-reset":
      return { subject: "Réinitialisation de votre mot de passe", element: <PasswordReset data={job.data} cabinet={cabinet} /> };
    case "newsletter-confirmation":
      return { subject: "Confirmez votre inscription à la newsletter", element: <NewsletterConfirmation data={job.data} cabinet={cabinet} /> };
    case "new-deliverable":
      return { subject: `Nouveau livrable : ${job.data.title}`, element: <NewDeliverable data={job.data} cabinet={cabinet} /> };
    case "new-message":
      return { subject: "Vous avez un nouveau message", element: <NewMessage data={job.data} cabinet={cabinet} /> };
    case "payment-reminder":
      return { subject: `Rappel de paiement : facture ${job.data.invoiceNumber}`, element: <PaymentReminder data={job.data} cabinet={cabinet} /> };
    case "new-lead":
      return {
        subject: job.data.returning ? `Nouveau message de ${job.data.contactName}` : `Nouveau prospect : ${job.data.companyName}`,
        element: <NewLead data={job.data} cabinet={cabinet} />,
      };
    case "daily-digest":
      return {
        subject: `Relances du jour : ${plural(job.data.today.length, "à faire", "à faire")}, ${plural(job.data.overdue.length, "en retard", "en retard")}`,
        element: <DailyDigest data={job.data} cabinet={cabinet} />,
      };
  }
}
