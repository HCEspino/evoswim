export interface Palette {
  paper: string
  ink: string
  accent: string
  /** 'light' | 'dark', for alpha tuning */
  mode: 'light' | 'dark'
}

export const LIGHT: Palette = { paper: '#f6f6f3', ink: '#1b1d1f', accent: '#c43c2c', mode: 'light' }
export const DARK: Palette = { paper: '#141516', ink: '#e9e7e2', accent: '#e2543f', mode: 'dark' }
