import { createContext, useContext, useEffect } from 'react'
import { supabase } from './supabase'

const ThemeContext = createContext(null)

export function useTheme() {
  return useContext(ThemeContext)
}

/**
 * Fetches the authenticated user's company branding and injects
 * --operator-primary / --operator-accent as CSS custom properties on <html>.
 * Falls back to CoachMate defaults when the company has no custom colours.
 */
export function ThemeProvider({ children }) {
  useEffect(() => {
    async function applyTheme(userId) {
      if (!userId) {
        // Signed out — reset to CoachMate defaults
        document.documentElement.style.removeProperty('--operator-primary')
        document.documentElement.style.removeProperty('--operator-accent')
        return
      }

      const { data: employee } = await supabase
        .from('employees')
        .select('companies(primary_color, accent_color)')
        .eq('auth_user_id', userId)
        .single()

      const company = employee?.companies
      if (company?.primary_color) {
        document.documentElement.style.setProperty('--operator-primary', company.primary_color)
      }
      if (company?.accent_color) {
        document.documentElement.style.setProperty('--operator-accent', company.accent_color)
      }
    }

    // Apply theme for any already-active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      applyTheme(session?.user?.id ?? null)
    })

    // Reapply (or reset) whenever the auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applyTheme(session?.user?.id ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return <ThemeContext.Provider value={null}>{children}</ThemeContext.Provider>
}
