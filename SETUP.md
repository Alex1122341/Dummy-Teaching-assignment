# Faculty dashboard - Spark Basic Mode

This branch runs the UCVM faculty role/group/history features on the Firebase Spark plan without deploying Cloud Functions. Firebase project: `tester-teaching`.

## What works without Blaze

- Email/password sign-in through Firebase Authentication.
- ADFA General, ADFA Regular, HICC, VISC and Faculty profiles.
- ADFA General user-profile/role management after an Authentication user is created manually in Firebase Console.
- HICC group ownership, course scope and membership. HICCs can change members in their own groups.
- Faculty Dashboard session views.
- ADFA timetable/session editing and faculty directory editing.
- Dashboard-originated history in `session_change_log` and `faculty_change_log`, including before/after details for new edits.
- Self-service password change and Firebase password-reset email.

## Intentional Basic Mode limits

- The dashboard does **not** create Firebase Authentication users. Create each login first in Firebase Console > Authentication > Users, then copy its UID into User Management.
- HICC/VISC direct instructor replacement is view-only. ADFA administrators perform live timetable changes.
- Audit logs are written by the dashboard together with the edit. Direct Firebase Console edits are not automatically audited.
- `mustChangePassword` is a dashboard workflow control rather than a server-verified password-change claim.
- The `functions/` folder is retained only as a future Blaze implementation reference. It is not listed in `firebase.json` and is not deployed in Spark Basic Mode.

## Activation order

1. Keep the current website and Firebase data backed up.
2. In Firebase Console > Authentication, confirm Email/Password sign-in is enabled.
3. Find the existing administrator in Authentication and copy the UID.
4. In Firestore Console, open `users/{UID}` for that administrator and set:
   - `role`: `adfa_general`
   - `active`: `true`
   - `mustChangePassword`: `false` (unless you intentionally want the password-change page first)
   Do this before relying on the new User Management page. Legacy `admin` still retains timetable/faculty-directory access but is not ADFA General.
5. From the repository root deploy **rules only**:
   ```bash
   functions/node_modules/.bin/firebase.cmd deploy --project tester-teaching --only firestore:rules
   ```
   If the local Firebase CLI dependency is unavailable later, any Firebase CLI installation can deploy these rules; Cloud Functions are not required.
6. Publish the frontend files through the existing GitHub Pages process.
7. Sign in as ADFA General and open User Management.
8. To add a person:
   - Firebase Console > Authentication > Users > Add user.
   - Copy the new user's UID.
   - User Management > New account > paste UID, name, email, role, faculty record and Active status.
9. Create HICC groups, assign an HICC owner, course numbers and members.
10. Test with one ADFA Regular, one HICC and one Faculty account before broader rollout.

## Passwords

Administrators no longer set or see another user's password in the dashboard. `Send password reset` uses Firebase Authentication's standard reset-email flow. A signed-in user can change their own password on `password.html`.

If you manually create a user with a temporary password and want the dashboard to prompt for a change, check `Require password change on next dashboard sign-in` on that user's profile.

## History

The existing timetable and faculty-directory pages create `session_change_log` / `faculty_change_log` records as part of their normal save workflow. `faculty-access.js` captures the form's starting values and, after a successful save closes the editor, enriches the newest matching actor log with before/after details. The History tab merges these logs where appropriate and shows Calgary time, actor, action and before/after values when available. The base log still exists even if the enrichment step is interrupted.

Older log records remain visible but may show `Legacy entry; detailed before/after values were not recorded.` because earlier versions did not store those fields.

## Future Blaze upgrade

The existing `functions/` implementation can later be reintroduced for server-controlled account creation, stronger audit guarantees, token revocation and HICC/VISC server-validated instructor replacement. Do not deploy it while the project remains on Spark.
