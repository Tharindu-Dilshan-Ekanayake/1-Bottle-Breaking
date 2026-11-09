import GameScene from './game/GameScene'
import AuthHUD from './ui/AuthHUD'
import Controls from './ui/Controls'

function App() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-900">
      <GameScene />
      <AuthHUD />
      <Controls />
    </div>
  )
}

export default App
