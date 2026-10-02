/* ============================================================
   Type — shell sessions

   A short challenge is one command. A medium one is a session of four or five
   commands that belong together (make a folder, go into it, make a file, look
   at it); a long one is two sessions back to back. The player types every
   command and presses Enter between them, which is the part of a terminal a
   single line never teaches.

   The prompt is part of the picture, not of the text: it shows where you are,
   it follows `cd`, and it is never typed. Where a command has an obvious
   result it carries one, shown once the line is done.

   Shells: bash, zsh and fish share the Unix scenarios; PowerShell and cmd have
   their own; Python and SQLite are REPLs. Holes are ‹filled› per challenge by
   fill.js, so the same scenario never reads the same twice.
   ============================================================ */

import { makeFiller } from "./fill.js";

/* A step is a command, or [command, output]. */

const UNIX = [
  // a project from nothing
  [["mkdir -p ‹dir›/‹dir2›"], ["cd ‹dir›/‹dir2›"], ["touch ‹file› ‹file2›"], ["ls -la", "total 8\n-rw-r--r-- 1 ‹user› ‹user› 0 ‹file›\n-rw-r--r-- 1 ‹user› ‹user› 0 ‹file2›"], ["echo \"‹sentence›\" > ‹file›"], ["cat ‹file›", "‹sentence›"]],
  // git, from init
  [["git init", "Initialized empty Git repository"], ["git add ."], ["git commit -m \"‹msg›\"", "[main (root-commit) ‹sha›] ‹msg›"], ["git branch ‹branch›"], ["git checkout ‹branch›", "Switched to branch '‹branch›'"], ["git log --oneline", "‹sha› ‹msg›"]],
  // git, from clone
  [["git clone https://github.com/‹user›/‹name›.git", "Cloning into '‹name›'..."], ["cd ‹name›"], ["git checkout -b ‹branch›"], ["git status", "On branch ‹branch›\nnothing to commit, working tree clean"], ["git push -u origin ‹branch›"]],
  // hunting through logs
  [["cd /var/log"], ["ls -lh | head"], ["grep -i error syslog | tail -n ‹n›"], ["wc -l syslog"], ["sudo tail -f auth.log"]],
  // archive and compare
  [["tar -czf ‹name›.tar.gz ‹dir›"], ["ls -lh ‹name›.tar.gz"], ["mkdir ‹dir2›"], ["tar -xzf ‹name›.tar.gz -C ‹dir2›"], ["diff -r ‹dir› ‹dir2›/‹dir›"]],
  // search and replace
  [["grep -rn \"‹word›\" ./src"], ["sed -i 's/‹word›/‹word2›/g' ‹file›"], ["find . -name \"*.‹ext›\" -mtime -‹n›"], ["sort ‹file› | uniq -c | sort -nr | head -n 5"]],
  // permissions
  [["touch ‹name›.sh"], ["chmod +x ‹name›.sh"], ["ls -l ‹name›.sh", "-rwxr-xr-x 1 ‹user› ‹user› 0 ‹name›.sh"], ["./‹name›.sh --help"], ["sudo chown ‹user›:‹user› ‹name›.sh"]],
  // the network
  [["ping -c 3 ‹domain›"], ["curl -I https://‹domain›", "HTTP/2 200"], ["ss -tuln | grep ‹port›"], ["dig +short ‹domain›"], ["ssh ‹user›@‹host›.‹domain›"]],
  // what is eating the machine
  [["ps aux | grep ‹word›"], ["top -b -n 1 | head -n 5"], ["kill -9 ‹pid›"], ["df -h"], ["du -sh ‹dir›/*"], ["free -m"]],
  // docker
  [["docker pull ‹img›"], ["docker run -d --name ‹name› -p ‹port›:80 ‹img›"], ["docker ps"], ["docker logs -f ‹name›"], ["docker stop ‹name›", "‹name›"], ["docker rm ‹name›", "‹name›"]],
  // node
  [["npm init -y"], ["npm install ‹pkg›"], ["npm run build"], ["npm test", "Tests: all passed"], ["node ‹name›.js"]],
  // python
  [["python3 -m venv .venv"], ["source .venv/bin/activate"], ["pip install ‹pkg›"], ["pip freeze > requirements.txt"], ["python3 ‹name›.py"]],
  // kubernetes
  [["kubectl get pods -n ‹name›"], ["kubectl describe pod ‹name›-‹n›"], ["kubectl logs ‹name›-‹n› --tail=‹n›"], ["kubectl rollout restart deployment/‹name›"]],
  // services
  [["systemctl status ‹name›"], ["sudo systemctl restart ‹name›"], ["journalctl -u ‹name› --since \"10 min ago\""], ["sudo systemctl enable ‹name›"]],
  // a pipeline of small tools
  [["cat ‹file› | tr '[:upper:]' '[:lower:]' | sort | uniq"], ["cut -d, -f1,3 ‹name›.csv | head -n ‹n›"], ["awk '{print $1}' ‹file› | sort -u | wc -l"], ["tail -n ‹n› ‹file› > ‹file2›"]],
  // keeping a copy somewhere else
  [["crontab -l"], ["rsync -avz ./‹dir›/ ‹user›@‹host›:/backups/‹dir›/"], ["scp ‹file› ‹user›@‹host›:~/‹dir›/"], ["ssh ‹user›@‹host› 'ls -lh ~/‹dir›'"]],
  // environment
  [["echo $PATH"], ["export ‹upper›=‹word›"], ["env | grep ‹upper›"], ["alias ll='ls -alF'"], ["history | tail -n ‹n›"]]
];

const UNIX_ONE = [
  "ls -lhS | head -n ‹n›", "find . -type f -name \"*.‹ext›\" -size +‹big›k", "grep -rIn --include=\"*.‹ext›\" \"‹word›\" .", "du -ah . | sort -rh | head -n ‹n›",
  "tar -czvf backup-‹big›.tar.gz ‹dir›/", "ps -eo pid,ppid,cmd,%mem --sort=-%mem | head", "sed -n '‹n›,‹big›p' ‹file›", "awk -F, '{sum += $3} END {print sum}' ‹name›.csv",
  "find /tmp -type f -mtime +‹n› -delete", "xargs -I{} cp {} ‹dir›/ < ‹file›", "curl -s https://‹domain›/api/‹name› | jq '.items[0]'", "for f in *.‹ext›; do mv \"$f\" \"${f%.‹ext›}.bak\"; done",
  "chmod -R 755 ‹dir›", "ln -s /opt/‹name›/bin/‹name› ~/bin/‹name›", "watch -n ‹n› 'df -h | grep sda'", "ssh -L ‹port›:localhost:‹port2› ‹user›@‹host›.‹domain›",
  "git log --graph --oneline --decorate -n ‹n›", "git diff --stat HEAD~‹n›", "git stash push -m \"‹msg›\"", "git rebase -i HEAD~‹n›",
  "docker exec -it ‹name› sh", "docker build -t ‹name›:‹ver› .", "docker compose up -d --build", "kubectl get pods -A | grep -v Running",
  "journalctl -xe --no-pager | tail -n ‹big›", "sort -t, -k2 -nr ‹name›.csv | head -n ‹n›", "nl -ba ‹file› | sed -n '‹n›,‹big›p'", "find . -empty -type d -print",
  "echo \"‹sentence›\" | base64", "head -c ‹big› /dev/urandom | sha256sum", "lsof -i :‹port›", "nc -zv ‹host›.‹domain› ‹port›",
  "cp -r ‹dir› ‹dir›-backup-$(date +%F)", "rg -n \"TODO|FIXME\" --glob '*.‹ext›'", "ffmpeg -i ‹name›.mp4 -vn -acodec copy ‹name›.aac", "openssl rand -hex ‹n›",
  "npm install --save-dev ‹pkg›@^‹ver›", "pip install -r requirements.txt --upgrade", "cargo build --release", "go test ./... -run ‹idp› -v"
];

const PS = [
  [["Get-ChildItem -Path . -Recurse -Filter *.‹ext›"], ["Set-Location ‹dir›"], ["New-Item -ItemType File -Name ‹file›"], ["Get-Content ‹file›"], ["Copy-Item ‹file› ‹file2›"]],
  [["Get-Process | Sort-Object CPU -Descending | Select-Object -First ‹n›"], ["Stop-Process -Name ‹word› -Force"], ["Get-Service | Where-Object { $_.Status -eq 'Running' }"], ["Restart-Service -Name ‹name›"]],
  [["$items = Import-Csv .\\‹name›.csv"], ["$items | Where-Object { [int]$_.Total -gt ‹big› }"], ["$items | Export-Csv .\\filtered.csv -NoTypeInformation"], ["$items.Count"]],
  [["Test-Connection ‹domain› -Count 3"], ["Invoke-WebRequest https://‹domain› | Select-Object StatusCode"], ["Get-NetIPAddress -AddressFamily IPv4"], ["Test-NetConnection ‹domain› -Port 443"]],
  [["$env:PATH -split ';'"], ["[Environment]::SetEnvironmentVariable('‹upper›', '‹word›', 'User')"], ["Get-ChildItem Env: | Where-Object Name -like '‹upper›*'"]],
  [["foreach ($f in Get-ChildItem *.‹ext›) { Rename-Item $f ($f.BaseName + '.bak') }"], ["1..‹n› | ForEach-Object { $_ * 2 }"], ["Get-Date -Format yyyy-MM-dd"], ["Get-Help Get-ChildItem -Examples"]],
  [["New-Item -ItemType Directory -Path .\\‹dir›"], ["Set-Location .\\‹dir›"], ["'‹sentence›' | Out-File ‹file›"], ["Get-Item ‹file› | Select-Object Name, Length"], ["Remove-Item ‹file›"]]
];

const PS_ONE = [
  "Get-ChildItem -Recurse | Measure-Object -Property Length -Sum", "Get-Content ‹file› -Tail ‹n› -Wait", "Get-EventLog -LogName System -Newest ‹n› | Format-Table -AutoSize",
  "Select-String -Path *.‹ext› -Pattern '‹word›' -CaseSensitive", "Get-Process | Where-Object { $_.WS -gt ‹big›MB } | Select-Object Name, Id", "Compress-Archive -Path .\\‹dir›\\* -DestinationPath .\\‹name›.zip",
  "Get-ChildItem *.‹ext› | Rename-Item -NewName { $_.Name -replace '‹word›','‹word2›' }", "$PSVersionTable.PSVersion", "Get-Command -Module Microsoft.PowerShell.Management | Select-Object -First ‹n›",
  "Invoke-RestMethod -Uri https://‹domain›/api/‹name› | ConvertTo-Json -Depth 3", "Get-Volume | Select-Object DriveLetter, SizeRemaining", "Set-ExecutionPolicy -Scope CurrentUser RemoteSigned",
  "Get-Service -Name ‹name›* | Format-List Name, Status, StartType", "(Get-Content ‹file›).Count", "winget install --id ‹pkg› -e", "Get-ChildItem -Path C:\\ -Include *.‹ext› -File -Recurse -ErrorAction SilentlyContinue"
];

const CMD = [
  [["mkdir ‹dir›"], ["cd ‹dir›"], ["echo ‹sentence› > ‹file›"], ["type ‹file›"], ["dir"], ["copy ‹file› ‹file2›"], ["del ‹file2›"]],
  [["ipconfig /all"], ["ping -n 4 ‹domain›"], ["nslookup ‹domain›"], ["tracert ‹domain›"], ["netstat -ano | findstr :‹port›"]],
  [["tasklist | findstr ‹word›"], ["taskkill /F /IM ‹word›.exe"], ["systeminfo | findstr /B /C:\"OS Name\""], ["where python"], ["set PATH"]],
  [["robocopy C:\\‹dir› D:\\‹dir› /E /Z"], ["attrib +h ‹file›"], ["ren ‹file› ‹file2›"], ["tree /F"]],
  [["md ‹dir›\\‹dir2›"], ["cd ‹dir›\\‹dir2›"], ["echo ‹word› > ‹file›"], ["echo ‹word2› >> ‹file›"], ["type ‹file›"], ["find /c /v \"\" ‹file›"]],
  [["set ‹upper›=‹word›"], ["echo %‹upper›%"], ["setx ‹upper2› ‹word2›"], ["path"], ["doskey ll=dir /w"]],
  [["wmic cpu get name"], ["hostname"], ["whoami"], ["net user ‹user›"], ["ipconfig /flushdns"]]
];

const CMD_ONE = [
  "dir /s /b *.‹ext›", "findstr /s /i \"‹word›\" *.‹ext›", "for %f in (*.‹ext›) do echo %f", "xcopy ‹dir› ‹dir›-backup /E /I /Y", "schtasks /query /fo LIST /v",
  "netsh wlan show profiles", "sc query ‹name›", "wmic logicaldisk get size,freespace,caption", "reg query HKCU\\Environment /v PATH", "chkdsk C: /scan", "where /r C:\\ ‹name›.exe", "ver"
];

const PY = [
  [["import os, sys"], ["os.listdir('.')"], ["[f for f in os.listdir('.') if f.endswith('.‹ext›')]"], ["len(sys.argv)"], ["sys.version_info[:2]"]],
  [["‹ids› = [x * ‹n› for x in range(‹n2›)]"], ["sum(‹ids›)"], ["sorted(‹ids›, reverse=True)[:3]"], ["dict(zip('abc', ‹ids›))"]],
  [["from collections import Counter"], ["c = Counter('‹sentence›')"], ["c.most_common(3)"], ["len(c)"]],
  [["import json"], ["data = json.loads('{\"‹ids›\": ‹n›}')"], ["data['‹ids›'] += ‹n2›"], ["json.dumps(data, indent=2)"]],
  [["words = '‹sentence›'.split()"], ["len(words)"], ["max(words, key=len)"], ["' '.join(reversed(words))"], ["sorted(words)[:‹n›]"]],
  [["‹ids› = lambda x: x * ‹n›"], ["‹ids›(‹n2›)"], ["list(map(‹ids›, range(‹n3›)))"], ["any(v > ‹big› for v in map(‹ids›, range(‹n3›)))"]],
  [["import random"], ["random.seed(‹big›)"], ["[random.randint(1, ‹n›) for _ in range(‹n2›)]"], ["random.choice(['‹word›', '‹word2›', '‹word3›'])"]]
];
const PY_ONE = ["{k: v for k, v in zip('abcde', range(‹n›))}", "[x ** 2 for x in range(‹n›) if x % 2]", "import json; json.dumps({'‹name›': ‹n›})", "'-'.join(sorted(set('‹sentence›'.split())))", "help(str.split)", "import this", "list(map(str.upper, ['‹word›', '‹word2›']))", "sum(1 for _ in open('‹file›'))"];

const SQL = [
  [[".open ‹name›.db"], [".tables"], ["CREATE TABLE ‹ids› (id INTEGER PRIMARY KEY, ‹ids2› TEXT);"], ["INSERT INTO ‹ids› (‹ids2›) VALUES ('‹word›');"], ["SELECT * FROM ‹ids›;"]],
  [["SELECT ‹ids2›, COUNT(*) FROM ‹ids› GROUP BY ‹ids2›;"], ["SELECT * FROM ‹ids› ORDER BY id DESC LIMIT ‹n›;"], [".schema ‹ids›"], [".quit"]],
  [[".headers on"], [".mode csv"], [".import ‹name›.csv ‹ids›"], ["SELECT COUNT(*) FROM ‹ids›;"], [".output ‹file›"], ["SELECT * FROM ‹ids› WHERE id < ‹n›;"]],
  [["BEGIN;"], ["UPDATE ‹ids› SET ‹ids2› = ‹ids2› + ‹n› WHERE id = ‹n2›;"], ["SELECT ‹ids2› FROM ‹ids› WHERE id = ‹n2›;"], ["ROLLBACK;"]],
  [["CREATE VIEW ‹ids› AS SELECT id, ‹ids2› FROM ‹ids3› WHERE id > ‹n›;"], ["SELECT * FROM ‹ids› LIMIT ‹n2›;"], [".tables"], ["DROP VIEW ‹ids›;"]]
];
const SQL_ONE = ["SELECT name FROM sqlite_master WHERE type = 'table';", "UPDATE ‹ids› SET ‹ids2› = '‹word›' WHERE id = ‹n›;", "DELETE FROM ‹ids› WHERE id > ‹big›;", "CREATE INDEX idx_‹ids› ON ‹ids› (‹ids2›);", "SELECT a.id, b.‹ids2› FROM ‹ids› a JOIN ‹ids2› b ON b.id = a.id;", ".mode column", "PRAGMA table_info(‹ids›);"];

const SHELLS = {
  bash: { family: "unix", sess: UNIX, one: UNIX_ONE, home: "~", weight: 30 },
  zsh: { family: "unix", sess: UNIX, one: UNIX_ONE, home: "~", weight: 14 },
  fish: { family: "unix", sess: UNIX, one: UNIX_ONE, home: "~", weight: 6 },
  powershell: { family: "ps", sess: PS, one: PS_ONE, weight: 24 },
  cmd: { family: "cmd", sess: CMD, one: CMD_ONE, weight: 10 },
  python: { family: "repl", sess: PY, one: PY_ONE, weight: 9 },
  sqlite: { family: "repl", sess: SQL, one: SQL_ONE, weight: 7 }
};

const COUNT = { short: 1, medium: [4, 6], long: [8, 11] };

/* ---------- following the working directory ---------- */

function nextCwd(shell, cwd, cmd) {
  const m = /^(?:cd|Set-Location|sl|chdir)\s+(?:\/d\s+)?(\S+)$/i.exec(cmd);
  if (!m) return cwd;
  const to = m[1];
  const fam = SHELLS[shell].family;
  const sep = fam === "unix" ? "/" : "\\";
  if (to === "~") return fam === "unix" ? "~" : cwd;
  if (to === "..") {
    const i = cwd.lastIndexOf(sep);
    return i <= 0 || cwd === "~" ? cwd : cwd.slice(0, i);
  }
  if ((fam === "unix" && to[0] === "/") || (fam !== "unix" && /^[A-Za-z]:/.test(to))) return to;
  return cwd + sep + to.replace(/^\.[\\/]/, "").replace(/[\\/]/g, sep);
}

function prompt(shell, user, host, cwd) {
  switch (shell) {
    case "bash": return user + "@" + host + ":" + cwd + "$";
    case "zsh": return cwd + " %";
    case "fish": return user + "@" + host + " " + cwd + ">";
    case "powershell": return "PS " + cwd + ">";
    case "cmd": return cwd + ">";
    case "python": return ">>>";
    default: return "sqlite>";
  }
}

export function genTerminal(rng, length) {
  const names = Object.keys(SHELLS);
  let r = rng.next() * names.reduce((s, k) => s + SHELLS[k].weight, 0), shell = names[0];
  for (const k of names) { r -= SHELLS[k].weight; if (r <= 0) { shell = k; break; } }
  const def = SHELLS[shell];
  const fill = makeFiller(rng);
  const user = rng.pick(["ana", "bob", "cris", "dev", "kim", "leo", "mara", "nico"]), host = rng.pick(["alpha", "falcon", "harbor", "juniper", "kestrel", "maple", "nimbus", "orbit"]);

  let raw = [];
  if (length === "short") {
    raw = [[rng.pick(def.one)]];
  } else {
    const [lo, hi] = COUNT[length] || COUNT.medium;
    const want = rng.int(lo, hi);
    let pool = rng.shuffle(def.sess);
    for (let i = 0; raw.length < want && i < pool.length; i++) raw = raw.concat(pool[i]);
    raw = raw.slice(0, Math.max(want, 3));
    // a lone line that is not a session's start still needs to make sense: sessions are written to be cut anywhere after step three
  }
  const winHome = "C:\\Users\\" + user;
  let cwd = def.family === "unix" ? "~" : def.family === "ps" || def.family === "cmd" ? winHome : "";
  const lines = [];
  for (const step of raw) {
    const cmd = fill(step[0]);
    const out = step[1] ? fill(step[1]) : "";
    lines.push({ prompt: prompt(shell, user, host, cwd), cmd, out });
    cwd = nextCwd(shell, cwd, cmd);
  }
  return { kind: "terminal", shell, lines, text: lines.map((l) => l.cmd).join("\n") };
}

export const SHELL_NAMES = Object.keys(SHELLS);
export const TERMINAL_POOL_SIZE = Object.values(SHELLS).reduce((s, d) => s + d.one.length + d.sess.length, 0);
