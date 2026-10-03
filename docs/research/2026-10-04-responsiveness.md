---
title: Responsiveness
summary: How the web client holds up from 320 to 1440 px and at 200 % text, what was fixed (container queries, narrow card layout, dates and e-mails in tables), the tests that now guard it, and a check against the mobile-native skill.
status: done
date: 2026-10-04
---

# Responsiveness

After the [visual refresh](2026-10-04-visual-refresh-proposal.md) the owner asked how responsive the app is
(2026-10-04), then asked to lock it in with tests.

## Measured before the changes

- The browser tests checked only two widths: 390 px (German, dark) and 1280 px (English, light).
- Measured at 320, 600, 768 and 1024 px, every main page (logbook, dive, Divers, account, admin) fit:
  nothing scrolled sideways, not the page and not a table.
- But the test data was thin (one User, short names). Crowded data showed what fitting hid:
  - 320 px: long e-mail addresses pushed the Invitations and Users cards 68 px wider than the screen.
  - 768 px: the Users table squeezed "Since" into four lines and stacked five actions under each other.
  - 1024 px: dates still wrapped into three lines.
- Phone layouts switched on the window width (`@media (max-width: 40rem)`), not on the room a table has.

## Changes

| Change | Where |
|---|---|
| Tables switch to their narrow layout by their own width: `.table-scroll` is a size container (`container: table / inline-size`) | `ui/ui.css`, `pages.css` |
| Tables with an actions column (`cards`) switch below 48rem of table width (a tablet held upright); the logbook (`stacked`) below 40rem | `ui/ui.css`, `pages.css` |
| Below 22rem (a 320 px phone) a card shows the column name above its value, so the value gets the full width | `ui/ui.css` |
| Card values wrap (`overflow-wrap: break-word`); the label column gives way first (`minmax(5rem, 8rem)`) | `ui/ui.css` |
| Dates in tables stay on one line (`td.date`); e-mail addresses may break anywhere (`td.email`) | `ui/ui.css`, Admin, Divers, account pages |

## Tests that guard it

- `expectGoodPage` (every page test) now also fails when a **table** scrolls sideways: that hides its last
  columns, often the actions. (A page that scrolls sideways already failed it.)
- `e2e/ui-quality.spec.ts` runs every page in four variants: English light desktop (1280), German dark
  phone (390), **English light small phone (320 px, WCAG 1.4.10 reflow)** and **German light tablet (768)**.
- Before them, the test data gets crowded: two more Users with long names and e-mail addresses (each row with
  all the admin's actions), an open Invitation, and a Diver with a long name.
- A sweep: every main page at 320, 480, 640, 800, 960, 1120 and 1440 px, no page or table scrolling sideways.
- Text at 200 % (WCAG 1.4.4) at desktop width: no page or table scrolls sideways.
- Result: 66 browser tests and 47 unit tests green.

Not covered: real phones and tablets (iOS Safari, Android Chrome), landscape phones, the software keyboard.
Emulation doesn't reproduce those (see below).

## Skills

- `wshobson/agents` `responsive-design`: not needed (generic, partly Tailwind; its content is in `better-layout`
  and `accessibility`; 44 px targets and fluid type conflict with our rules). See [skills](../skills.md).
- Mobile UI/UX search (mobile ux, mobile usability, mobile web, touch, thumb zone, mobile navigation, mobile forms,
  pwa): mostly native-app skills (iOS, React Native, Flutter, Expo) or ones already rejected. Vetted:
  - `emilkowalski/skills` `mobile-native`: MIT, one SKILL.md, no scripts or fetches (commit e8a175d, same as our three
    Emil Kowalski skills). Fixes that make a web app feel native on a phone. **Installed** (owner approved 2026-10-04).
  - `designed-by-ai/skills` `design-mobile-apps`: a client for the paid Sleek design service (API key). Rejected.
  - `athevon/genjutsu` `mobile-principles`: no clear license, internal part of a larger suite. Rejected.

### Dive Hub against mobile-native's checklist (2026-10-04)

| Item | State |
|---|---|
| Hover stuck after tap | done: `:hover` only inside `@media (hover: hover)` (skill adds `and (pointer: fine)`) |
| Tap highlight flash, 300 ms delay | done: `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` |
| `100vh` | not used |
| Zoom disabled | no (good) |
| Inputs under 16 px zoom the page on iOS | fixed: the copy field is at body size; `source-rules.test.ts` keeps inputs off `--text-sm`/`--text-xs` |
| Long-press selects button text | fixed: `user-select: none` on buttons, tabs and menu items (`design/base.css`); links and text stay selectable |
| `theme-color` matches the top of the page | fixed: `#ffffff` / `#0e2338`, the header (`index.html`) |
| Safe areas (`viewport-fit=cover`) | not needed: nothing is fixed to the screen edges |
| Pull-to-refresh | keep: the logbook is a scrolling document; dialogs and menus already use `overscroll-behavior: contain` |
| Test on real hardware | **open**: needs the owner's phone; see the checklist below |

## Real-device checklist

Open (2026-10-04): the owner couldn't reach the dev server from the hotel's Wi-Fi. How to connect: [development](../development.md)
("On a real phone"). Ideally one iPhone (Safari) and one Android phone (Chrome); note what fails and on which.

**Tapping and pressing**
1. Tap buttons and links (navigation, Edit dive, a logbook row): the response is immediate, without a grey flash.
2. After tapping something with a hover effect (a navigation link, a logbook row), nothing stays highlighted.
3. Long-press a button (Edit dive, Import files): its label isn't selected. Long-pressing normal text still selects it.

**Typing**
4. Tap any field (search, the dive form's numbers, sign-in): the page doesn't zoom in.
5. Admin → Create invitation link → tap the link field and Copy: no zoom, the link is copied.
6. Edit a dive: number fields bring up a number keyboard with a decimal key (comma in German); the field stays
   visible above the keyboard.
7. Type a new max depth and tap Save straight away, without closing the keyboard first: the dive saves
   (the bug fixed in the visual refresh).

**Look and layout**
8. The browser bar matches the header: white in light mode, dark blue in dark mode (switch the phone's setting).
9. Logbook: each dive is two lines (date, then Diver · depth · duration); nothing scrolls sideways.
10. Dive page: the chart is full width; the Recording tabs scroll sideways with the next one peeking in.
11. Turn the phone to landscape on the logbook and a dive: nothing scrolls sideways, the chart resizes.
12. Admin and Divers pages: rows show as label and value lines; long e-mail addresses wrap.

**Menus, dialogs, scrolling**
13. Open the Diver filter, Recording actions and the account menu: each opens from its button; tapping outside
    closes it; a long list scrolls inside without moving the page.
14. Open a confirmation (split off a recording): the page behind doesn't scroll.
15. Pull down at the top of the logbook: the browser's pull-to-refresh still works.

**Files and settings**
16. Import files opens the phone's file picker; a `.fit` or `.zip` uploads and shows in Imports.
17. Turn on reduced motion (iOS: Accessibility → Motion; Android: Remove animations): menus and dialogs appear
    without animating.
18. Pinch-zoom works on every page.
