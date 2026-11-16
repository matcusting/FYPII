import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { BrowserRouter } from 'react-router-dom' // 引入路由环境
import { AuthProvider } from './context/AuthContext'
import I18nProvider from './i18n/I18nProvider'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* 用 BrowserRouter 把 App 包裹起来，提供路由支持；AuthProvider 提供登录状态 */}
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
