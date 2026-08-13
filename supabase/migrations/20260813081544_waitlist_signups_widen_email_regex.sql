-- Ultrareview finding: the DB regex's local-part was stricter than the
-- browser's type="email" validation (WHATWG atext superset), so real
-- addresses like o'connor@example.com passed client-side and dead-ended
-- with a silent DB rejection. Widen to match the WHATWG atext set.
alter table public.waitlist_signups drop constraint if exists waitlist_signups_email_format;
alter table public.waitlist_signups
  add constraint waitlist_signups_email_format
  check (email ~* '^[A-Za-z0-9._%+''!#$&*/=?^`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' and length(email) <= 320);
