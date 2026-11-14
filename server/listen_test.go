package server

import (
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOpenLinks(t *testing.T) {
	ifaceAddrs := []net.Addr{
		&net.IPNet{IP: net.ParseIP("127.0.0.1"), Mask: net.CIDRMask(8, 32)},
		&net.IPNet{IP: net.ParseIP("192.168.1.5"), Mask: net.CIDRMask(24, 32)},
		&net.IPNet{IP: net.ParseIP("169.254.10.1"), Mask: net.CIDRMask(16, 32)},
		&net.IPNet{IP: net.ParseIP("10.0.0.7"), Mask: net.CIDRMask(8, 32)},
		&net.IPNet{IP: net.ParseIP("fe80::1"), Mask: net.CIDRMask(64, 128)},
		&net.IPNet{IP: net.ParseIP("2001:db8::5"), Mask: net.CIDRMask(64, 128)},
		&net.IPAddr{IP: net.ParseIP("192.168.2.9")},
	}

	tests := []struct {
		name string
		addr net.Addr
		want []openLink
	}{
		{
			name: "every interface over IPv6",
			addr: &net.TCPAddr{IP: net.IPv6unspecified, Port: 7272},
			want: []openLink{
				{label: "local", url: "http://127.0.0.1:7272"},
				{label: "network", url: "http://192.168.1.5:7272"},
				{label: "network", url: "http://10.0.0.7:7272"},
			},
		},
		{
			name: "every interface over IPv4",
			addr: &net.TCPAddr{IP: net.IPv4zero, Port: 8080},
			want: []openLink{
				{label: "local", url: "http://127.0.0.1:8080"},
				{label: "network", url: "http://192.168.1.5:8080"},
				{label: "network", url: "http://10.0.0.7:8080"},
			},
		},
		{
			name: "loopback",
			addr: &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 7272},
			want: []openLink{{label: "local", url: "http://127.0.0.1:7272"}},
		},
		{
			name: "IPv6 loopback",
			addr: &net.TCPAddr{IP: net.IPv6loopback, Port: 7272},
			want: []openLink{{label: "local", url: "http://[::1]:7272"}},
		},
		{
			name: "one network address",
			addr: &net.TCPAddr{IP: net.ParseIP("192.168.1.5"), Port: 7272},
			want: []openLink{{label: "network", url: "http://192.168.1.5:7272"}},
		},
		{
			name: "one IPv6 network address",
			addr: &net.TCPAddr{IP: net.ParseIP("2001:db8::5"), Port: 7272},
			want: []openLink{{label: "network", url: "http://[2001:db8::5]:7272"}},
		},
		{
			name: "IPv6 link-local address with its zone",
			addr: &net.TCPAddr{IP: net.ParseIP("fe80::1"), Port: 7272, Zone: "en0"},
			want: []openLink{{label: "network", url: "http://[fe80::1%25en0]:7272"}},
		},
		{
			name: "not TCP",
			addr: &net.UnixAddr{Name: "/tmp/scrawl.sock", Net: "unix"},
			want: nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got := openLinks(tc.addr, ifaceAddrs)

			// assert
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestOpenLinksWithNoInterfaceAddress(t *testing.T) {
	// act
	got := openLinks(&net.TCPAddr{IP: net.IPv4zero, Port: 7272}, nil)

	// assert
	assert.Equal(t, []openLink{{label: "local", url: "http://127.0.0.1:7272"}}, got)
}
