package contract

type Qrcode struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	ImageURL string `json:"image_url"`
}
