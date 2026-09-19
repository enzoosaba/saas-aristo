-- Branding: the logo file is now public/brand/coelho-mark.png (solid brand
-- orange, replacing the two-tone coelho.png). The file got a new name so no
-- cached copy of the old image — in the Next image optimizer or in a browser —
-- can be served in its place. tenant_settings.logo_url pointed at the old
-- path; the app does not read it yet, but it must not be left pointing at a
-- file that no longer exists. Guarded so a logo path set by hand is never
-- overwritten; harmless to re-run.
UPDATE aristo.tenant_settings
   SET logo_url = '/brand/coelho-mark.png', updated_at = now()
 WHERE tenant_id = (SELECT id FROM aristo.tenants WHERE slug = 'mentoria-coelho')
   AND logo_url = '/brand/coelho.png';
