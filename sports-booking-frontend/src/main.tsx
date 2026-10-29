import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Shrink the page header once the page is scrolled; the gap between on/off stops it flickering as the header resizes.
let compact = false
const onScroll = () => {
  const y = window.scrollY
  const next = compact ? y > 8 : y > 120
  if (next !== compact) {
    compact = next
    document.documentElement.classList.toggle('compact', compact)
  }
}
window.addEventListener('scroll', onScroll, { passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
