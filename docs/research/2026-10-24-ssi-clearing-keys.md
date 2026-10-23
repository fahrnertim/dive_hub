---
title: SSI checks of clearing a key on an update
summary: On the owner's account, sending `null` for a key on an update clears it at SSI. All 14 keys tested (note, lead, tank, pressures, tank type, average depth, water temperature) came back empty after one update with `null`. The note comes back as "" rather than null. "" and 0 were not needed. Dive Hub encodes a cleared field as `null` on every key.
status: done
date: 2026-10-24
---

# SSI checks of clearing a key on an update

Run by the controller with the kept token on 2026-10-24, announced in the session: `round-trip.ts clear start`, then `clear finish`. Site 83913, MySSI app 5.0.43. [T] means tested on the owner's account. Background: [the values checks](2026-10-24-ssi-values-checks.md), [ADR 0056](../decisions/0056-two-way-exchange-and-automation.md).

## How it was run

`start` created one dive dated 2000-01-03 10:00 (notes "Dive Hub test", lead 6 kg, a 12 L steel tank 200 to 50 bar, average depth 8 m, water 20 C), which took number 93. It then saved up to three updates built from SSI's current record: `null` for every key, then `""`, then `0` for keys still stored. After the first update (`null`) every key was empty, so the `""` and `0` rounds never ran. Because the note was cleared too, `start` put it back so that `finish` could recognise the test dive. `finish` deleted it and confirmed it was gone. Only this dive was printed.

## Result

| key | sent null | sent "" | sent 0 | result |
|---|---|---|---|---|
| `odin_user_log_comment` | cleared, stored "" [T] | not needed | n/a | cleared by null; reads back as "" |
| `odin_user_log_weight_kg` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_weight_lb` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_tank_vol_l` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_tank_vol_cuft` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_pressure_start_bar` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_pressure_end_bar` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_pressure_start_psi` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_pressure_end_psi` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_var_tanktype_id` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_avg_depth_m` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_avg_depth_ft` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_watertemp_c` | cleared, stored null [T] | not needed | not needed | cleared by null |
| `odin_user_log_watertemp_f` | cleared, stored null [T] | not needed | not needed | cleared by null |

Before the update every key held what the create sent (lead 6 and 13.2 lb, tank 12 L and 97 cuft, 200 and 50 bar, 2901 and 725 psi, tank type 19, depth 8 m and 26.2 ft, water 20 C and 68 F).

## What it means

- No key kept its value, so there is no field that is "not removable" at SSI for these keys.
- Task 4 encodes a cleared field as `null` on every key. The note then reads back as "", which the import already treats as empty.
- A key a field fills in pairs (kg and lb, bar and psi, L and cuft, m and ft, C and F) must be cleared together, as the check did.
