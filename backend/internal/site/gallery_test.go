package site

import "testing"

func TestValidateGalleryFields(t *testing.T) {
	tests := []struct {
		name     string
		title    string
		imageURL string
		wantErr  bool
	}{
		{name: "local upload", title: "  活动现场  ", imageURL: "/uploads/a.png"},
		{name: "https image", title: "远程", imageURL: "https://example.com/a.jpg"},
		{name: "empty image", title: "", imageURL: "", wantErr: true},
		{name: "protocol relative", title: "", imageURL: "//example.com/a.jpg", wantErr: true},
		{name: "javascript", title: "", imageURL: "javascript:alert(1)", wantErr: true},
		{name: "html title", title: "<b>坏标题</b>", imageURL: "/uploads/a.png", wantErr: true},
		{name: "ftp image", title: "", imageURL: "ftp://example.com/a.png", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			title, imageURL, err := validateGalleryFields(test.title, test.imageURL)
			if test.wantErr {
				if err == nil {
					t.Fatalf("fields accepted: title=%q image=%q", title, imageURL)
				}
				return
			}
			if err != nil {
				t.Fatalf("fields rejected: %v", err)
			}
			if title != "活动现场" && test.name == "local upload" {
				t.Fatalf("title was not trimmed: %q", title)
			}
			if imageURL != test.imageURL {
				t.Fatalf("image URL = %q, want %q", imageURL, test.imageURL)
			}
		})
	}
}

func TestUniquePositiveIDs(t *testing.T) {
	got := uniquePositiveIDs([]int64{3, 0, 3, 1, -2})
	if len(got) != 2 || got[0] != 3 || got[1] != 1 {
		t.Fatalf("ids = %v", got)
	}
}
