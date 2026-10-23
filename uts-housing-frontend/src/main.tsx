import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider, authChangedEvent } from './lib/auth'
import { I18nProvider } from './lib/i18n'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } } })
window.addEventListener(authChangedEvent, () => queryClient.clear())

createRoot(document.getElementById('root')!).render(
  <StrictMode><I18nProvider><QueryClientProvider client={queryClient}><AuthProvider><App /></AuthProvider></QueryClientProvider></I18nProvider></StrictMode>,
)
