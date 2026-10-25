import { create } from 'zustand';

/** Hex circumradius in world pixels on the strategic map. */
export const HEX_SIZE = 30;

// The map camera, published by MapView so overlays (minimap, zoom controls) can read and steer it
// without reaching into Pixi.

export interface Camera {
  /** World offset and scale, as on the Pixi world container. */
  x: number;
  y: number;
  scale: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
}

export interface CameraControl {
  zoomBy(factor: number): void;
  fit(): void;
  /** Centre on a point in world (hex-pixel) coordinates. */
  centerOn(x: number, y: number): void;
}

export const useCamera = create<{ camera: Camera; control: CameraControl | null }>(() => ({
  camera: { x: 0, y: 0, scale: 1, width: 0, height: 0 },
  control: null,
}));
