"use client";

import { useAsync } from "@/lib/hooks/use-async";
import { getPublicProfile } from "@/lib/services";

/** Informations légales de l'éditeur : seules celles qui sont fournies s'affichent, jamais un texte provisoire. */
export function LegalInfo() {
  const profile = useAsync(getPublicProfile);
  if (profile.status !== "success") return null;
  const { legalForm, publicationDirector, host } = profile.data.legal;
  return (
    <>
      {legalForm && <p><strong>Forme juridique, RCCM, capital :</strong> {legalForm}</p>}
      {publicationDirector && <p><strong>Directeur de la publication :</strong> {publicationDirector}</p>}
      {host && <p><strong>Hébergeur :</strong> {host}</p>}
    </>
  );
}

/** Texte juridique complet de la politique de confidentialité, quand il est fourni. */
export function PrivacyFullText() {
  const profile = useAsync(getPublicProfile);
  if (profile.status !== "success" || !profile.data.legal.privacyText) return null;
  return <p className="whitespace-pre-line">{profile.data.legal.privacyText}</p>;
}
