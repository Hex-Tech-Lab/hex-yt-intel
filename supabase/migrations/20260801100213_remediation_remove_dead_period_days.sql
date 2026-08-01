-- cubic review fix (PR #176, confidence 6): the calendar-boundary reset
-- decision made remediation.periodDays an inert no-op -- nothing reads it
-- anymore. Per ADR 019's own "every number here is retunable... per the
-- standing no-hardcoded-tunables directive," an admin-editable setting with
-- zero effect is worse than no setting at all (silently misleading, not
-- just unused). Delete outright rather than leave a documented-no-op.
--
-- NOTE for future setting deletions (cubic review, PR #176):
-- setting_definitions.key -> setting_values_history.setting_key is
-- ON DELETE CASCADE, so deleting a definition also wipes its audit trail.
-- Verified live before this delete: `select count(*) from
-- setting_values_history where setting_key = 'remediation.periodDays'` = 0
-- (never edited since seeding), so nothing was actually lost here -- but a
-- future deletion of a setting WITH real history should archive those rows
-- first if the audit trail matters.
delete from public.setting_values where setting_key = 'remediation.periodDays';
delete from public.setting_definitions where key = 'remediation.periodDays';
