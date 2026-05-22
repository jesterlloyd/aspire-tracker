import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { PresenceProvider } from './contexts/PresenceContext.jsx'
import { ThemeProvider } from './contexts/ThemeContext.jsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      gcTime: 300000,
      refetchOnWindowFocus: false, // opt individual queries back in if they genuinely need it
      refetchOnMount: true,
      retry: 1,
      placeholderData: keepPreviousData,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <PresenceProvider>
            <App />
          </PresenceProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
