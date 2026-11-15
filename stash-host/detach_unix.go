//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// Start the child in its own session so it outlives the native-messaging host the browser kills.
func startDetached(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
