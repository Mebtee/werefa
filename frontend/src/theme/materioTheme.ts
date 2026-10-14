import { createTheme, type Theme } from '@mui/material/styles'

export function getMaterioTheme(mode: 'light' | 'dark' = 'dark'): Theme {
  const isLight = mode === 'light'

  return createTheme({
    palette: {
      mode,
      primary: {
        main: '#8C57FF',
        light: '#A379FF',
        dark: '#7E4EE6',
        contrastText: '#ffffff',
      },
      secondary: {
        main: '#8A8D93',
        light: '#A1A4A9',
        dark: '#7C7F84',
        contrastText: '#ffffff',
      },
      success: {
        main: '#56CA00',
        light: '#78D533',
        dark: '#4DB600',
        contrastText: '#ffffff',
      },
      warning: {
        main: '#FFB400',
        light: '#FFC333',
        dark: '#E6A200',
        contrastText: '#ffffff',
      },
      info: {
        main: '#16B1FF',
        light: '#45C1FF',
        dark: '#149FE6',
        contrastText: '#ffffff',
      },
      error: {
        main: '#FF4C51',
        light: '#FF7074',
        dark: '#E64449',
        contrastText: '#ffffff',
      },
      background: {
        default: isLight ? '#F4F5FA' : '#28243D',
        paper: isLight ? '#FFFFFF' : '#312D4B',
      },
      text: {
        primary: isLight ? '#2E263D' : '#E7E3FC',
        secondary: isLight ? 'rgba(46, 38, 61, 0.68)' : 'rgba(231, 227, 252, 0.68)',
        disabled: isLight ? 'rgba(46, 38, 61, 0.38)' : 'rgba(231, 227, 252, 0.38)',
      },
      divider: isLight ? 'rgba(46, 38, 61, 0.12)' : 'rgba(231, 227, 252, 0.12)',
      action: {
        active: isLight ? 'rgba(46, 38, 61, 0.6)' : 'rgba(231, 227, 252, 0.7)',
        hover: isLight ? 'rgba(46, 38, 61, 0.04)' : 'rgba(231, 227, 252, 0.05)',
        selected: isLight ? 'rgba(140, 87, 255, 0.08)' : 'rgba(140, 87, 255, 0.16)',
        disabled: isLight ? 'rgba(46, 38, 61, 0.3)' : 'rgba(231, 227, 252, 0.3)',
        disabledBackground: isLight ? 'rgba(46, 38, 61, 0.12)' : 'rgba(231, 227, 252, 0.12)',
      },
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      h1: { fontFamily: "'Outfit', 'Inter', sans-serif", fontWeight: 700 },
      h2: { fontFamily: "'Outfit', 'Inter', sans-serif", fontWeight: 700 },
      h3: { fontFamily: "'Outfit', 'Inter', sans-serif", fontWeight: 700 },
      h4: { fontFamily: "'Outfit', 'Inter', sans-serif", fontWeight: 600 },
      h5: { fontFamily: "'Outfit', 'Inter', sans-serif", fontWeight: 600 },
      h6: { fontFamily: "'Outfit', 'Inter', sans-serif", fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: {
      borderRadius: 8,
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: isLight ? '#FFFFFF' : 'rgba(49, 45, 75, 0.88)',
            backgroundImage: 'none',
            backdropFilter: isLight ? 'none' : 'blur(16px)',
            border: isLight ? '1px solid rgba(46, 38, 61, 0.12)' : '1px solid rgba(231, 227, 252, 0.1)',
            borderRadius: 10,
            boxShadow: isLight
              ? '0 2px 10px 0 rgba(46, 38, 61, 0.08)'
              : '0 4px 20px 0 rgba(19, 17, 32, 0.42)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
            '&:hover': {
              borderColor: 'rgba(140, 87, 255, 0.35)',
              boxShadow: isLight
                ? '0 4px 18px 0 rgba(46, 38, 61, 0.12)'
                : '0 6px 24px 0 rgba(19, 17, 32, 0.55)',
            },
          },
        },
      },
      MuiCardHeader: {
        styleOverrides: {
          root: {
            padding: '20px 24px 12px 24px',
          },
          title: {
            fontSize: '1.15rem',
            fontWeight: 600,
          },
          subheader: {
            fontSize: '0.85rem',
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: '16px 24px 24px 24px',
            '&:last-child': {
              paddingBottom: 24,
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            padding: '8px 18px',
            fontWeight: 600,
            transition: 'all 0.18s ease-in-out',
          },
          contained: {
            boxShadow: '0 4px 14px 0 rgba(140, 87, 255, 0.4)',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 600,
            borderRadius: 6,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: isLight ? 'rgba(46, 38, 61, 0.1)' : 'rgba(231, 227, 252, 0.08)',
            padding: '14px 20px',
          },
          head: {
            fontWeight: 600,
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            color: isLight ? 'rgba(46, 38, 61, 0.6)' : 'rgba(231, 227, 252, 0.55)',
            backgroundColor: isLight ? 'rgba(46, 38, 61, 0.02)' : 'rgba(231, 227, 252, 0.02)',
          },
        },
      },
    },
  })
}

export const materioTheme = getMaterioTheme('dark')
