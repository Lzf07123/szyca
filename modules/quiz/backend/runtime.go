package quiz

import (
	"context"

	"szyca/backend/contract"
)

type Runtime struct {
	*Service
}

func (r *Runtime) ValidateToken(ctx context.Context, token string) (contract.User, error) {
	user, err := r.Service.ValidateToken(ctx, token)
	if err != nil {
		return contract.User{}, err
	}
	return contract.User{
		ID: user.ID, Nickname: user.Nickname, Token: user.Token,
		DeviceFP: user.DeviceFP, Abandoned: user.Abandoned, CreatedAt: user.CreatedAt,
	}, nil
}
