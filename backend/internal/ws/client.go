package ws

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 45 * time.Second
	maxMessageSize = 1024
)

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	authed bool
}

// Serve 返回 WebSocket handler；token 为空表示匿名（大屏），否则校验。
func Serve(hub *Hub, validate func(token string) bool, allowedOrigins []string) http.HandlerFunc {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return originAllowed(r, allowedOrigins)
		},
	}
	return func(w http.ResponseWriter, r *http.Request) {
		tok := r.URL.Query().Get("token")
		authed := false
		if tok != "" {
			if !validate(tok) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			authed = true
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c := &Client{hub: hub, conn: conn, send: make(chan []byte, 64), authed: authed}
		c.hub.register <- c
		go c.writePump()
		go c.readPump()
	}
}

func originAllowed(r *http.Request, allowedOrigins []string) bool {
	origin := strings.TrimRight(r.Header.Get("Origin"), "/")
	if origin == "" {
		return true // 原生客户端和压测工具可省略 Origin
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	for _, allowed := range allowedOrigins {
		if strings.EqualFold(strings.TrimRight(allowed, "/"), origin) {
			return true
		}
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	originHost, _, originErr := net.SplitHostPort(u.Host)
	if originErr != nil {
		originHost = u.Hostname()
	}
	requestHost, _, requestErr := net.SplitHostPort(r.Host)
	if requestErr != nil {
		requestHost = r.Host
	}
	return isLoopbackHost(originHost) && isLoopbackHost(requestHost)
}

func isLoopbackHost(host string) bool {
	host = strings.Trim(host, "[]")
	ip := net.ParseIP(host)
	return strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback())
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
