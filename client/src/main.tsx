import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Home } from './screens/Home';
import { PlayerApp } from './screens/player/PlayerApp';
import { QuestionsEditor } from './screens/QuestionsEditor';
import './styles.css';

// Three.js + Rapier live only in the host chunk; phones never download them.
const Gallery = lazy(() => import('./screens/host/Gallery').then((m) => ({ default: m.Gallery })));
const HostScreen = lazy(() => import('./screens/host/HostScreen').then((m) => ({ default: m.HostScreen })));

const loading = (
  <div className="host-empty host">
    <div className="spinner" />
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/host"
          element={
            <Suspense fallback={loading}>
              <HostScreen />
            </Suspense>
          }
        />
        <Route
          path="/gallery"
          element={
            <Suspense fallback={loading}>
              <Gallery />
            </Suspense>
          }
        />
        <Route path="/questions" element={<QuestionsEditor />} />
        <Route path="/join" element={<Home />} />
        <Route path="/join/:roomId" element={<PlayerApp />} />
        <Route path="/play/:roomId" element={<PlayerApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
