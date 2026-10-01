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

Owner/Admin users can select **Copy visible emails** or **Send Message to All**. Both use the displayed roster after school, search, and the active view's KPI filters. “All” means students matching those filters. Phone copying is inside the message dialog; there is no separate phone-copy toolbar button. Results exclude missing/invalid values and remove duplicates. Phone numbers are normalized with country codes and copied as a comma-separated recipient list. US/Canadian numbers without a country code receive `+1`; international numbers require an explicit country code. Extensions and multiple numbers in one field are skipped.

The clipboard operation runs directly from the click, without a network wait. Residency routing context is loaded beforehand through an Owner/Admin endpoint that first checks student visibility using the caller's database permissions. A failed routing lookup disables email copying rather than guessing; phone copying remains available.

No database migration is required. Device feedback confirmed that pasting the comma-separated phone list into iPhone Messages' To field can resolve to only one recipient. The copy operation preserves all numbers, but its plain-text result does not create separate recipient entries in Messages. Clipboard tests alone do not establish iOS compatibility. The copy confirmation must not claim that the list is ready for bulk pasting into Messages.

Apple documents adding each recipient to the To field, but does not document bulk clipboard parsing: https://support.apple.com/en-gb/guide/iphone/iphb10c80fc5/ios. Changing delimiters without a device test is not a verified fix.

## iPhone Shortcut setup

Student Profiles includes **Send Message to All**, with these instructions and a link to run the named shortcut. The shortcut must be created on the iPhone once. Apple's local signing tool rejected the generated template, so no installable file is supplied.

In Shortcuts, tap **+** and name the shortcut **ASPIRE Group Message**. Add these five actions in order:

1. **Get Clipboard**.
2. **Split Text**, using Clipboard. Set the separator to **Custom** and enter a comma (`,`).
3. **Get Phone Numbers from Input**, using the **Split Text** result.
4. **Nothing**, so the phone list is not passed into the message body.
5. **Send Message**. Leave Message blank. Press and hold Recipients, choose **Select Variable**, and select **Phone Numbers** from step 3. Expand the action and leave **Show When Run** on.

Each time, copy the filtered phone numbers and run this shortcut on the iPhone. If copying on a computer, transfer that phone list to the iPhone clipboard first. The app enables its shortcut link only after a successful copy for the currently displayed phone list. The shortcut itself reads the clipboard when run; avoid copying something else in between.

The message is a blank draft for the user to write, review, and send. Use a single Send Message action, not a repeat loop, to create a group conversation. Recipients can see one another's numbers and replies. Check that the draft has exactly the recipient count shown in ASPIRE. The owner confirmed that the shortcut worked on their iPhone before requesting the toolbar simplification. No messages were sent during development.

Apple's supported launch mechanism: https://support.apple.com/en-euro/guide/shortcuts/apd624386f42/ios. The launch URL contains only the shortcut name, never student numbers or message content.
