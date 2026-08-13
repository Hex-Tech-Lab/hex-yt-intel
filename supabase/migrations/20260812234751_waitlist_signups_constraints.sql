-- CodeRabbit review on PR #231: `with check (true)` lets any anonymous REST
-- caller store arbitrary email/source values -- the browser form validates
-- nothing at the database boundary. Add real constraints.

alter table public.waitlist_signups
  add constraint waitlist_signups_email_format
  check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' and length(email) <= 320);

alter table public.waitlist_signups
  add constraint waitlist_signups_source_allowed
  check (source in ('landing_page', 'cli_verification'));
