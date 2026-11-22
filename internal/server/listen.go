package server

import (
	"log"
	"net"
	"net/url"
	"strconv"
)

const (
	localLink   = "local"
	networkLink = "network"
)

type openLink struct {
	label string
	url   string
}

func logOpenLinks(addr net.Addr) {
	ifaceAddrs, err := net.InterfaceAddrs()
	if err != nil {
		log.Printf("[WARN] list network addresses: %v", err)
	}
	log.Printf("[INFO] listening on %s", addr)
	for _, link := range openLinks(addr, ifaceAddrs) {
		log.Printf("[INFO] %-8s %s", link.label+":", link.url)
	}
}

func openLinks(addr net.Addr, ifaceAddrs []net.Addr) []openLink {
	tcp, ok := addr.(*net.TCPAddr)
	if !ok {
		return nil
	}
	port := strconv.Itoa(tcp.Port)

	if !tcp.IP.IsUnspecified() {
		return []openLink{{label: linkLabel(tcp.IP), url: httpURL(boundHost(tcp), port)}}
	}

	links := []openLink{{label: localLink, url: httpURL("127.0.0.1", port)}}
	for _, entry := range ifaceAddrs {
		ipNet, ok := entry.(*net.IPNet)
		if !ok {
			continue
		}
		ip := ipNet.IP.To4()
		if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			continue
		}
		links = append(links, openLink{label: networkLink, url: httpURL(ip.String(), port)})
	}
	return links
}

func linkLabel(ip net.IP) string {
	if ip.IsLoopback() {
		return localLink
	}
	return networkLink
}

func boundHost(tcp *net.TCPAddr) string {
	if tcp.Zone == "" {
		return tcp.IP.String()
	}
	return tcp.IP.String() + "%" + tcp.Zone
}

func httpURL(host, port string) string {
	return (&url.URL{Scheme: "http", Host: net.JoinHostPort(host, port)}).String()
}
