import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../app/LanguageToggle';
import { PlaceholderDish } from './scene/PlaceholderDish';

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function LabPage() {
  const { t } = useTranslation();
  const webgl = hasWebGL();

  return (
    <div className="relative h-full w-full">
      {webgl ? (
        <Canvas shadows camera={{ position: [0, 0.16, 0.2], fov: 40, near: 0.01, far: 20 }}>
          <color attach="background" args={['#10161b']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[0.4, 0.8, 0.3]} intensity={2.2} castShadow />
          <PlaceholderDish />
          <OrbitControls
            makeDefault
            target={[0, 0.01, 0]}
            minDistance={0.08}
            maxDistance={1}
            maxPolarAngle={Math.PI / 2 - 0.05}
          />
        </Canvas>
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-slate-300">
          {t('lab.webglUnavailable')}
        </div>
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="pointer-events-auto max-w-sm rounded-lg bg-bench-900/80 p-4 backdrop-blur">
          <h1 className="text-lg font-semibold text-agar-100">{t('lab.placeholderTitle')}</h1>
          <p className="mt-1 text-sm text-slate-300">{t('lab.placeholderBody')}</p>
          <Link to="/" className="mt-3 inline-block text-sm text-agar-300 hover:underline">
            ← {t('common.back')}
          </Link>
        </div>
        <div className="pointer-events-auto">
          <LanguageToggle />
        </div>
      </header>
    </div>
  );
}
