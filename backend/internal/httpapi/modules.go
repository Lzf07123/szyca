package httpapi

import (
	"net/http"

	"szyca/internal/appmodule"
)

type apiRouteModule struct {
	key      string
	register func(*Server, *http.ServeMux)
}

func apiRouteModules() []apiRouteModule {
	return []apiRouteModule{
		{key: appmodule.KeyJoin, register: (*Server).registerJoinRoutes},
		{key: appmodule.KeyQuiz, register: (*Server).registerQuizRoutes},
		{key: appmodule.KeyLottery, register: (*Server).registerLotteryRoutes},
		{key: appmodule.KeyGallery, register: (*Server).registerGalleryRoutes},
		{key: appmodule.KeyRealtime, register: (*Server).registerRealtimeRoutes},
	}
}
