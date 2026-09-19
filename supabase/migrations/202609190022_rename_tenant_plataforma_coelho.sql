-- Branding: the first tenant is now called "Plataforma Coelho" (it was seeded
-- as "Mentoria Coelho" by 0004). Data only: slug ('mentoria-coelho') and every
-- other identifier are deliberately left alone — the slug is a stable key the
-- application and earlier migrations look the tenant up by.
--
-- The guards (AND name = 'Mentoria Coelho') make this a no-op on a database
-- where the name was already changed by hand, instead of overwriting it, and
-- make re-running it harmless.
UPDATE aristo.tenants
   SET name = 'Plataforma Coelho', updated_at = now()
 WHERE slug = 'mentoria-coelho' AND name = 'Mentoria Coelho';

UPDATE aristo.tenant_settings
   SET platform_name = 'Plataforma Coelho', updated_at = now()
 WHERE tenant_id = (SELECT id FROM aristo.tenants WHERE slug = 'mentoria-coelho')
   AND platform_name = 'Mentoria Coelho';
