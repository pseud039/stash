package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// A small plain-text log in the data folder. It records events only (starts, stops, errors),
// never file names or contents. It is cut back when it passes 200 KB.
func logPath() string { return filepath.Join(dataDir(), "stash.log") }

func logf(format string, a ...any) {
	os.MkdirAll(dataDir(), 0o700)
	p := logPath()
	if st, err := os.Stat(p); err == nil && st.Size() > 200<<10 {
		os.Remove(p)
	}
	f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, a...))
}

func tailLog(n int) []string {
	b, err := os.ReadFile(logPath())
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimRight(string(b), "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines
}

func readToken() string {
	b, err := os.ReadFile(filepath.Join(dataDir(), "token"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func yesno(b bool) string {
	if b {
		return "yes"
	}
	return "NO"
}

func status() {
	dd := dataDir()
	_, err := os.Stat(filepath.Join(dd, exeName()))
	fmt.Println("Stash bridge status")
	fmt.Println("  data folder      :", dd)
	fmt.Println("  helper installed :", yesno(err == nil))
	if regs := registeredBrowsers(); len(regs) > 0 {
		fmt.Println("  registered with  :", strings.Join(regs, ", "))
	} else {
		fmt.Println("  registered with  : NO browser (run the installer again)")
	}
	tok := readToken()
	up := tok != "" && pingOK(tok)
	fmt.Println("  bridge running   :", yesno(up), "(http://127.0.0.1:"+port+")")
	if !up {
		fmt.Println("                     (normal when idle: the extension starts it on demand)")
	}
	fmt.Println("  log file         :", logPath())
	if lines := tailLog(8); len(lines) > 0 {
		fmt.Println("\nLast log lines:")
		for _, l := range lines {
			fmt.Println("  " + l)
		}
	}
}
