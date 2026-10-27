#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null; then
  /usr/bin/osascript -e 'display alert "Node.js is needed" message "Install Node.js 24 LTS from nodejs.org, then open this installer again."'
  exit 1
fi
assistant_target=$(/usr/bin/osascript -e 'POSIX path of (choose folder with prompt "Choose the EXISTING First-try app folder containing your saved settings. Do not choose this downloaded update folder.")') || exit 1
node bootstrap-install.js "$assistant_target"
if [ $? -ne 0 ]; then
  /usr/bin/osascript -e 'display alert "Assistant update stopped" message "No successful installation was confirmed. Read the message in this window. Your saved settings and records are preserved."'
  read -r -p "Press Enter to close."
fi
