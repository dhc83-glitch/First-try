#!/bin/sh
set -eu

if ! node -e 'process.exit(require("./package.json").name === "personal-task-auditor" ? 0 : 1)' 2>/dev/null; then
  echo 'Open Terminal in your First-try-main app folder before running this updater.'
  exit 1
fi

task_auditor_stage=$(mktemp -d "${TMPDIR:-/tmp}/task-auditor-update.XXXXXX")
trap 'rm -rf "$task_auditor_stage"' EXIT
trap 'exit 1' HUP INT TERM
task_auditor_ref=${1:-main}
case "$task_auditor_ref" in
  ''|*[!a-zA-Z0-9._/-]*|*..*) echo 'Invalid update version.'; exit 1 ;;
esac
task_auditor_base="https://raw.githubusercontent.com/dhc83-glitch/First-try/$task_auditor_ref"
task_auditor_files='package.json organizer.js recovery.js automatic.js gmail.js assistant-service.js refresh-job.js cleanup.js home-summary.js home-content.js daily-planner.js correspondence.js server.js assistant.js audit.js notion.js store.js public/index.html public/app.js public/briefing.js public/planning.js public/organizer-ui.js public/style.css README.md PROJECT_GOAL.md test/daily-planner.test.js test/organizer.test.js test/planning.test.js test/recovery.test.js test/briefing.test.js test/home-content.test.js test/correspondence.test.js test/automatic.test.js test/gmail.test.js test/assistant.test.js test/audit.test.js test/notion.test.js test/server.test.js test/refresh-job.test.js test/cleanup.test.js'

echo 'Downloading the app update. Your .env and private .local records will be kept.'
for task_auditor_file in $task_auditor_files; do
  mkdir -p "$task_auditor_stage/$(dirname "$task_auditor_file")"
  curl --fail --location --silent --show-error "$task_auditor_base/$task_auditor_file" -o "$task_auditor_stage/$task_auditor_file"
done
for task_auditor_file in $task_auditor_files; do
  case "$task_auditor_file" in
    *.js) node --check "$task_auditor_stage/$task_auditor_file" ;;
  esac
done

task_auditor_backup=".local/code-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$task_auditor_backup"
for task_auditor_file in $task_auditor_files; do
  if [ -f "$task_auditor_file" ]; then
    mkdir -p "$task_auditor_backup/$(dirname "$task_auditor_file")"
    cp "$task_auditor_file" "$task_auditor_backup/$task_auditor_file"
  fi
done
for task_auditor_file in $task_auditor_files; do
  mkdir -p "$(dirname "$task_auditor_file")"
  cp "$task_auditor_stage/$task_auditor_file" "$task_auditor_file"
done
echo 'Update installed. Your previous code was backed up under .local/code-backups.'
echo 'Start with npm start, reload the browser, then click Refresh my assistant once.'

