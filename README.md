# Stash

A file clipboard for your browser. Catch a file from one website, drop it into another, and **nothing is saved to your Downloads folder**.

Typical use: download files from WhatsApp Web to any website , without the file ever landing on your disk. It works with any site and any file type (PDF, Word, zip, images, anything).

## Pick your setup

| I want to... | Use | Install effort |
|---|---|---|
| Move files **within one browser** | **Setup 1: extension only** | Load one folder |
| Move files **between browsers** (Chrome to Brave, and so on), and want it automatic | **Setup 2: extension + installer** | Double-click an installer, once |
| Move files between browsers, and I'm comfortable with a terminal and Node.js | **Setup 3: extension + manual `server.js`** | Run a script, paste a token |

Start with Setup 1. You can add 2 or 3 later without changing anything else.

## How it works

```
 Site A --download--> Stash extension --> store (RAM only) <-- Stash extension --drop--> Site B
  (any browser)                                                   (same or another browser)
```

- **Extension** (Chrome, Edge, Brave, Vivaldi, Opera): while armed, it intercepts a download and keeps the bytes in memory. On the way out it hands the file to the target page as if you had picked or dragged it.
- **Store**: where the bytes wait. By default that's the browser's own memory, which works in one browser only. With a **bridge** (Setup 2 or 3) it's a small local program's memory, which every browser on your machine can share.
- **Bridge** (optional): listens on `127.0.0.1` only, requires a secret token, deletes items after 30 minutes, and never writes files to disk.

---

## Setup 1: extension only (one browser)

1. Download the latest zip from [Releases](../../releases) and unzip it. (Or clone this repo.)
2. Open the extensions page: `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the `stash-extension` folder.
5. Reload any tabs that were already open, so the extension can attach to them.

The popup will say **this browser only**. That's normal here. You're done; go to [Use](#use).

## Setup 2: add the installer (automatic bridge, between browsers)

Do Setup 1 first, in every browser you want to share files between.

1. Run the installer for your computer:

   | OS | Do this |
   |---|---|
   | **Windows** | Double-click `windows\Install Stash.exe`. If Windows says *unknown publisher*, click **More info, then Run anyway**. |
   | **macOS** | Double-click `mac/Install Stash.command`. If macOS blocks it, right-click it, choose **Open**, then **Open** again. |
   | **Linux** | Run `bash linux/install.sh` |

2. A window opens and prints what it did. Read the **Checking that the bridge can start** part:
   - `OK: the bridge started at http://127.0.0.1:47821` means the helper works.
   - `PROBLEM: ...` means it didn't. The line below it names the log file; see [Checking on the helper](#checking-on-the-helper).
3. **Fully close and reopen the browsers it listed.**
4. Open the Stash popup. It should now say **shared across browsers**.

After this the extension starts the bridge by itself when needed, and the bridge quits after an hour idle. You never enter a token or run a terminal. The bridge runs **hidden** (no window, no console), which is why you won't see it or any output after the installer closes. That's by design.

### Checking on the helper

The installer copies the helper to a fixed place, and it can report on itself. Run these in a terminal (on Windows: Command Prompt or PowerShell):

| OS | Helper location |
|---|---|
| Windows | `%LOCALAPPDATA%\Stash\stash-host.exe` |
| macOS | `~/Library/Application Support/Stash/stash-host` |
| Linux | `~/.local/share/stash/stash-host` |

`stash-host` is not on your PATH, so run it by its full location from the table above. Windows PowerShell needs a `&` in front of a quoted path:

```powershell
& "$env:LOCALAPPDATA\Stash\stash-host.exe" --status
```

Command Prompt takes it without the `&`:

```bat
"%LOCALAPPDATA%\Stash\stash-host.exe" --status
```

On macOS and Linux, run the path directly, for example `~/.local/share/stash/stash-host --status`.

Below, `stash-host` stands for that full path.

| Command | Shows |
|---|---|
| `stash-host --status` | whether it's installed, which browsers it's registered with, whether the bridge is running right now, and the last log lines |
| `stash-host --logs` | the last 60 log lines (bridge started, stopped, errors) |
| `stash-host --token` | the secret token, in case you ever want to use it with a manual bridge entry |

"Bridge running: NO" is normal when you haven't used Stash for a while; the extension starts it on demand. The log never contains file names, file contents or the token.

## Setup 3: add the bridge by hand (`server.js`)

For people who'd rather run a plain script than an installer. Do Setup 1 first, in every browser. You need [Node.js](https://nodejs.org) installed. No packages to install.

1. **Start the server.** In a terminal, from the `stash-bridge` folder:

   ```bash
   node server.js
   ```

   It prints something like:

   ```
   stash bridge on http://127.0.0.1:47821
   token: 3f9c...a1e7
   ```

   Leave it running. The token is also saved in `~/.stash-token` (in your home folder), so you can get it again if you close the terminal.

2. **Connect each browser to it.** Open the Stash popup, expand **bridge (share between browsers)** at the bottom, and fill in:

   | Field | Value |
   |---|---|
   | URL | `http://127.0.0.1:47821` |
   | Token | the long string after `token:` from step 1 |

   Press **Save**. The popup should say **shared across browsers (manual bridge)**. Repeat in every browser.

3. When you're done for the day, close the terminal, or press `Ctrl+C`. Anything held is lost, which is intended.

Notes:

- To use another port: `PORT=50000 node server.js` (Windows PowerShell: `$env:PORT=50000; node server.js`), and put that port in the URL field.
- To choose your own token: set `STASH_TOKEN` before starting. Otherwise one is generated once and reused.
- **Don't run Setup 2 and 3 together.** They use the same port, so the second to start exits. If both are configured, the manual entry in the popup wins.
- To go back to the automatic bridge or to single-browser mode, open the bridge section in the popup and press **Turn off**.

---

## Use

1. Click the Stash icon and press **Catch next download**. The badge turns red (`ON`).
2. Download the file on any site. It goes into memory, not Downloads, and the badge shows how many files are held.
3. Go to the destination site and click the spot where the file belongs, such as the upload box or the chat area.
4. Open the Stash popup and press **Drop**.

Extras:

- **Right-click a link or image, then Stash this (in memory)** grabs it directly.
- **Right-click the page, then Drop latest stash here** drops the newest file.
- **Input** in the popup fills the page's first file input instead of simulating a drag and drop.
- **Keep catching** leaves Stash armed after the first download.
- Files vanish after 30 minutes.

The line under the Stash title tells you which store you're using:

| Popup says | Meaning |
|---|---|
| this browser only (bridge not installed) | Setup 1. Files can't be shared with other browsers. |
| shared across browsers | Setup 2 is working. |
| shared across browsers (manual bridge) | Setup 3 is working. |

## Known limitations

- **Unsigned installers.** Windows SmartScreen and macOS Gatekeeper will warn about an unknown publisher. Signing needs a paid certificate. Setup 3 avoids this entirely.
- **WhatsApp Web and other apps with custom upload code** may ignore a simulated drop, or trigger downloads in a way the extension doesn't catch. Sites change, so this may need tweaks.
- **Files are held as base64 in RAM**, so a file costs roughly 1.4 times its size. Very large files are a poor fit.
- **Plain-link downloads** can start briefly before the extension cancels and refetches them. Links that need more than your cookies to authenticate may fall back to a normal download. Blob downloads are unaffected.
- **Drop targets the top frame** of a page only, not iframes.
- **Linux Snap or Flatpak browsers** keep their data elsewhere, so the installer in Setup 2 won't find them.
- **Restarting the bridge empties it.** Files are gone if the bridge idles out, the machine reboots, or you reinstall.

## Security notes

- The bridge binds to `127.0.0.1` and rejects every request without the secret token.
- In Setup 2 the token lives in a private file in the Stash data folder, and only the pinned extension ID is allowed to fetch it. In Setup 3 it's in `~/.stash-token` or your `STASH_TOKEN`.
- Anything on your machine that can read the token can use the bridge. Treat it like any other local credential.
- Stash never writes the files to disk. They exist only in memory while they travel.
- The extension asks for access to all sites, because it has to work on any site you download from or drop into. Read the code, it's small.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Popup says **this browser only** after Setup 2 | Read the orange line under it: the popup explains why in plain words. Usually the installer hasn't run for this browser, or the browser wasn't fully restarted. Run `stash-host --status` to see what's registered. |
| Orange line mentions an extension ID not matching | You loaded a copy of the extension instead of the one from this package. Setup 2 only trusts the package's ID. Load `stash-extension` from the package. |
| `Specified native messaging host not found` on the extensions page | The helper isn't registered for this browser. Rerun the installer, then fully restart the browser. |
| Installer printed `PROBLEM` | Run `stash-host --logs` for the reason. If the port is in use, another program is on port 47821. |
| Badge shows `!` | A bridge is configured but not answering. In Setup 3, check that `node server.js` is still running. In Setup 2, reload the extension, then rerun the installer if needed. |
| "bridge unreachable (is server.js running?)" | Setup 3: the server isn't running, or the port in the URL field doesn't match. |
| "bridge rejected the token" | Setup 3: the token in the popup doesn't match the one the server printed. Copy it again from the terminal or `~/.stash-token`. Setup 2: the token file was recreated; reload the extension. |
| Drop does nothing | Click directly on the upload area first, then press Drop. Try **Input** instead. Reload the tab if you installed the extension while it was open. |
| Download still lands in Downloads | Stash wasn't armed, or the site starts the download in a way the hook missed. Try right-click, then Stash this. |

## Remove

- **Extension:** remove it from each browser's extensions page.
- **Setup 2 (installer):**
  - Windows: `"%LOCALAPPDATA%\Stash\stash-host.exe" --uninstall`
  - macOS: `"$HOME/Library/Application Support/Stash/stash-host" --uninstall`
  - Linux: `~/.local/share/stash/stash-host --uninstall`

  This removes the helper, the token and the log.
- **Setup 3 (`server.js`):** stop the server, and delete `~/.stash-token` if you want the token gone.

## Build from source

Setup 2's installer needs [Go](https://go.dev/dl/) 1.21 or newer to build. There are no other dependencies. Setups 1 and 3 need no build step.

```bash
cd stash-host

# for this machine
go build -o stash-host .

# for every platform
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "Install Stash.exe" .
CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o stash-host-arm64 .
CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o stash-host-x86_64 .
CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o stash-host-x86_64 .
CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o stash-host-aarch64 .
```

The one program has three modes. Running it with no arguments installs it. `--serve` runs the bridge. When a browser launches it, it acts as the native messaging helper that starts the bridge on demand.

**If you fork this and change the extension ID** (by replacing the `key` in `manifest.json`), update the `extensionID` constant in `stash-host/main.go` to match, then rebuild. The two must agree, or browsers will refuse to talk to the helper. Setups 1 and 3 aren't affected.

## Repository layout

```
stash-extension/   the browser extension (load unpacked)
  manifest.json    pinned ID via "key"
  background.js    store selection, download interception, context menus
  content.js       bridge between page and extension, drop logic
  hook.js          page-world hook that catches blob downloads
  offscreen.js     in-browser store used when no bridge is configured
  popup.html/js    the UI, including the manual bridge settings
stash-bridge/      server.js: the manual bridge for Setup 3 (Node, no dependencies)
stash-host/        the Go helper for Setup 2: bridge server, native messaging, installer
```

## Bridge protocol (for hacking on it)

Both bridges (`server.js` and the Go one) speak the same protocol: `POST http://127.0.0.1:47821/op` with header `x-stash-token` and a JSON body `{ "op": ..., ... }`.

| op | fields | returns |
|---|---|---|
| `begin` | `id, name, mime, size` | `{ok}` |
| `chunk` | `id, b64` | `{ok}` |
| `end` | `id` | `{ok}` |
| `list` | | array of `{id, name, mime, size, ts}` |
| `meta` | `id` | `{name, mime, size, chunks}` or `null` |
| `get` | `id, i` | `{b64}` |
| `remove` | `id` | `{ok}` |
| `clear` | | `{ok}` |

Files move in 1 MiB chunks, base64 encoded.
