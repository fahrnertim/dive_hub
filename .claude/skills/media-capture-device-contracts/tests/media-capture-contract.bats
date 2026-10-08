#!/usr/bin/env bats

setup() {
  SERVER_INFO="$BATS_TEST_TMPDIR/server.json"
  SERVER_LOG="$BATS_TEST_TMPDIR/server.log"
  python3 "$BATS_TEST_DIRNAME/fixture_server.py" >"$SERVER_INFO" 2>"$SERVER_LOG" &
  SERVER_PID=$!

  local attempt
  for attempt in {1..100}; do
    if [ -s "$SERVER_INFO" ] && grep -q '"url"' "$SERVER_INFO"; then
      return 0
    fi
    sleep 0.05
  done
  cat "$SERVER_LOG" >&2
  return 1
}

teardown() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

run_browser_casebook() {
  local browser_name="$1"
  local mode="$2"
  local playwright_cli
  playwright_cli="${PLAYWRIGHT_CLI:-}"
  if [ -z "$playwright_cli" ]; then
    playwright_cli="$(command -v playwright)" || return 127
  fi
  PLAYWRIGHT_CLI="$playwright_cli" node \
    "$BATS_TEST_DIRNAME/browser_casebook.cjs" \
    "$SERVER_INFO" \
    "$browser_name" \
    "$mode"
}

@test "real Chromium fake-device lifecycle is not proof of OS permission UI, physical unplug or mute, or real camera and microphone hardware" {
  if [ -z "${PLAYWRIGHT_CLI:-}" ]; then
    command -v playwright >/dev/null 2>&1 || skip "Playwright CLI not installed"
  fi

  run run_browser_casebook chromium native-get-user-media
  if [ "$status" -ne 0 ]; then
    printf '%s\n' "$output" >&2
  fi
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":"pass"'* ]]
  [[ "$output" == *'"acquiredKinds":["audio","video"]'* ]]
  [[ "$output" == *'"initialTracksEnded":true'* ]]
  [[ "$output" == *'"initialDetached":true'* ]]
  [[ "$output" == *'"supersededLateStopped":true'* ]]
  [[ "$output" == *'"supersededNeverAttached":true'* ]]
  [[ "$output" == *'"disposedLateStopped":true'* ]]
  [[ "$output" == *'"disposedLateNeverAttached":true'* ]]
  [[ "$output" == *'"browserName":"chromium"'* ]]
  [[ "$output" == *'"mode":"native-get-user-media"'* ]]
  [[ "$output" == *'"evidenceScope":"Chromium fake-device getUserMedia app lifecycle"'* ]]
}

@test "requested browser matrix proves synthetic MediaStream app lifecycle only" {
  if [ -z "${PLAYWRIGHT_CLI:-}" ]; then
    command -v playwright >/dev/null 2>&1 || skip "Playwright CLI not installed"
  fi

  local requested_browsers="${CASEBOOK_BROWSERS:-chromium}"
  local browser_name
  local matrix_output=""
  local -a browsers
  IFS=',' read -r -a browsers <<<"$requested_browsers"

  for browser_name in "${browsers[@]}"; do
    browser_name="${browser_name//[[:space:]]/}"
    [ -n "$browser_name" ] || {
      printf 'CASEBOOK_BROWSERS contains an empty browser entry: %s\n' \
        "$requested_browsers" >&2
      return 1
    }

    run run_browser_casebook "$browser_name" synthetic-app-lifecycle
    if [ "$status" -ne 0 ]; then
      printf 'requested synthetic browser failed: %s\n%s\n' "$browser_name" "$output" >&2
      return "$status"
    fi
    [[ "$output" == *'"status":"pass"'* ]]
    [[ "$output" == *"\"browserName\":\"$browser_name\""* ]]
    [[ "$output" == *'"mode":"synthetic-app-lifecycle"'* ]]
    [[ "$output" == *'"evidenceScope":"synthetic MediaStream app lifecycle"'* ]]
    [[ "$output" == *'"canvasCaptureStream":true'* ]]
    [[ "$output" == *'"webAudioDestination":true'* ]]
    [[ "$output" == *'"native permission or getUserMedia behavior"'* ]]
    [[ "$output" == *'"initialTracksEnded":true'* ]]
    [[ "$output" == *'"supersededLateStopped":true'* ]]
    [[ "$output" == *'"disposedLateStopped":true'* ]]
    matrix_output+="$output"$'\n'
  done

  printf '%s' "$matrix_output"
}
