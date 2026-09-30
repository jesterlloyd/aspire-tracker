# Student Contact Copying and Email Routing

Owner decisions confirmed September 30, 2026.

## Automatic email selection

1. A current recorded residency hire takes precedence. Use the residency record's Cedars-Sinai email, then personal email. Never fall back to school email for a hired resident.
2. Otherwise, use personal email only when the ASPIRE status is exactly `Completed` and the linked rotation's end date is before today's Pacific calendar date.
3. In all other cases, prefer school email. Missing, invalid, or placeholder rotation dates do not trigger a switch.
4. If the preferred school/personal address is missing or invalid, use the other valid address and report the fallback. If neither is valid, skip the student.

The rotation end day itself still uses school email. Legacy `term_dates` and `ngrp_outcome` do not establish rotation completion or employment. For multiple residency outcomes, use the most recent recorded hire; a separation on that hire exits the resident rule.

Explicit school/personal selections and manually selected recipients remain overrides. Applicant correspondence in the residency workflow retains its Transition Form preferred email, then personal email. Account-login and preceptor-snapshot addresses are separate identity rules and are unchanged.

The pure implementation is in `src/lib/notifications/studentEmailLifecycle.js` and `residencyEmail.js`. Connect, surveys, student reminders, transition invitations, and client-side automatic address choices use it. Fallback notes appear in copy confirmations, survey review, and expanded Sent History where a send is recorded.

## Student Profiles

Owner/Admin users can select **Copy visible emails** or **Copy visible phone numbers**. Both use the displayed roster after school, search, and the active view's KPI filters. Results exclude missing/invalid values and remove duplicates. Phone numbers are normalized with country codes and copied as a comma-separated recipient list. US/Canadian numbers without a country code receive `+1`; international numbers require an explicit country code. Extensions and multiple numbers in one field are skipped.

The clipboard operation runs directly from the click, without a network wait. Residency routing context is loaded beforehand through an Owner/Admin endpoint that first checks student visibility using the caller's database permissions. A failed routing lookup disables email copying rather than guessing; phone copying remains available.

No database migration is required. iPhone Messages recipient pasting requires a device check; automated clipboard tests do not establish iOS compatibility.
