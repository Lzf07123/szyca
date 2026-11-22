package access

import "testing"

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if hash == "correct horse battery staple" {
		t.Fatal("password was stored in plaintext")
	}
	ok, err := VerifyPassword("correct horse battery staple", hash)
	if err != nil || !ok {
		t.Fatalf("correct password rejected: ok=%v err=%v", ok, err)
	}
	ok, err = VerifyPassword("wrong password", hash)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("wrong password accepted")
	}
}

func TestRolePermissionMatrix(t *testing.T) {
	tests := []struct {
		role       string
		permission string
		want       bool
	}{
		{RoleOwner, "quiz.write", true},
		{RoleContentEditor, "site.write", true},
		{RoleContentEditor, "lottery.configure", false},
		{RoleEventOperator, "quiz.operate", true},
		{RoleEventOperator, "scores.read", false},
		{RoleEventOperator, "site.write", false},
		{RoleDataViewer, "scores.read", true},
		{RoleDataViewer, "site.write", false},
	}
	for _, test := range tests {
		got := Can(Principal{Role: test.role}, test.permission)
		if got != test.want {
			t.Errorf("Can(%s, %s) = %v, want %v", test.role, test.permission, got, test.want)
		}
	}
}
