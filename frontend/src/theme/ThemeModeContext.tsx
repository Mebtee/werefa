import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { getMaterioTheme } from './materioTheme'

export type ThemeMode = 'light' | 'dark'

interface ThemeModeContextValue {
  mode: ThemeMode
  toggleMode: () => void
  setMode: (mode: ThemeMode) => void
}

const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: 'dark',
  toggleMode: () => {},
  setMode: () => {},
})

const STORAGE_KEY = 'werefa_theme_mode'

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'light' || saved === 'dark') return saved
    } catch {
      // ignore
    }
    return 'dark'
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode)
      document.documentElement.setAttribute('data-theme', mode)
    } catch {
      // ignore
    }
  }, [mode])

  const toggleMode = () => {
    setModeState((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode)
  }

  const theme = useMemo(() => getMaterioTheme(mode), [mode])

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode, setMode }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  )
}

export function useThemeMode() {
  return useContext(ThemeModeContext)
}
