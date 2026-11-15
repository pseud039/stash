STASH - catch a file from one website, drop it into another. Nothing is saved to Downloads.
Works across Chrome, Edge, Brave and other Chromium browsers at the same time.

SETUP (once, about 2 minutes)

1. Install the helper. Double-click the one for your computer:
     Windows : windows\Install Stash.exe
               (Windows may say "unknown publisher": click More info, then Run anyway.)
     Mac     : mac\Install Stash.command
               (If macOS blocks it: right-click it, choose Open, then Open again.)
     Linux   : run  bash linux/install.sh
   It lists the browsers it found. Then fully close and reopen those browsers.

2. Add the extension to each browser you use:
     open chrome://extensions  (edge://extensions, brave://extensions ...)
     turn on Developer mode, click "Load unpacked", pick the stash-extension folder.

That's it. The helper starts by itself when needed and quits when idle.

USE
  - Click the Stash icon, press "Catch next download", then download the file anywhere.
  - Go to the other site, click where the file should go (upload box / chat),
    open Stash, press Drop.
  - Files live in memory only and vanish after 30 minutes.
  - The popup says "shared across browsers" when the helper is working. If it says
    "this browser only", the helper isn't installed; Stash still works inside one browser.

REMOVE
  Run the same installer from a terminal with --uninstall:  "Install Stash.exe" --uninstall
