-- cubic review fix (PR #176, confidence 6): the calendar-boundary reset
-- decision made remediation.periodDays an inert no-op -- nothing reads it
-- anymore. Per ADR 019's own "every number here is retunable... per the
-- standing no-hardcoded-tunables directive," an admin-editable setting with
-- zero effect is worse than no setting at all (silently misleading, not
-- just unused). Delete outright rather than leave a documented-no-op.
delete from public.setting_values where setting_key = 'remediation.periodDays';
delete from public.setting_definitions where key = 'remediation.periodDays';
