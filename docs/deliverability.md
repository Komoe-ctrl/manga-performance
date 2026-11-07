# Délivrabilité des emails

Ce document décrit comment envoyer les emails de MANGA PERFORMANCE sans finir en spam, et ce que
le code fait déjà pour vous. Il est à compléter avec les valeurs réelles quand le client aura choisi
son domaine et son fournisseur (questions ouvertes de la section 14 de la spécification).

## 1. Deux flux, deux adresses d'envoi

| Flux | Exemples | Adresse d'envoi (variable) | Domaine conseillé |
|---|---|---|---|
| Transactionnel | invitation, réinitialisation du mot de passe, confirmation de newsletter, livrable, message, relance d'impayé, alerte prospect | `EMAIL_FROM_TRANSACTIONAL` | domaine principal, ex. `no-reply@manga-performance.com` |
| Marketing | séquences d'emails, newsletter | `EMAIL_FROM_MARKETING` | **sous-domaine dédié**, ex. `news@news.manga-performance.com` |

Pourquoi séparer : une plainte ou un taux de rebond élevé sur le marketing ne doit jamais dégrader la
réputation du domaine qui envoie les mots de passe et les factures. Le code choisit l'adresse tout seul
(`packages/emails`, modèle `marketing` = adresse marketing, tout le reste = transactionnel).

## 2. Configuration DNS (à faire pour chaque domaine d'envoi)

Les valeurs exactes sont données par le fournisseur (Brevo) dans *Expéditeurs, domaines et IP dédiées*.

1. **SPF** : un enregistrement TXT qui autorise le fournisseur, par exemple
   `v=spf1 include:spf.brevo.com ~all` (un seul enregistrement SPF par domaine : fusionner s'il y en a déjà un).
2. **DKIM** : l'enregistrement TXT (ou CNAME) fourni par Brevo, qui signe chaque message. Vérifier qu'il est
   « authentifié » dans l'interface du fournisseur avant tout envoi.
3. **DMARC** : commencer en observation, puis durcir.
   - Étape 1 : `_dmarc.<domaine>` TXT `v=DMARC1; p=none; rua=mailto:dmarc@<domaine>` pendant 2 à 4 semaines,
     en lisant les rapports.
   - Étape 2 : `p=quarantine; pct=25`, puis `pct=100`.
   - Étape 3 : `p=reject` quand SPF et DKIM sont alignés sur tous les flux.
4. **Alignement** : le domaine du `From` doit être celui qui est authentifié par SPF et DKIM.
5. **Reverse DNS / IP** : avec l'IP partagée du fournisseur, rien à faire. Une IP dédiée ne se justifie qu'au-delà
   de quelques dizaines de milliers d'envois par mois.

Vérifications utiles : `dig TXT <domaine>`, et l'outil de test de la boîte de réception du fournisseur
(score, en-têtes `Authentication-Results`).

## 3. Montée en charge du domaine (warm-up)

Un nouveau domaine d'envoi n'a aucune réputation : envoyer beaucoup d'emails d'un coup est le meilleur moyen
d'être classé en spam.

- Le plafond quotidien est **configurable** (réglage `marketing.dailyCap`, **50 par jour par défaut**).
  Le worker ne met en file que ce quota ; les inscriptions restantes partent le jour ouvré suivant.
- Calendrier indicatif : 50/jour la première semaine, puis 100, 200, 400, 800… en doublant chaque semaine
  tant que le taux de rebond reste sous 2 % et les plaintes sous 0,1 %.
- Fenêtre d'envoi : du lundi au vendredi, de 08:00 à 18:00 (heure d'Abidjan). Hors fenêtre, rien ne part.
- Envoyer d'abord aux contacts les plus engagés (abonnés confirmés, clients) pour bâtir la réputation.

## 4. Ce que le code garantit

- **Double opt-in** pour la newsletter : personne n'est abonné avant d'avoir cliqué dans l'email de
  confirmation (lien à usage unique, 48 h). Les inscriptions non confirmées sont supprimées au bout de 7 jours.
- **Désinscription en un clic** : chaque email marketing contient un lien signé (sans connexion) et les en-têtes
  `List-Unsubscribe` et `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058, exigés par Gmail et
  Yahoo pour les expéditeurs en volume). Ouvrir le lien n'efface personne : il faut cliquer sur le bouton.
- **Liste d'exclusion globale** (`Suppression`) : vérifiée avant **chaque** envoi marketing, deux fois (à la
  planification, puis juste avant l'envoi). Une adresse y entre après une désinscription, un rebond définitif
  (*hard bounce*) ou une plainte. Elle n'empêche pas les emails transactionnels (mot de passe, facture).
- **Arrêts automatiques** d'une séquence : prospect devenu client ou perdu, statut changé à la main (le consultant
  a pris le relais), désinscription, rebond, adresse manquante.
- **Pas d'envoi automatique aux contacts importés** : le scraper n'inscrit jamais personne dans une séquence.
- **Suivi** par ouvertures (pixel) et clics (redirection), avec des identifiants signés (HMAC) : impossible de
  falsifier les statistiques ou de détourner un lien vers un autre site.
- **Webhooks** du fournisseur (`POST /api/webhooks/email`) : livraison, rebond, plainte, désinscription.
  La requête doit prouver qu'elle vient du fournisseur (voir § 5).
- **Version texte** systématique, coordonnées du cabinet en pied de mail, un seul appel à l'action par email.

## 5. Brancher le webhook du fournisseur

1. Dans Brevo : *Paramètres → Webhooks → Transactionnel* (ou Marketing), URL
   `https://<domaine>/api/webhooks/email`.
2. Événements à cocher : *Livré*, *Rebond définitif*, *Rebond temporaire*, *Bloqué*, *Email invalide*,
   *Signalé comme spam*, *Désinscrit*. (Les ouvertures et clics sont suivis par l'application elle-même.)
3. Authentification : ajouter l'en-tête `Authorization: Bearer <BREVO_WEBHOOK_SECRET>`.
   L'application accepte aussi une signature HMAC-SHA256 du corps dans `X-Webhook-Signature`.
   **À confirmer lors du paramétrage** : le mode d'authentification exact proposé par l'interface Brevo ;
   si seul un autre mécanisme existe, il faudra adapter `isAuthentic` (`apps/web/src/server/marketing/email-webhook.ts`).
4. Tester avec un envoi vers une adresse inexistante : l'adresse doit apparaître dans la liste d'exclusion
   (`HARD_BOUNCE`).

## 6. Bonnes pratiques de contenu

- Objet court, honnête, sans MAJUSCULES ni points d'exclamation en série.
- Un contenu utile avant l'appel à l'action ; peu d'images ; pas de pièces jointes dans le marketing.
- Toujours un nom d'expéditeur reconnaissable (`MANGA PERFORMANCE`).
- Surveiller : taux de rebond (< 2 %), plaintes (< 0,1 %), désinscriptions, ouvertures et clics des séquences
  (écran *Séquences*). Mettre en pause une séquence dont les chiffres se dégradent.
- Les données de ciblage doivent être légales : consentement enregistré pour les formulaires, aucune source
  non validée par le client (voir la spécification, sections 5, 6.10 et 14).

## 7. En développement

Tant que `BREVO_API_KEY` vaut `change-me`, rien n'est envoyé : les emails sont écrits dans `.dev-mailbox/` à la
racine du dépôt (un fichier `.html` à ouvrir dans le navigateur et un `.txt` par email). Avec une vraie clé Brevo
en développement, les emails partent réellement : utiliser une adresse de test.
