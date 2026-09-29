# Evaluation reminder token activation rollout

## Follow-up: reissued invitation cycles

Apply `supabase/migrations/20261021000000_evaluation_reminder_invitation_cycles.sql`
after the activation migration and before deploying the cycle-aware sender.
This preserves existing ledger IDs, timestamps, provider IDs and token versions.
It binds proven current-invitation work to the invitation date and leaves older
history separate. New cycles use distinct ledger rows, tokens and provider keys.
Do not delete old reminders or reset their sent status.

Verify after applying:

```sql
select
  exists (select 1 from pg_constraint where conrelid = 'public.evaluation_reminder_deliveries'::regclass
          and conname = 'uq_erd_invitation_reminder') as cycle_uniqueness_ready,
  to_regprocedure('public.prepare_evaluation_reminder_token(uuid,text,timestamp with time zone,smallint)') is not null as cycle_sender_ready,
  to_regclass('public.uq_eval_tokens_one_active') is not null as token_uniqueness_preserved;
```

Deploy after all three are true. Then rerun the weekly job once and inspect its
counts. Use `db/audit/evaluation_reminder_current_round.sql` to inspect each
currently due round; selecting the highest reminder number alone can hide a
new reminder 1 behind a historical reminder 3. No live sends occur in either SQL file.

## Original token activation rollout

The production `uq_eval_tokens_one_active` index rejects the reminder sender's
second active token. Keep the index. The repaired sender stages an inactive token,
records provider acceptance, then switches links atomically. Failed activation
leaves the previous link intact; recovery activates the same delivered token
without contacting the provider again.

1. Apply `supabase/migrations/20261020000000_evaluation_reminder_token_activation.sql`
   in the production Supabase SQL editor. This is additive and sends no emails.
   It must be applied before deploying the new sender.
2. Verify both functions and the original unique index exist:

   ```sql
   select
     to_regprocedure('public.prepare_evaluation_reminder_token(uuid,text,timestamp with time zone)') is not null as prepare_ready,
     to_regprocedure('public.activate_evaluation_reminder_token(uuid,text)') is not null as activate_ready,
     to_regclass('public.uq_eval_tokens_one_active') is not null as unique_index_preserved;
   ```

3. Deploy the application changes. Run the authenticated weekly endpoint with
   `dryRun=1` first to inspect current eligibility. Dry run sends no email.
4. Run the weekly reminder job once after reviewing the preview. Its existing
   claim and recipient checks skip completed, expired, suppressed, and already
   sent reminders. Do not clear delivery history or reset all failed rows.
   The hourly recovery job alone will not retry these original token-write
   failures because they never reached the provider.
5. Verify the latest `cron_runs.details`: `token_write_failed` should be absent;
   inspect `failed_count`, `cleanup_pending_count`, `ambiguous_count` and
   `needs_reconciliation_count`, as well as `sent_count`. Provider acceptance
   is not proof of inbox delivery. Check provider events separately if needed.

An activation error records `cleanup_pending` with `sent_at` and the provider ID.
Recovery uses that recorded acceptance and never sends a second email. A manual
token rotation after staging is preserved and requires review instead of being
silently replaced by the recovery job.

If deployment must be reverted, keep the additive migration installed; dropping
pending token metadata could prevent recovery of a message already accepted by
the provider. The old sender still has the original index conflict, so pause
scheduled evaluation reminders while reverting and reconcile pending deliveries.
