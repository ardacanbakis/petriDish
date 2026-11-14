import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type PerspectiveCamera } from 'three';
import type CameraControlsImpl from 'camera-controls';
import { useLabStore } from '../../state/labStore';

const target = new Vector3();

/**
 * Measures how many millimetres one screen pixel covers at the point the
 * camera is looking at, so the HUD can draw a scale bar that is right at
 * every zoom level.
 */
export function ScaleProbe() {
  const controls = useThree((s) => s.controls) as CameraControlsImpl | null;
  useFrame(({ camera, size }) => {
    if (!controls || typeof controls.getTarget !== 'function') return;
    controls.getTarget(target);
    const distance = camera.position.distanceTo(target);
    const fov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
    const mmPerPixel = (2 * distance * Math.tan(fov / 2)) / size.height;
    const previous = useLabStore.getState().mmPerPixel;
    // Only publish meaningful changes: this runs every frame.
    if (Math.abs(mmPerPixel - previous) > previous * 0.01) useLabStore.setState({ mmPerPixel });
  });
  return null;
}
