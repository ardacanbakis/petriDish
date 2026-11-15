import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useSession } from '../SessionContext';

/**
 * Lets the HUD take a picture of the 3D view. Rendering and reading the canvas
 * in the same task works without keeping the drawing buffer around.
 */
export function CaptureBridge() {
  const session = useSession();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    session.capture = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/png');
    };
    return () => {
      session.capture = null;
    };
  }, [session, gl, scene, camera]);
  return null;
}
