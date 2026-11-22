import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './App'
import { SiteProvider } from './api/site'
import './index.css'
import './styles.css'
import '@fontsource/press-start-2p'
import '@fontsource/vt323'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SiteProvider>
      <RouterProvider router={router} />
    </SiteProvider>
  </React.StrictMode>,
)
