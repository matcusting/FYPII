import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { BrowserRouter } from 'react-router-dom' // 引入路由环境

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* 用 BrowserRouter 把 App 包裹起来，提供路由支持 */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)