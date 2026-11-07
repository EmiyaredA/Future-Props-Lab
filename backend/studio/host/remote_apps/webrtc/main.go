// One Pion peer and one Mac capture child. The parent owns admission and lifetime.
package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

const maxMessage = 128 * 1024

type command struct {
	Type       string             `json:"type"`
	SDP        string             `json:"sdp"`
	Window     uint32             `json:"window"`
	ICEServers []webrtc.ICEServer `json:"ice_servers"`
}

type peer struct {
	ctx       context.Context
	stop      context.CancelFunc
	writeLock sync.Mutex
	outLock   sync.Mutex
	native    io.Writer
	track     *webrtc.TrackLocalStaticSample
	ready     chan struct{}
}

func (p *peer) sendNative(message any) {
	p.writeLock.Lock()
	defer p.writeLock.Unlock()
	if p.ctx.Err() == nil && json.NewEncoder(p.native).Encode(message) != nil {
		p.stop()
	}
}

func (p *peer) sendBrowser(message json.RawMessage) {
	p.outLock.Lock()
	defer p.outLock.Unlock()
	if json.NewEncoder(os.Stdout).Encode(message) != nil {
		p.stop()
	}
}

func (p *peer) capture(r io.Reader) {
	defer p.stop()
	var last time.Time
	header := make([]byte, 5)
	for {
		if _, err := io.ReadFull(r, header); err != nil {
			return
		}
		size := binary.BigEndian.Uint32(header[1:])
		if size == 0 || size > 4*1024*1024 {
			return
		}
		body := make([]byte, size)
		if _, err := io.ReadFull(r, body); err != nil {
			return
		}
		switch header[0] {
		case 1:
			p.sendBrowser(body)
		case 2:
			now := time.Now()
			duration := now.Sub(last)
			if last.IsZero() || duration < time.Millisecond {
				duration = time.Second / 30
			}
			last = now
			_ = p.track.WriteSample(media.Sample{Data: body, Duration: min(duration, 5*time.Second)})
		default:
			return
		}
	}
}

func (p *peer) attach(conn *webrtc.PeerConnection) error {
	sender, err := conn.AddTrack(p.track)
	if err != nil {
		return err
	}
	go func() {
		for {
			packets, _, err := sender.ReadRTCP()
			if err != nil {
				return
			}
			for _, packet := range packets {
				switch packet.(type) {
				case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
					p.sendNative(map[string]string{"type": "keyframe"})
				}
			}
		}
	}()

	var connected sync.Once
	conn.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateConnected:
			connected.Do(func() { close(p.ready) })
		case webrtc.PeerConnectionStateDisconnected, webrtc.PeerConnectionStateFailed:
			p.stop()
		}
	})
	var input sync.Once
	conn.OnDataChannel(func(channel *webrtc.DataChannel) {
		if channel.Label() != "input" || !channel.Ordered() ||
			channel.MaxRetransmits() != nil || channel.MaxPacketLifeTime() != nil {
			_ = channel.Close()
			return
		}
		admitted := false
		input.Do(func() { admitted = true })
		if !admitted {
			_ = channel.Close()
			return
		}
		channel.OnClose(p.stop)
		channel.OnMessage(func(message webrtc.DataChannelMessage) {
			if message.IsString && len(message.Data) <= 4096 && json.Valid(message.Data) {
				p.sendNative(map[string]any{"type": "input", "event": json.RawMessage(message.Data)})
			}
		})
	})
	return nil
}

func (p *peer) negotiate(conn *webrtc.PeerConnection, sdp string) error {
	if err := conn.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		return err
	}
	answer, err := conn.CreateAnswer(nil)
	if err != nil {
		return err
	}
	ready := webrtc.GatheringCompletePromise(conn)
	if err = conn.SetLocalDescription(answer); err != nil {
		return err
	}
	select {
	case <-ready:
	case <-time.After(10 * time.Second):
		// The gathered candidates are still usable when a relay is slow to answer.
	case <-p.ctx.Done():
		return p.ctx.Err()
	}
	message, err := json.Marshal(map[string]string{"type": "answer", "sdp": conn.LocalDescription().SDP})
	if err == nil {
		p.sendBrowser(message)
	}
	return err
}

func run(ctx context.Context, helper, app string) error {
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	commands := make(chan command)
	go func() {
		defer close(commands)
		scan := bufio.NewScanner(os.Stdin)
		scan.Buffer(make([]byte, 4096), maxMessage)
		for scan.Scan() {
			var next command
			if json.Unmarshal(scan.Bytes(), &next) != nil {
				return
			}
			select {
			case commands <- next:
			case <-ctx.Done():
				return
			}
		}
		stop()
	}()
	var config command
	select {
	case config = <-commands:
	case <-ctx.Done():
		return ctx.Err()
	}
	if config.Type != "configure" {
		return errors.New("expected configuration")
	}

	codec := webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
		SDPFmtpLine:  "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
		RTCPFeedback: []webrtc.RTCPFeedback{{Type: "nack"}, {Type: "nack", Parameter: "pli"}},
	}
	track, err := webrtc.NewTrackLocalStaticSample(codec, "window", "fpl-app")
	if err != nil {
		return err
	}
	engine := &webrtc.MediaEngine{}
	if err = engine.RegisterCodec(webrtc.RTPCodecParameters{RTPCodecCapability: codec, PayloadType: 102}, webrtc.RTPCodecTypeVideo); err != nil {
		return err
	}
	conn, err := webrtc.NewAPI(webrtc.WithMediaEngine(engine)).NewPeerConnection(webrtc.Configuration{ICEServers: config.ICEServers})
	if err != nil {
		return err
	}
	defer conn.Close()

	capture, err := openNativeChannel(ctx, helper, "session", app)
	if err != nil {
		return err
	}
	defer capture.Close()
	p := &peer{ctx: ctx, stop: stop, native: capture, track: track, ready: make(chan struct{})}
	if err = p.attach(conn); err != nil {
		return err
	}
	go p.capture(capture)
	offered, selected := false, false
	for {
		select {
		case <-ctx.Done():
			return nil
		case next, ok := <-commands:
			if !ok {
				return nil
			}
			switch {
			case next.Type == "offer" && !offered:
				offered = true
				if err = p.negotiate(conn, next.SDP); err != nil {
					return err
				}
			case next.Type == "select" && offered && !selected && next.Window != 0:
				selected = true
				select {
				case <-p.ready:
					p.sendNative(map[string]any{"type": "select", "window": next.Window})
				case <-ctx.Done():
					return nil
				case <-time.After(15 * time.Second):
					return errors.New("WebRTC connection timed out")
				}
			default:
				return errors.New("unexpected signaling message")
			}
		}
	}
}

func main() {
	executable, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	helper := filepath.Join(filepath.Dir(executable), "fpl-window-capture")
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	args := os.Args[1:]
	switch {
	case len(args) == 1 && args[0] == "catalog":
		child := exec.CommandContext(ctx, helper, args[0])
		child.Stdout = os.Stdout
		err = child.Run()
	case len(args) == 1 && args[0] == "status":
		var native *net.UnixConn
		native, err = openNativeChannel(ctx, helper, "status")
		if err == nil {
			defer native.Close()
			_ = native.SetReadDeadline(time.Now().Add(2 * time.Second))
			_, err = io.Copy(os.Stdout, native)
		}
	case len(args) == 2 && args[0] == "session":
		err = run(ctx, helper, args[1])
	default:
		err = errors.New("invalid arguments")
	}
	if err != nil {
		os.Exit(1)
	}
}
