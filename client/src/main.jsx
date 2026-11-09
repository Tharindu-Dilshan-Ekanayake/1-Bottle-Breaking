// The game font, self-hosted (Latin subset, ~16 KB woff2): no third-party request.
import '@fontsource/fredoka-one/latin-400.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import BloxityProvider from './bloxity/BloxityProvider.jsx'
import { installAudioUnlock } from './game/audio'
import './index.css'

// The AudioContext is only created on the player's first tap / click / key press.
performance.mark('bt:main')
installAudioUnlock()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Slug comes from VITE_GAME_SLUG in client/.env — see .env.example. */}
    <BloxityProvider gameSlug={import.meta.env.VITE_GAME_SLUG}>
      <App />
    </BloxityProvider>
  </StrictMode>,
)
