#!/usr/bin/env bash
# READ-ONLY inspection of a target server. Changes nothing. Run this first and send the output
# back so a deployment plan can be written. No secrets are read or printed.
set -u
echo "### OS";            (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); uname -srm
echo "### user";          id -un; sudo -n true 2>/dev/null && echo "sudo: passwordless" || echo "sudo: needs password / not available"
echo "### resources";     nproc; free -h | sed -n 1,2p; df -h / | tail -1
echo "### node/npm";      command -v node && node -v; command -v npm && npm -v
echo "### pm2";           command -v pm2 && pm2 -v
echo "### nginx";         command -v nginx && nginx -v 2>&1
echo "### certbot";       command -v certbot && certbot --version 2>&1
echo "### listening ports"; (ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null) | head -30
echo "### services";      systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -30
echo "### firewall";      (command -v ufw >/dev/null && sudo -n ufw status 2>/dev/null) || echo "ufw: not available / needs sudo"
echo "### sshd";          grep -E '^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication)' /etc/ssh/sshd_config 2>/dev/null || echo "sshd_config not readable"
echo "### existing sites"; ls -1 /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -20
echo "### app dir";       ls -ld /var/www /var/www/talentbridge 2>/dev/null
