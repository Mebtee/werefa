import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import { useThemeMode } from '@/theme/ThemeModeContext'

export function ModeDropdown() {
  const { mode, toggleMode } = useThemeMode()

  return (
    <Tooltip
      title={mode === 'dark' ? 'Switch to Light Mode (White)' : 'Switch to Dark Mode'}
      arrow
    >
      <IconButton
        onClick={toggleMode}
        sx={{
          color: mode === 'light' ? '#2E263D' : 'rgba(231, 227, 252, 0.78)',
          bgcolor: mode === 'light' ? 'rgba(46, 38, 61, 0.05)' : 'rgba(231, 227, 252, 0.05)',
          '&:hover': {
            color: '#8C57FF',
            bgcolor: 'rgba(140, 87, 255, 0.12)',
          },
          transition: 'all 0.2s ease',
        }}
      >
        <i
          className={mode === 'dark' ? 'ri-sun-line' : 'ri-moon-clear-line'}
          style={{ fontSize: 20 }}
        />
      </IconButton>
    </Tooltip>
  )
}
