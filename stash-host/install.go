package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

type browser struct {
	name string
	dir  string // Linux/macOS: the browser's profile root; its NativeMessagingHosts folder sits inside
	reg  string // Windows: registry path under HKCU\Software
}

func browsers() []browser {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		return []browser{
			{name: "Chrome", reg: `Google\Chrome`},
			{name: "Edge", reg: `Microsoft\Edge`},
			{name: "Brave", reg: `BraveSoftware\Brave-Browser`},
			{name: "Chromium", reg: `Chromium`},
			{name: "Vivaldi", reg: `Vivaldi`},
		}
	case "darwin":
		a := filepath.Join(home, "Library", "Application Support")
		return []browser{
			{name: "Chrome", dir: filepath.Join(a, "Google", "Chrome")},
			{name: "Edge", dir: filepath.Join(a, "Microsoft Edge")},
			{name: "Brave", dir: filepath.Join(a, "BraveSoftware", "Brave-Browser")},
			{name: "Chromium", dir: filepath.Join(a, "Chromium")},
			{name: "Vivaldi", dir: filepath.Join(a, "Vivaldi")},
			{name: "Opera", dir: filepath.Join(a, "com.operasoftware.Opera")},
		}
	}
	c := filepath.Join(home, ".config")
	return []browser{
		{name: "Chrome", dir: filepath.Join(c, "google-chrome")},
		{name: "Edge", dir: filepath.Join(c, "microsoft-edge")},
		{name: "Brave", dir: filepath.Join(c, "BraveSoftware", "Brave-Browser")},
		{name: "Chromium", dir: filepath.Join(c, "chromium")},
		{name: "Vivaldi", dir: filepath.Join(c, "vivaldi")},
		{name: "Opera", dir: filepath.Join(c, "opera")},
	}
}

func exeName() string {
	if runtime.GOOS == "windows" {
		return "stash-host.exe"
	}
	return "stash-host"
}

func copyFile(src, dst string) error {
	if a, _ := filepath.Abs(src); a == dst {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		// Windows refuses to delete a running .exe but allows renaming it: move the old one aside
		os.Remove(dst + ".old")
		os.Rename(dst, dst+".old")
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func writeManifest(path, exe string) error {
	m := map[string]any{
		"name":            hostName,
		"description":     "Stash bridge launcher",
		"path":            exe,
		"type":            "stdio",
		"allowed_origins": []string{"chrome-extension://" + extensionID + "/"},
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	return os.WriteFile(path, b, 0o644)
}

func install() {
	fmt.Println("Installing Stash bridge...")
	self, err := os.Executable()
	if err != nil {
		fail("cannot find installer path", err)
		return
	}
	dd := dataDir()
	if err := os.MkdirAll(dd, 0o700); err != nil {
		fail("cannot create "+dd, err)
		return
	}
	exe := filepath.Join(dd, exeName())
	if err := copyFile(self, exe); err != nil {
		fail("cannot copy program to "+exe, err)
		return
	}
	if runtime.GOOS == "darwin" {
		exec.Command("xattr", "-dr", "com.apple.quarantine", exe).Run() // best effort: avoids the Gatekeeper block
	}
	manifest := filepath.Join(dd, hostName+".json")
	if err := writeManifest(manifest, exe); err != nil {
		fail("cannot write manifest", err)
		return
	}

	done := []string{}
	for _, b := range browsers() {
		if runtime.GOOS == "windows" {
			key := `HKCU\Software\` + b.reg + `\NativeMessagingHosts\` + hostName
			// only touch browsers that exist: their parent key is there if installed
			if exec.Command("reg", "query", `HKCU\Software\`+b.reg).Run() != nil {
				continue
			}
			if exec.Command("reg", "add", key, "/ve", "/t", "REG_SZ", "/d", manifest, "/f").Run() == nil {
				done = append(done, b.name)
			}
			continue
		}
		if st, err := os.Stat(b.dir); err != nil || !st.IsDir() {
			continue
		}
		nm := filepath.Join(b.dir, "NativeMessagingHosts")
		if os.MkdirAll(nm, 0o755) == nil && writeManifest(filepath.Join(nm, hostName+".json"), exe) == nil {
			done = append(done, b.name)
		}
	}

	logf("install: copied to %s, registered with %v", exe, done)
	if len(done) == 0 {
		fmt.Println("\nInstalled, but no supported browser was found.")
		fmt.Println("Open Chrome, Edge or Brave once, then run this installer again.")
		return
	}
	fmt.Println("\nRegistered with:")
	for _, n := range done {
		fmt.Println("  - " + n)
	}

	// Prove the helper really works, instead of leaving the person to guess.
	fmt.Println("\nChecking that the bridge can start...")
	serveExe = exe // run the installed copy, not this installer, so the installer can be moved or deleted
	if r := ensureServer(); r["error"] != nil {
		fmt.Printf("  PROBLEM: %v\n  Details: %s\n", r["error"], logPath())
	} else {
		fmt.Println("  OK: the bridge started at", r["url"])
		fmt.Println("  It runs hidden in the background (no window, no token to copy), and quits when idle.")
	}

	fmt.Println("\nNext:")
	fmt.Println("  1. Fully close and reopen: " + strings.Join(done, ", "))
	fmt.Println("  2. Load the Stash extension in each one (chrome://extensions > Developer mode > Load unpacked).")
	fmt.Println("  3. Open the Stash popup. It should say \"shared across browsers\".")
	fmt.Println("\nTo check on the helper later, run one of these in a terminal:")
	if runtime.GOOS == "windows" {
		fmt.Printf("  PowerShell:      & \"%s\" --status\n", exe)
		fmt.Printf("  Command Prompt:  \"%s\" --status\n", exe)
		fmt.Println("  (use --logs instead of --status to see the log)")
	} else {
		fmt.Printf("  \"%s\" --status\n  \"%s\" --logs\n", exe, exe)
	}
}

// Browsers that currently have our native messaging host registered.
func registeredBrowsers() []string {
	out := []string{}
	for _, b := range browsers() {
		if runtime.GOOS == "windows" {
			if exec.Command("reg", "query", `HKCU\Software\`+b.reg+`\NativeMessagingHosts\`+hostName).Run() == nil {
				out = append(out, b.name)
			}
		} else if _, err := os.Stat(filepath.Join(b.dir, "NativeMessagingHosts", hostName+".json")); err == nil {
			out = append(out, b.name)
		}
	}
	return out
}

func uninstall() {
	fmt.Println("Removing Stash bridge...")
	for _, b := range browsers() {
		if runtime.GOOS == "windows" {
			exec.Command("reg", "delete", `HKCU\Software\`+b.reg+`\NativeMessagingHosts\`+hostName, "/f").Run()
		} else {
			os.Remove(filepath.Join(b.dir, "NativeMessagingHosts", hostName+".json"))
		}
	}
	os.RemoveAll(dataDir())
	fmt.Println("Done.")
}

func fail(what string, err error) {
	fmt.Printf("\nFAILED: %s\n  %v\n", what, err)
}

// On Windows a double-clicked console closes instantly; wait so the person can read the result.
func pause() {
	if runtime.GOOS != "windows" {
		return
	}
	fmt.Print("\nPress Enter to close...")
	bufio.NewReader(os.Stdin).ReadString('\n')
}
