import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IntroPage } from '../intro/IntroPage';

// The lab pulls in three.js and the whole scene; keep it out of the intro bundle.
const LabPage = lazy(() => import('../lab/LabPage'));

function Loading() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center text-slate-400" role="status">
      {t('common.loading')}
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<IntroPage />} />
        <Route
          path="/lab"
          element={
            <Suspense fallback={<Loading />}>
              <LabPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
