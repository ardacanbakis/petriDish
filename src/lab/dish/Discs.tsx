import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { ANTIBIOTICS, DISC, type AntibioticId } from '../../data/antibiotics';
import type { PlacedDisc } from '../../state/labStore';
import { AGAR_TOP_Y } from './dimensions';

/** Printed top face of a disc: white paper with the antibiotic's code. */
function createLabel(code: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f6f4ec';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#1b1b1b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [name, potency] = code.split(' ');
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(name, 64, 50);
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(potency ?? '', 64, 88);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Antibiotic discs lying on a dish's agar (positions relative to the dish centre). */
export function Discs({ discs }: { discs: PlacedDisc[] }) {
  const labels = useMemo(() => {
    const map = new Map<AntibioticId, CanvasTexture>();
    for (const id of Object.keys(ANTIBIOTICS) as AntibioticId[]) {
      map.set(id, createLabel(ANTIBIOTICS[id].discCode));
    }
    return map;
  }, []);
  useEffect(() => () => labels.forEach((texture) => texture.dispose()), [labels]);

  return (
    <>
      {discs.map((disc, index) => (
        <mesh
          key={index}
          position={[disc.xMm, AGAR_TOP_Y + DISC.thicknessMm / 2 + 0.05, disc.yMm]}
          // Turn the cap so its printed code reads upright from the user's side of the bench.
          rotation-y={Math.PI / 2}
          castShadow
        >
          <cylinderGeometry args={[DISC.radiusMm, DISC.radiusMm, DISC.thicknessMm, 40]} />
          <meshStandardMaterial attach="material-0" color="#efece2" roughness={0.9} />
          <meshStandardMaterial
            attach="material-1"
            map={labels.get(disc.antibiotic)}
            roughness={0.9}
          />
          <meshStandardMaterial attach="material-2" color="#efece2" roughness={0.9} />
        </mesh>
      ))}
    </>
  );
}
