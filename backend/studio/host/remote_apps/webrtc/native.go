package main

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func openNativeChannel(ctx context.Context, helper string, args ...string) (*net.UnixConn, error) {
	// LaunchServices attributes macOS privacy grants to the app bundle.
	dir, err := os.MkdirTemp("", "fpl-window-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "capture")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		return nil, err
	}
	defer listener.Close()

	start, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	deadline, _ := start.Deadline()
	if err = listener.SetDeadline(deadline); err != nil {
		return nil, err
	}
	stopAccept := context.AfterFunc(start, func() { _ = listener.Close() })
	defer stopAccept()
	bundle := filepath.Join(filepath.Dir(helper), "..", "..")
	arguments := append([]string{"-n", "-g", "-a", bundle, "--args"}, args...)
	arguments = append(arguments, socket)
	if err = exec.CommandContext(start, "/usr/bin/open", arguments...).Run(); err != nil {
		return nil, err
	}
	return listener.AcceptUnix()
}
