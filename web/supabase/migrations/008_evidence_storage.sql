-- Shared storage for submitted evidence bundles.
--
-- WHY. Intake runs on Vercel, the worker on Railway. They share this Postgres
-- and nothing else. The first implementation wrote the archive to Vercel's
-- /tmp and stored the absolute path in audits.evidence_ref; the worker opened
-- that path on its own host and got ENOENT. A serverless /tmp would not have
-- survived the invocation even if the hosts had matched, and the worker picks
-- jobs up later by design. The bundle needs a home both processes can reach.
--
-- PRIVATE, AND NOT BY CONVENTION. A bundle is the customer's run: the
-- transactions their agent submitted, the task text it saw, the instance it was
-- issued. `public => false` means the object is unreachable without a
-- credential, and the only credential in play is service_role, held server-side
-- (SECURITY.md: every access through supabaseAdmin(), no untrusted client ever
-- holds one). The application never mints a public or signed URL — it reads the
-- bytes server-side — and lib/evidence-storage.test.ts fails the build if any
-- deployed file calls getPublicUrl/createSignedUrl.
--
-- SAFE TO APPLY WHILE LIVE. Additive: it creates a bucket that does not exist
-- and adds no policy to an existing table. No current row references it, and
-- nothing reads it until the matching deploy ships. Applying this BEFORE the
-- deploy is the correct order — the reverse leaves intake uploading to a bucket
-- that is not there.

-- --------------------------------------------------------------------------
-- The bucket
-- --------------------------------------------------------------------------
-- `on conflict do nothing` so re-running is a no-op, and so this never flips an
-- existing bucket's visibility as a side effect.
insert into storage.buckets (id, name, public)
values ('audit-evidence', 'audit-evidence', false)
on conflict (id) do nothing;

-- Belt and braces: if the bucket already existed from a manual experiment, make
-- sure it is not public. This is the one property that must not be wrong.
update storage.buckets set public = false where id = 'audit-evidence' and public is distinct from false;

-- --------------------------------------------------------------------------
-- Access
-- --------------------------------------------------------------------------
-- NO POLICIES ARE ADDED, DELIBERATELY.
--
-- storage.objects has RLS enabled by Supabase's own schema. service_role
-- bypasses RLS, so intake and the worker can read and write; anon and
-- authenticated match no policy and therefore can do nothing. Adding a
-- permissive policy "so it works" would be the mistake — the absence of a
-- policy IS the access control here, exactly as SECURITY.md describes for the
-- tables.
--
-- Verify after applying (expect: public=false, and zero policies naming the
-- bucket):
--   select id, public from storage.buckets where id = 'audit-evidence';
--   select polname from pg_policies where schemaname = 'storage' and tablename = 'objects';

-- --------------------------------------------------------------------------
-- Retention — DEFERRED, deliberately, with the reason recorded
-- --------------------------------------------------------------------------
-- Bundles accumulate: ~0.1 MB for a free audit, ~0.4 MB for a paid N=20 run
-- (measured). A thousand paid audits is ~400 MB — real but not urgent, and the
-- evidence is the only thing that makes a published verdict re-checkable, so
-- deleting it early costs the property the whole design exists to provide.
--
-- Not implemented here because the retention WINDOW is a policy decision with a
-- dispute-resolution answer behind it, not an engineering default, and choosing
-- one unilaterally is how a customer loses the evidence behind their own score.
-- When it is decided, the shape is:
--
--   delete from storage.objects
--    where bucket_id = 'audit-evidence'
--      and created_at < now() - interval '<window>'
--      and name like (select id::text || '/%' from audits
--                      where status = 'done' and finished_at < now() - interval '<window>');
--
-- run from a scheduled job, and only for audits that have REACHED a verdict —
-- an audit still awaiting scoring must never lose its bundle.
