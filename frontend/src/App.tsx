import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import SimulatorPage from './pages/SimulatorPage'
import UploadBuildingPage from './pages/UploadBuildingPage'
import BuildingWorkspacePage from './pages/BuildingWorkspacePage'

export type { SimulationStatus } from './types'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage/>}/>
        <Route path="/simulator" element={<SimulatorPage/>}/>
        <Route path="/buildings/new" element={<UploadBuildingPage/>}/>
        <Route path="/buildings/:buildingId" element={<BuildingWorkspacePage/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </BrowserRouter>
  )
}

export default App
