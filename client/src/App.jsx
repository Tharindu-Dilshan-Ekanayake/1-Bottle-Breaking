import FpsMeter from './bloxity/FpsMeter'
import GameController from './GameController'
import { useUi } from './game/stores/ui'
import GameScene from './game/GameScene'
import RuntimeSync from './game/RuntimeSync'
import AuthHUD from './ui/AuthHUD'
import HUD from './ui/HUD'
import Nameplates from './ui/Nameplates'
import ProximityPrompt from './ui/ProximityPrompt'
import { ContextLostOverlay, HatchOverlay, LoadingScreen, RebirthCelebration } from './ui/Overlays'
import Panels from './ui/Panels'
import Popups from './ui/Popups'
import TouchControls from './ui/TouchControls'

function App() {
  // The HUD and panels mount once the lobby has been drawn: the loading screen covers
  // them until then anyway, and it fades out over their first render.
  const loaded = useUi((s) => s.loaded)
  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#86c8fb]">
      <GameController />
      <GameScene />
      <RuntimeSync />
      {loaded && (
        <>
          <Nameplates />
          <Popups />
          <ProximityPrompt />
          <HUD />
          <AuthHUD />
          <TouchControls />
          <Panels />
        </>
      )}
      <HatchOverlay />
      <RebirthCelebration />
      <ContextLostOverlay />
      <LoadingScreen />
      <FpsMeter />
    </div>
  )
}

export default App
