package contract

import (
	"context"
	"net/http"
	"time"
)

type Principal struct {
	ID           int64
	Username     string
	Role         string
	Capabilities []string
	Legacy       bool
}

type User struct {
	ID        int64
	Nickname  string
	Token     string
	DeviceFP  string
	Abandoned bool
	CreatedAt time.Time
}

type HTTP interface {
	Feature(feature string, next http.HandlerFunc) http.HandlerFunc
	AnyFeature(features []string, next http.HandlerFunc) http.HandlerFunc
	User(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc
	OptionalUser(*http.Request) (*User, error)
	Authenticated(next func(http.ResponseWriter, *http.Request, Principal)) http.HandlerFunc
	Permission(permission string, next func(http.ResponseWriter, *http.Request, Principal)) http.HandlerFunc
	Audit(principal Principal, next http.HandlerFunc) http.HandlerFunc
	ValidateToken(string) bool
	WSAllowedOrigins() []string
	OnlineCount() int64
	SaveImage(http.ResponseWriter, *http.Request) (string, bool)
	RemoveFile(string)
	AttachMedia(*http.Request, Principal, string, string, string, string)
	ReleaseAndCleanup(*http.Request, string, string, string, string)
	AssertMediaUnreferenced(*http.Request, string, string, string, string) error
}

type HTTPModule interface {
	Module
	RegisterHTTP(*http.ServeMux, HTTP) error
}

type HTTPDependencies struct {
	Context context.Context
}

type ClientCounter interface {
	ClientCounts() (int, int)
}

type ClientCounterProvider interface {
	Counter() ClientCounter
}

type AnnouncementReader interface {
	LatestAnnouncement(context.Context) (string, error)
}

type RealtimeRuntime interface {
	AnnouncementReader
	ClientCounterProvider
}
