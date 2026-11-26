-- FELKAT keeps its draft status (not published, not authorized, no logo): only its sector and description are filled in.
-- Applies only while the starter placeholders are untouched, so a description edited in /admin/references is never overwritten.
UPDATE "Reference"
SET "sector" = 'Tech / SaaS — Intelligence artificielle conversationnelle',
    "description" = 'FELKAT développe des agents vocaux IA qui automatisent les appels des entreprises : réponse aux clients, qualification des prospects et campagnes d''appels, avec une expérience naturelle et disponible 24 h/24.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE lower("name") = 'felkat'
  AND "sector" = 'À préciser'
  AND "description" = 'Description à compléter.';
