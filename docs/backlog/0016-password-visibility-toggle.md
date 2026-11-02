---
title: Password fields get a button that shows or hides the password
summary: Every password field (sign-in, sign-up from an Invitation, password reset, change password, SSI password and token) gets an eye button that switches between hidden and shown text, labelled for screen readers; password managers keep working.
status: done
risk: low
date: 2026-11-02
---

# Password fields get a button that shows or hides the password

## Goal
Every password field has an eye button inside it. Pressing it shows the password as text; pressing again hides it.
The button says "Show password" / "Hide password" (en and de) and has `aria-pressed`. The field keeps its `name`,
`autoComplete` and value when switched, so password managers still fill it. The shown state resets when the form is
sent. Browser tests cover switching by keyboard and by pointer, and axe stays clean in light and dark.

## Read first
- The password fields: apps/web/src/SignedOut.tsx (sign-in at :59, the new-password field at :32),
  apps/web/src/AccountSettings.tsx:98, apps/web/src/Connections.tsx (:53 token, :65 password).
- The shared TextField in apps/web/src/ui/ and [design-system.md](../spec/design-system.md), "Rules every page follows".

## Decided
- One shared component in `apps/web/src/ui/`, not a toggle per page, used by every field above.
- The icon comes from lucide-react beside an accessible name ([ADR 0018](../decisions/0018-icons-and-motion.md)); the
  button meets the 24 px target size. Look and motion follow [ADR 0064](../decisions/0064-ui-overhaul.md).
- Asked for by the owner on 2026-11-02.

## State
Base `main` after PR #17 (UI overhaul) is merged; that PR renamed AccountPage.tsx to AccountSettings.tsx.

- The SSI token field gets the button too (owner, 2026-11-02).

- Done on branch `password-visibility` (2026-11-02). Rulings:
  - A new `PasswordField` beside `TextField` in `ui/TextField.tsx` (sharing its label and messages), not a mode of
    TextField: it has state of its own and only takes `label` as text.
  - The button keeps one name, "Show: <field label>", and says its state with `aria-pressed`; it does not switch to
    "Hide password": the WAI-ARIA toggle button pattern (https://www.w3.org/WAI/ARIA/apg/patterns/button/) says a
    toggle's label must not change with its state. The field label is in the name because no two buttons on a page
    share one; the sign-in dialog adds the account, as the Connection's form with the same field can show behind it.
  - The eye is icon-only: [ADR 0018](../decisions/0018-icons-and-motion.md) amendment of 2026-11-02.
  - Shown, the input turns off spellcheck, autocapitalize and autocorrect, so the browser doesn't read the password.

## Skills to load
accessibility, ux-inputs-and-forms, mobile-native (read each override in [docs/skills.md](../skills.md#overrides) first).

## Don't
- Change how passwords are checked or sent.
- Show the password by default anywhere.
