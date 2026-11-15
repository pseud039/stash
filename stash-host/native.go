package main

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Native messaging: each message is a 4-byte little-endian length, then JSON, on stdin/stdout.
func native() {
	logf("native host started by %s", os.Args[1])
	for {
		var n uint32
		if err := binary.Read(os.Stdin, binary.LittleEndian, &n); err != nil {
			return
		}
		if n == 0 || n > 1<<20 {
			return
		}
		buf := make([]byte, n)
		if _, err := io.ReadFull(os.Stdin, buf); err != nil {
			return
		}
		var req struct {
			Op string `json:"op"`
		}
		json.Unmarshal(buf, &req)

		var resp any
		if req.Op == "ensure" {
			resp = ensureServer()
		} else {
			resp = map[string]any{"error": "unknown op"}
		}
		out, _ := json.Marshal(resp)
		binary.Write(os.Stdout, binary.LittleEndian, uint32(len(out)))
		os.Stdout.Write(out)
	}
}

func pingOK(token string) bool {
	req, _ := http.NewRequest("POST", "http://127.0.0.1:"+port+"/op", strings.NewReader(`{"op":"list"}`))
	req.Header.Set("x-stash-token", token)
	c := http.Client{Timeout: 1500 * time.Millisecond}
	res, err := c.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	io.Copy(io.Discard, res.Body)
	return res.StatusCode == 200
}

// Start the bridge if it isn't answering, then tell the extension where it is and how to authenticate.
// serveExe, when set (by the installer), is the program to start as the bridge. Normally it is
// this very executable, which is the installed copy when a browser launches us.
var serveExe string

func ensureServer() map[string]any {
	token := loadToken()
	if !pingOK(token) {
		exe := serveExe
		if exe == "" {
			var err error
			if exe, err = os.Executable(); err != nil {
				logf("ensure: cannot locate own executable: %v", err)
				return map[string]any{"error": "cannot locate own executable"}
			}
		}
		logf("ensure: bridge not answering, starting %s --serve", exe)
		cmd := exec.Command(exe, "--serve")
		if err := startDetached(cmd); err != nil {
			logf("ensure: start failed: %v", err)
			return map[string]any{"error": "cannot start bridge: " + err.Error()}
		}
		up := false
		for i := 0; i < 40 && !up; i++ {
			time.Sleep(100 * time.Millisecond)
			up = pingOK(token)
		}
		if !up {
			logf("ensure: bridge did not answer within 4s")
			return map[string]any{"error": "bridge did not start"}
		}
		logf("ensure: bridge is up")
	}
	return map[string]any{"url": "http://127.0.0.1:" + port, "token": token}
}
