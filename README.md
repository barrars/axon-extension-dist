# Evidence.com Data Aggregator — installable build

Current build: **v2026.11.20.5**

This repository contains the **built extension only** — nothing else, and no case
data. It is what the installer downloads and what the extension checks for updates.

Chrome won't let an extension replace its own files, so installing means telling
Chrome to load this folder ("Load unpacked"). The installer does the downloading
and unpacking; you do the last three clicks. Everything you collect is stored in
your Chrome profile, so reinstalling or updating never touches your data.

---

## Install on Windows

Open **PowerShell** (press `Win`, type `powershell`, press Enter) and paste:

```powershell
irm https://raw.githubusercontent.com/barrars/axon-extension-dist/main/install-extension.ps1 | iex
```

Or download [install-extension.bat](https://raw.githubusercontent.com/barrars/axon-extension-dist/main/install-extension.bat)
and double-click it.

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose `%LOCALAPPDATA%\AxonExtension`

## Install on macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/barrars/axon-extension-dist/main/install-extension.sh | bash
```

Then, in Chrome: `chrome://extensions` → **Developer mode** (top right) →
**Load unpacked** → `~/AxonExtension`.

---

## Updating

The popup shows the version it is running and tells you when a newer build exists
(click the version to check immediately). To install it:

- **Easiest:** re-run the same installer command as above. It replaces the files
  in place, and the popup then says "Reload" is needed.
- **Or:** click the banner's **Download update**, unzip it over the folder, and
  press the reload arrow on the extension's card.

Then click the **reload** arrow (↻) on the extension card, or restart Chrome.

## Uninstalling

`chrome://extensions` → **Remove**. Then delete the folder
(`%LOCALAPPDATA%\AxonExtension` or `~/AxonExtension`).
To also clear collected data: open the extension's popup → **Clear All Data**
before removing it.

---

## Notes

- **Developer mode must stay on.** Chrome disables unpacked extensions the moment
  that toggle is turned off — if the extension suddenly disappears, that is why.
- **Versions are dates:** `v2026.11.20` is a build from 20 Nov 2026; `v2026.11.20.2`
  is the third build released that day.
- **Signing in is per browser profile.** The extension sees evidence.com (and the
  newer evidence.*.axon.com) pages in the profile it is installed in.
- If Chrome says the folder is invalid, the download was probably incomplete —
  re-run the installer.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `developer mode is off` / extension vanished | `chrome://extensions` → toggle Developer mode back on |
| PowerShell says *running scripts is disabled* | use the `irm … \| iex` command exactly as written (it bypasses the policy for that one run) |
| `Load unpacked` refuses the folder | confirm it contains `manifest.json`; re-run the installer |
| Update banner never appears | that copy predates the updater — reinstall once with the command above |
