package site

import "context"

type QrcodeProvider interface {
	Qrcodes(context.Context) ([]Qrcode, error)
}
