package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Pinned by the "key" field in the extension's manifest.json, so it is the same in every Chromium browser.
const extensionID = "ohgmldemfclgfpaejbcdelokaombcbjk"
const hostName = "com.stash.bridge"

// Where the installed copy of this program, its manifest and the token live.
func dataDir() string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "Stash")
		}
		return filepath.Join(home, "AppData", "Local", "Stash")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Stash")
	}
	if d := os.Getenv("XDG_DATA_HOME"); d != "" {
		return filepath.Join(d, "stash")
	}
	return filepath.Join(home, ".local", "share", "stash")
}

func main() {
	args := os.Args[1:]
	first := ""
	if len(args) > 0 {
		first = args[0]
	}
	switch {
	case first == "--serve":
		serve()
	case strings.HasPrefix(first, "chrome-extension://"):
		native() // launched by the browser (Windows adds --parent-window as a second arg)
	case first == "--uninstall":
		uninstall()
		pause()
	case first == "--status":
		status()
	case first == "--token":
		fmt.Println(readToken())
	case first == "--logs":
		for _, l := range tailLog(60) {
			fmt.Println(l)
		}
	default: // no args (double-click) or --install
		install()
		pause()
	}
}
