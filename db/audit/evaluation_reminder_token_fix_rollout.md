# Evaluation reminder token activation rollout

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
