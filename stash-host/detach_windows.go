//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

const (
	createNoWindow      = 0x08000000
	detachedProcess     = 0x00000008
	createBreakawayJob  = 0x01000000
	createNewProcessGrp = 0x00000200
)

// Detach from the browser's console and, if the job object allows it, from its job so the
// bridge isn't killed when the browser closes the native host. Falls back without breakaway.
func startDetached(cmd *exec.Cmd) error {
	flags := uint32(createNoWindow | detachedProcess | createNewProcessGrp)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags | createBreakawayJob, HideWindow: true}
	if err := cmd.Start(); err != nil {
		retry := exec.Command(cmd.Path, cmd.Args[1:]...)
		retry.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags, HideWindow: true}
		if err2 := retry.Start(); err2 != nil {
			return err2
		}
		return retry.Process.Release()
	}
	return cmd.Process.Release()
}
