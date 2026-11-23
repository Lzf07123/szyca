import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './App'
import { SiteProvider } from './api/site'
import './index.css'
import './styles.css'
import './cosmos.css'
import './module-styles.generated'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SiteProvider>
      <RouterProvider router={router} />
    </SiteProvider>
  </React.StrictMode>,
)
