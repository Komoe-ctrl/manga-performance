import { FALLBACK_CABINET, renderEmail } from "@manga/emails";

// Runs under the same loader as production (`node --import tsx`), not under Vitest.
const email = await renderEmail(
  {
    template: "password-reset",
    to: "awa@lagune.ci",
    data: { name: "Awa", url: "https://app.example.com/lien?token=abc" },
  },
  FALLBACK_CABINET,
);
console.log(JSON.stringify({ subject: email.subject, hasHtml: email.html.includes("<html"), text: email.text }));
