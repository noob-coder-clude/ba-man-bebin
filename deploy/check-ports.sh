#!/usr/bin/env bash
# ---------------------------------------------------------------
# Ba Man Bebin — port & readiness check
#
#   bash deploy/check-ports.sh                 # checks app.boxd.sh
#   bash deploy/check-ports.sh mydomain.com    # checks another domain
#   bash deploy/check-ports.sh --local         # checks THIS machine
#
# Answers, in order:
#   1. does the domain resolve, and to which IP?
#   2. is port 80 open?  is port 443 open?
#   3. is something actually answering HTTP there?
#   4. is it *our* app (does /healthz reply)?
#   5. do WebSockets get through (the thing Socket.IO needs)?
#
# Works with only bash + curl. No dig/nmap/netcat required.
# ---------------------------------------------------------------
set -uo pipefail

DOMAIN="${1:-app.boxd.sh}"
LOCAL_MODE=0
[[ "$DOMAIN" == "--local" || "$DOMAIN" == "-l" ]] && { LOCAL_MODE=1; DOMAIN="127.0.0.1"; }
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"

TIMEOUT=6
PASS=0; FAIL=0; WARN=0

C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_B=$'\033[1m'
C_OK=$'\033[1;32m'; C_BAD=$'\033[1;31m'; C_WARN=$'\033[1;33m'; C_INFO=$'\033[1;36m'

ok()   { printf '  %s✓%s %s\n' "$C_OK" "$C_RESET" "$1"; PASS=$((PASS+1)); }
bad()  { printf '  %s✗%s %s\n' "$C_BAD" "$C_RESET" "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  %s!%s %s\n' "$C_WARN" "$C_RESET" "$1"; WARN=$((WARN+1)); }
info() { printf '  %s·%s %s\n' "$C_DIM" "$C_RESET" "$1"; }
head_() { printf '\n%s%s%s\n' "$C_B$C_INFO" "$1" "$C_RESET"; }

# Open a TCP connection using bash's /dev/tcp — no external tools needed.
port_open() {
  local host="$1" port="$2"
  timeout "$TIMEOUT" bash -c "exec 3<>/dev/tcp/${host}/${port}" 2>/dev/null
}

printf '%s\n' "${C_B}▶ Ba Man Bebin — checking ${DOMAIN}${C_RESET}"

# ---------------------------------------------------------------
head_ "1. DNS"
# ---------------------------------------------------------------
if [[ "$DOMAIN" =~ ^[0-9.]+$ ]]; then
  IPS="$DOMAIN"; info "IP literal, skipping lookup"
else
  IPS="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  if [[ -z "$IPS" ]]; then
    bad "$DOMAIN does not resolve — check the A record at your DNS provider"
    IPS=""
  else
    ok "$DOMAIN → ${IPS}"
  fi
fi

if [[ $LOCAL_MODE -eq 0 && -n "$IPS" ]]; then
  MYIP="$(timeout "$TIMEOUT" curl -s https://api.ipify.org 2>/dev/null || true)"
  if [[ -n "$MYIP" ]]; then
    if [[ " $IPS " == *" $MYIP "* ]]; then
      info "resolves to this machine ($MYIP)"
    else
      info "this machine is $MYIP (fine if you run this from your laptop, or if Cloudflare proxies the domain)"
    fi
  fi
fi

# ---------------------------------------------------------------
head_ "2. Ports"
# ---------------------------------------------------------------
TARGET="${IPS%% *}"; TARGET="${TARGET:-$DOMAIN}"

for PORT in 80 443; do
  if port_open "$TARGET" "$PORT"; then
    ok "port $PORT is OPEN"
    eval "P${PORT}=1"
  else
    bad "port $PORT is CLOSED or filtered"
    eval "P${PORT}=0"
  fi
done

if [[ $LOCAL_MODE -eq 1 ]]; then
  head_ "2b. Local listeners"
  if command -v ss >/dev/null; then
    LIST="$(ss -ltnp 2>/dev/null | awk 'NR>1{print $4}' | grep -Eo '[0-9]+$' | sort -un | tr '\n' ' ')"
    info "listening ports: ${LIST:-none}"
    for PORT in 80 443 3000; do
      if grep -qw "$PORT" <<<"$LIST"; then ok "something is listening on $PORT"
      else warn "nothing is listening on $PORT"; fi
    done
  fi
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    info "ufw is ACTIVE — make sure 80/443 are allowed:"
    info "    sudo ufw allow 80/tcp && sudo ufw allow 443/tcp"
  fi
fi

# ---------------------------------------------------------------
head_ "3. HTTP response"
# ---------------------------------------------------------------
# Sanity-check our own outbound HTTP first. Some networks (corporate
# proxies, CI sandboxes, restrictive firewalls) allow raw TCP but block
# real HTTP — without this check every site would look "broken" and the
# report would blame your server for a problem on this machine.
NET_SANE=1
if [[ $LOCAL_MODE -eq 0 ]]; then
  # Two references: if neither answers, the problem is on this side.
  REF_A="$(timeout "$TIMEOUT" curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" http://example.com/ 2>/dev/null)"
  REF_B="$(timeout "$TIMEOUT" curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" http://cloudflare.com/ 2>/dev/null)"
  REF="${REF_A}/${REF_B}"
  if [[ ! "$REF_A" =~ ^[123] ]] && [[ ! "$REF_B" =~ ^[123] ]]; then
    NET_SANE=0
    warn "this machine cannot make normal HTTP requests (reference sites → ${REF})"
    info "the HTTP/app results below are unreliable — run this script ON the server:"
    info "    bash deploy/check-ports.sh --local"
  fi
fi
http_code() {
  local out
  # curl already prints 000 when it cannot complete the request, so the
  # fallback must not print a second value on top of it.
  out="$(timeout "$TIMEOUT" curl -s -o /dev/null -w '%{http_code}' \
    --max-time "$TIMEOUT" "$1" 2>/dev/null)"
  printf '%s' "${out:-000}"
}

if [[ "${P80:-0}" == "1" ]]; then
  CODE="$(http_code "http://${DOMAIN}/")"
  case "$CODE" in
    000) if [[ $NET_SANE -eq 1 ]]; then
           bad "port 80 accepts connections but no HTTP answer (nginx down?)"
         else
           warn "no HTTP answer on 80 — but this machine's network is unreliable, re-test on the server"
         fi ;;
    30*) ok  "HTTP 80 → $CODE (redirect to HTTPS — that's the correct setup)" ;;
    200) ok  "HTTP 80 → 200" ;;
    *)   warn "HTTP 80 → $CODE" ;;
  esac
else
  bad "skipping HTTP test, port 80 unreachable"
fi

if [[ "${P443:-0}" == "1" ]]; then
  CODE="$(http_code "https://${DOMAIN}/")"
  [[ "$CODE" == "200" ]] && ok "HTTPS 443 → 200" || warn "HTTPS 443 → $CODE"

  if command -v openssl >/dev/null; then
    EXP="$(timeout "$TIMEOUT" bash -c "echo | openssl s_client -servername '$DOMAIN' -connect '${DOMAIN}:443' 2>/dev/null | openssl x509 -noout -enddate" 2>/dev/null | cut -d= -f2)"
    [[ -n "$EXP" ]] && info "TLS certificate expires: $EXP"
  fi
fi

# ---------------------------------------------------------------
head_ "4. Is the app running?"
# ---------------------------------------------------------------
BASE="https://${DOMAIN}"
[[ "${P443:-0}" == "1" ]] || BASE="http://${DOMAIN}"
[[ $LOCAL_MODE -eq 1 ]] && BASE="http://127.0.0.1:3000"

HEALTH="$(timeout "$TIMEOUT" curl -s --max-time "$TIMEOUT" "${BASE}/healthz" 2>/dev/null)"
if grep -q '"ok":true' <<<"$HEALTH"; then
  ok "app is UP → $HEALTH"
  grep -q '"domains":\[\]' <<<"$HEALTH" && info "PUBLIC_DOMAINS is empty (fine for a single domain)"
elif [[ $NET_SANE -eq 0 ]]; then
  warn "could not reach ${BASE}/healthz from this machine (network unreliable here)"
else
  bad "no answer from ${BASE}/healthz"
  info "check: systemctl status ba-man-bebin   |   journalctl -u ba-man-bebin -n 40"
fi

# ---------------------------------------------------------------
head_ "5. WebSocket (required for sync)"
# ---------------------------------------------------------------
# A successful upgrade keeps the connection open, and curl buffers its output,
# so on timeout the status line is lost entirely. Speak HTTP directly instead:
# send the handshake and read back just the first line.
ws_handshake() {
  local host="$1" port="$2" tls="$3"
  local req="GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"

  if [[ "$tls" == "1" ]]; then
    command -v openssl >/dev/null || return 1
    printf '%b' "$req" | timeout "$TIMEOUT" openssl s_client -quiet -servername "$host" \
      -connect "${host}:${port}" 2>/dev/null | head -1
  else
    timeout "$TIMEOUT" bash -c '
      exec 3<>/dev/tcp/'"${host}"'/'"${port}"' || exit 1
      printf "%b" "$1" >&3
      head -1 <&3
    ' _ "$req" 2>/dev/null
  fi
}

if [[ $LOCAL_MODE -eq 1 ]]; then
  WS="$(ws_handshake 127.0.0.1 3000 0)"
elif [[ "${P443:-0}" == "1" ]]; then
  WS="$(ws_handshake "$DOMAIN" 443 1)"
else
  WS="$(ws_handshake "$DOMAIN" 80 0)"
fi

if grep -qi '101' <<<"$WS"; then
  ok "WebSocket upgrade accepted (101)"
elif [[ -n "$WS" ]]; then
  warn "no 101 upgrade — got: ${WS}"
  info "if you use Cloudflare: Network → WebSockets must be ON"
  info "if you use nginx: the /socket.io/ location needs the Upgrade headers"
elif [[ $NET_SANE -eq 0 ]]; then
  warn "could not test WebSockets from this machine"
else
  bad "no response on /socket.io/"
fi

# ---------------------------------------------------------------
printf '\n%s────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"
printf ' %s%d passed%s   %s%d warnings%s   %s%d failed%s\n' \
  "$C_OK" "$PASS" "$C_RESET" "$C_WARN" "$WARN" "$C_RESET" "$C_BAD" "$FAIL" "$C_RESET"

if [[ $FAIL -eq 0 && $WARN -eq 0 ]]; then
  printf ' %s✓ everything looks good — %s is ready%s\n\n' "$C_OK" "$DOMAIN" "$C_RESET"
  exit 0
elif [[ $FAIL -eq 0 ]]; then
  printf ' %s! working, but review the warnings above%s\n\n' "$C_WARN" "$C_RESET"
  exit 0
fi

printf '\n %sMost common fixes:%s\n' "$C_B" "$C_RESET"
printf '   port 80/443 closed  → sudo ufw allow 80/tcp && sudo ufw allow 443/tcp\n'
printf '                       → also open them in your provider'"'"'s firewall panel\n'
printf '   nothing listening   → sudo systemctl restart nginx ba-man-bebin\n'
printf '   DNS wrong           → point the A record at this server, wait a few minutes\n\n'
exit 1
