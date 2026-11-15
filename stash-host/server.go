package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	port     = "47821"
	itemTTL  = 30 * time.Minute
	idleExit = 60 * time.Minute // server quits when unused; the extension restarts it on demand
	maxBody  = 16 << 20
)

type item struct {
	ID, Name, Mime string
	Size           int64
	Parts          []string
	TS             time.Time
	Done           bool
}

type msg struct {
	Op   string `json:"op"`
	ID   string `json:"id"`
	Name string `json:"name"`
	Mime string `json:"mime"`
	Size int64  `json:"size"`
	B64  string `json:"b64"`
	I    int    `json:"i"`
}

var (
	mu      sync.Mutex
	items   = map[string]*item{}
	lastReq atomic.Int64
)

// token lives in the data dir; the extension gets it from the native host, so users never paste it.
func loadToken() string {
	p := filepath.Join(dataDir(), "token")
	if b, err := os.ReadFile(p); err == nil && len(strings.TrimSpace(string(b))) >= 32 {
		return strings.TrimSpace(string(b))
	}
	raw := make([]byte, 24)
	rand.Read(raw)
	t := hex.EncodeToString(raw)
	os.MkdirAll(dataDir(), 0o700)
	os.WriteFile(p, []byte(t+"\n"), 0o600)
	return t
}

func handle(m msg) any {
	mu.Lock()
	defer mu.Unlock()
	it := items[m.ID]
	switch m.Op {
	case "begin":
		items[m.ID] = &item{ID: m.ID, Name: m.Name, Mime: m.Mime, Size: m.Size, TS: time.Now()}
		return map[string]any{"ok": true}
	case "chunk":
		if it == nil {
			return map[string]any{"error": "no such item"}
		}
		it.Parts = append(it.Parts, m.B64)
		return map[string]any{"ok": true}
	case "end":
		if it == nil {
			return map[string]any{"error": "no such item"}
		}
		it.Done, it.TS = true, time.Now()
		return map[string]any{"ok": true}
	case "meta":
		if it == nil || !it.Done {
			return nil
		}
		return map[string]any{"name": it.Name, "mime": it.Mime, "size": it.Size, "chunks": len(it.Parts)}
	case "get":
		if it == nil || m.I < 0 || m.I >= len(it.Parts) {
			return map[string]any{"error": "no such chunk"}
		}
		return map[string]any{"b64": it.Parts[m.I]}
	case "list":
		out := []map[string]any{}
		for _, x := range items {
			if x.Done {
				out = append(out, map[string]any{"id": x.ID, "name": x.Name, "mime": x.Mime, "size": x.Size, "ts": x.TS.UnixMilli()})
			}
		}
		// oldest first, like the in-browser store
		for i := 1; i < len(out); i++ {
			for j := i; j > 0 && out[j]["ts"].(int64) < out[j-1]["ts"].(int64); j-- {
				out[j], out[j-1] = out[j-1], out[j]
			}
		}
		return out
	case "remove":
		delete(items, m.ID)
		return map[string]any{"ok": true}
	case "clear":
		items = map[string]*item{}
		return map[string]any{"ok": true}
	}
	return map[string]any{"error": "unknown op"}
}

func serve() {
	token := loadToken()
	lastReq.Store(time.Now().UnixNano())

	mux := http.NewServeMux()
	mux.HandleFunc("/op", func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*") // harmless: every real call still needs the token
		h.Set("Access-Control-Allow-Headers", "x-stash-token, content-type")
		h.Set("Access-Control-Allow-Methods", "POST")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		reply := func(code int, v any) {
			h.Set("Content-Type", "application/json")
			w.WriteHeader(code)
			json.NewEncoder(w).Encode(v)
		}
		if r.Method != http.MethodPost {
			reply(404, map[string]any{"error": "not found"})
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("x-stash-token")), []byte(token)) != 1 {
			reply(401, map[string]any{"error": "bad token"})
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			reply(413, map[string]any{"error": "request too large"})
			return
		}
		var m msg
		if err := json.Unmarshal(body, &m); err != nil {
			reply(200, map[string]any{"error": "bad json"})
			return
		}
		lastReq.Store(time.Now().UnixNano())
		reply(200, handle(m))
	})

	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		logf("bridge: cannot listen on port %s (%v); probably already running", port, err)
		os.Exit(0)
	}
	logf("bridge: listening on 127.0.0.1:%s (pid %d)", port, os.Getpid())

	go func() {
		for range time.Tick(time.Minute) {
			mu.Lock()
			for id, x := range items {
				if time.Since(x.TS) > itemTTL {
					delete(items, id)
				}
			}
			mu.Unlock()
			if time.Since(time.Unix(0, lastReq.Load())) > idleExit {
				logf("bridge: idle for %v, exiting (files dropped)", idleExit)
				os.Exit(0)
			}
		}
	}()

	http.Serve(ln, mux)
}
