# Faculty dashboard access and audit update

Prepared for `Alex1122341/Dummy-Teaching-assignment`, based on commit `fcc3938`.
Firebase project in the existing pages: `tester-teaching`. This package has not been deployed to Firebase or the live website. No real accounts, passwords, roles, faculty records, or sessions have been changed.

## Included behavior

| Role | Timetable operations | Faculty directory | Account management | HICC groups |
|---|---|---|---|---|
| ADFA General | All; add/delete sessions and instructor lines | All | Create, edit role, disable, reset passwords | Create/delete groups; assign HICC owners, courses, and members |
| ADFA Regular | All; add/delete sessions and instructor lines | All | None | No group management |
| HICC | View; replace an existing group instructor through Faculty Dashboard | No access to HR records | No account creation, role assignment, or password resets | Manage membership in own groups |
| VISC | View; replace an existing group instructor through Faculty Dashboard | No access to HR records | None | View own group membership through its assignment choices |
| Faculty | View assigned sessions and history | No access to HR records | None | No group management |

All authorized accounts can change their own password. Initial and administrator-reset passwords are `ucvm2026`; these accounts must change the password before accessing timetable data. Passwords are managed by Firebase Authentication, never stored in Firestore, returned in account lists, or included in logs. Reset also invalidates existing sessions. Disable accounts through the Active checkbox; account records are retained for audit attribution.

Group membership uses account UIDs, linked to faculty UCIDs through `users/{uid}.facultyId`. A group always includes its active HICC owner. It may contain faculty, HICC, and VISC accounts only. ADFA General assigns the group's course numbers. HICC/VISC replacements require both the existing and replacement faculty to be within that group and preserve the number of instructor lines, teaching role, and DOE credit. HICCs cannot edit another group's ownership or course scope. Reassign an HICC's groups before disabling or changing their role. Multiple groups per HICC and overlapping memberships are supported.

Legacy `admin` accounts retain operational permissions as ADFA Regular; they do not silently gain user management. Legacy `viewer` and `editor` accounts have faculty view access. Review these profiles and assign explicit new roles during setup.

## Activation

Use an authorized Firebase project administrator account. Do not upload service-account JSON or private credentials to the repository or website.

1. Back up the current Firestore rules and review the project selection. The repository did not contain deployed rules, so the supplied rules are a complete ruleset for the collections used by these two pages. If other applications share this project, merge their required collection rules deliberately; the default is deny.
2. In `functions`, run `npm ci`. Runtime deployment uses Node 22. The local test tools support Java 17; Java is needed only for emulators.
3. Ensure Firebase Email/Password Authentication is enabled, that the website origin is an authorized domain, and that the project supports Cloud Functions deployment. Authenticate the Firebase CLI with the project administrator account. The code uses callable Functions in `us-central1`; if changing regions, update `faculty-access.js` too.
4. Deploy server functions first from the repository root:
   ```bash
   ./functions/node_modules/.bin/firebase deploy --project tester-teaching --only functions:faculty-access
   ```
5. Assign the first ADFA General to a known existing active administrator UID. With authorized Application Default Credentials, run:
   ```bash
   node functions/bootstrap-general.js tester-teaching EXISTING_ADMIN_UID
   ```
   This bootstrap refuses to run if an active ADFA General already exists. It changes the selected role only, preserving the current password. Subsequent administrators are managed through the User Management page. The account list resolves existing email addresses from Firebase Authentication.
6. Deploy the reviewed Firestore rules:
   ```bash
   ./functions/node_modules/.bin/firebase deploy --project tester-teaching --only firestore:rules
   ```
7. Publish the updated `index.html`, `faculty-admin.html`, and the eight new frontend files (`faculty-access.js`, `faculty-access.css`, `faculty-dashboard.html`, `faculty-dashboard.js`, `user-management.html`, `user-management.js`, `password.html`, `password.js`) together using the existing website hosting process. Keep `functions`, tests, and credential files out of static website uploads. There is no new Firebase Hosting configuration; the current website host is preserved.
8. Sign in as ADFA General. Under User Management, create faculty accounts using their email addresses and link each to the correct faculty record. Assign HICC and VISC roles, create each HICC group, set its courses, and select its members. No placeholder faculty accounts have been created.
9. Verify first-sign-in password change, ADFA Regular restrictions, one HICC group replacement, and the corresponding change history entry before inviting faculty.

## Audit behavior

`audit_events` is written only by server functions and cannot be edited or deleted through client access, even by ADFA General. It captures additions/deletions and before/after values for dates, times, session names, course names, room, and faculty assignments. Faculty name/contact changes also appear. Authentication context supplies the actor for direct writes, including deletion and bulk imports; callable group changes use a server-authored record in the same transaction. Actor name/email is captured when the event is processed. Account/role/group/password actions are separately recorded in `account_audit` (ADFA General only); no passwords are recorded.

The history tab loads 50 records at a time with an older-changes button and filters for loaded records. Timestamps display in America/Edmonton. Cloud Functions delivery is asynchronous, so entries may take a few seconds to appear. Reopen the history tab to refresh. Imports generate per-record changes. Old `session_change_log` and `faculty_change_log` records remain untouched; the authoritative new history begins at activation and does not reconstruct missing historical before/after values. Identical metadata-only changes do not produce audit noise. Retry-safe event IDs prevent duplicate trigger records.

## Verification

Run policy checks with `node --test tests/policy.test.js`.

Run the Firestore rules and callable-function integration suite against an isolated demo project:

```bash
CI=true ./functions/node_modules/.bin/firebase emulators:exec --only firestore,auth --project demo-ucvm-access 'node --test tests/*.test.js'
```

The integration suite exercises actual Firestore rules and Admin SDK database operations. Callable handlers are invoked directly with simulated verified authentication context; live HTTPS callable routing, deployed trigger delivery, and browser interactions still require the activation smoke test above. No live-project writes are needed for these tests.

References: [Firebase authenticated Firestore triggers](https://firebase.google.com/docs/functions/firestore-events) and [Firebase Admin user management](https://firebase.google.com/docs/auth/admin/manage-users).
