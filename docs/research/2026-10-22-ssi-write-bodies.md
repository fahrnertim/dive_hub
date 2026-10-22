---
title: SSI app write bodies (app 5.0.43)
summary: The JSON bodies the MySSI app sends for buddy, gear, gear set, emergency contact, site, profile, privacy and dive verify calls, with the type of each key in the app database; for checking Dive Hub against the app.
status: open
date: 2026-10-22
---

# SSI app write bodies (app 5.0.43)

Read from the app with Blutter, like the [dive body](2026-10-22-ssi-save-divelog-keys.md); the calls and how they were
read are in [the API surface note](2026-10-22-ssi-app-api-surface.md). Types are the app database's (`?` = nullable
there), **not** the server's rules. Each upload sends one row per call (`Future.wait` over the rows that need upload),
the whole row, empty values as `null`. `needsUpload` and `internalPk` are the app's own bookkeeping.

## Gear (`gearUpload`)

The row's `toJson`; before sending the app puts `""` under `gear_id` (probably only when it has none [?]), removes `internalPk` and `gear_images`.

| Key | Type | Note |
|---|---|---|
| `internalPk` | `int` | removed before sending |
| `gear_id` | `int?` |  |
| `gear_user_master_id` | `int?` |  |
| `gear_deleted` | `int?` |  |
| `gear_manufacturer_id` | `int?` |  |
| `gear_manufacturer_misc` | `String?` |  |
| `gear_main_cat_id` | `int?` |  |
| `gear_main_product_id` | `int?` |  |
| `gear_product_name_modell` | `String?` |  |
| `gear_buy_date` | `DateTime?` |  |
| `gear_product_serial` | `String?` |  |
| `gear_buy_dealer` | `String?` |  |
| `gear_date_last_service` | `DateTime?` |  |
| `gear_date_next_service` | `DateTime?` |  |
| `gear_comment` | `String?` |  |
| `timestamp` | `DateTime?` |  |
| `gear_images` | `Map<String, dynamic>?` | removed before sending |
| `gear_bluetooth_address` | `String?` |  |
| `gear_used_count` | `int?` |  |
| `needsUpload` | `bool` | app-internal |

## Gear set (`gearSetUpload`)

The row's `toJson`; `""` is put under `gearset_id` (probably only when it has none [?]) and `internalPk` removed.

| Key | Type | Note |
|---|---|---|
| `internalPk` | `int` | removed before sending |
| `gearset_id` | `int?` |  |
| `gearset_mid` | `int?` |  |
| `gearset_name` | `String?` |  |
| `gearset_description` | `String?` |  |
| `gearset_created` | `DateTime?` |  |
| `gearset_updated` | `DateTime?` |  |
| `gearset_deleted` | `bool` |  |
| `gear` | `List<int>?` |  |
| `needsUpload` | `bool` | app-internal |

## Emergency contact (`emergencyContactUpload`)

The row's `toJson`, sent unchanged.

| Key | Type | Note |
|---|---|---|
| `internalPk` | `int` | app-internal |
| `uec_id` | `int?` |  |
| `localRefId` | `int?` |  |
| `uec_mid` | `int?` |  |
| `uec_priority` | `int` |  |
| `uec_name` | `String?` |  |
| `uec_email` | `String?` |  |
| `uec_phone` | `String?` |  |
| `uec_relation` | `String?` |  |
| `uec_contact_mid` | `int?` |  |
| `uec_deleted` | `bool` |  |
| `uec_updated_by` | `String?` |  |
| `uec_timestamp` | `DateTime?` |  |
| `needsUpload` | `bool` | app-internal |

## Site (`siteUpload`)

The row's `toJson`, sent unchanged (site description and site images have their own calls).

| Key | Type | Note |
|---|---|---|
| `internalPk` | `int` | app-internal |
| `odin_dive_sites_id` | `int?` |  |
| `odin_dive_sites_name` | `String?` |  |
| `bow` | `String?` |  |
| `odin_user_log_animal_ids` | `List<int>?` |  |
| `odin_dive_sites_lon` | `double?` |  |
| `odin_dive_sites_lat` | `double?` |  |
| `odin_dive_sites_meta_address` | `String?` |  |
| `odin_dive_sites_meta_region` | `String?` |  |
| `odin_dive_sites_meta_country` | `String?` |  |
| `odin_countries_code_iso` | `String?` |  |
| `odin_dive_sites_regions_name` | `String?` |  |
| `odin_dive_sites_areas_name` | `String?` |  |
| `odin_dive_sites_geo_locked` | `bool?` |  |
| `odin_dive_sites_is_private` | `bool?` |  |
| `odin_dive_sites_alias_ids` | `String?` |  |
| `odin_dive_sites_is_private_owner` | `int?` |  |
| `odin_dive_sites_deleted` | `bool` |  |
| `needsUpload` | `bool` | app-internal |
| `alias_names_search` | `String?` |  |
| `alias_names` | `List<String>?` |  |

## Buddy (`buddyUpload`)

The row is encoded directly (`toJson`), no keys added or removed in the upload code.

| Key | Type | Note |
|---|---|---|
| `internalPk` | `int` | app-internal |
| `id` | `int?` |  |
| `localRefId` | `int?` |  |
| `address` | `String?` |  |
| `dob` | `DateTime?` |  |
| `comment` | `String?` |  |
| `added` | `DateTime?` |  |
| `email` | `String?` |  |
| `firstname` | `String?` |  |
| `gender` | `int?` |  |
| `image` | `String?` |  |
| `lastname` | `String?` |  |
| `leader_nr` | `int?` |  |
| `leader_active` | `bool?` |  |
| `master_id` | `int?` |  |
| `nickname` | `String?` |  |
| `phone` | `String?` |  |
| `deleted` | `bool?` |  |
| `needsUpload` | `bool?` | app-internal |
| `confirmed` | `bool?` |  |
| `favorite` | `bool?` |  |

## Profile (`profileUpload`)

`jsonEncode` of the signed-in `User` (json_serializable, `_$UserToJson`): `authenticated`, `user_email`, `mid`, `token`,
`imperial`, `user_id`, `user_leader_nr`, `user_facility_id`, `user_title`, `user_forename`, `user_middlename`, `user_lastname`,
`user_street`, `user_street2`, `user_zip`, `user_city`, `user_state`, `user_country`, `user_country_long`, `user_language`,
`user_mobile_c`, `user_phone_c`, `user_birthday`, `user_gender`, `user_status`, `user_diving_since`, `user_no_dives`,
`user_freediving_since`, `user_no_freedives`, `user_image`, `user_units`, `privacy_required`, `privacy_settings_required`,
`privacy_settings`, `apis`, `my_divessi_url`, `ems_apis`, `pro`, `needsUpload`, `documents`, `can_test_webview`,
`user_app_settings`. The whole user object goes up, including keys that are server-side (token, URLs). The json_serializable
code gives no per-key nullability here.

## Privacy settings (`privacySettingsUpload`)

A map built in the upload code from the current profile: `user_id`, `address`, `allergies`, `ccards`, `emergency`,
`equipmentlist`, `logbook`, `sizingtable`, `buddy_finder`, `hide_recent_certs_online`, `use_record_data`,
`marketing_consent` (the app shows "save_public_success" / "save_public_failure" afterwards).

## Dive verify and unverify (`diveVerify`, `diveUnverify`)

- **Verify:** `odin_user_log_id`, `odin_user_log_divecenter_confirmed_id`, `odin_user_log_leader_confirmed_id`; the code also
  formats a date (`yyyy-MM-dd`) and a time (`HH:mm`, locale `en_US`) that go into the body [?: key names not read].
- **Unverify:** `odin_user_log_id` (and the same date and time format) [?].

## Not read

`saveGearImage`, `siteDescriptionUpload`, `siteImageUpload` (images and text), `profileImageUpload`, `newEmailUpload`,
`newPasswordUpload`, `saveUserDivecomputer`, `uploadDivelogHistory`, `saveReactionSonar`, `privacyPolicyAccepted`,
`feedback`, `signup` and the course uploads.
