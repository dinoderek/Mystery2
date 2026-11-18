import { describe, expect, it, vi } from 'vitest';
import {
  Mesh,
  Points,
  Vector3,
  Texture,
  type Material,
  type MeshStandardMaterial,
} from 'three/webgpu';
import { buildLighthouseScene } from './lighthouse-scene';

describe('lighthouse scenery', () => {
  it('builds bounded geometry around a fixed camera and keeps the brass cradle empty', () => {
    const world = buildLighthouseScene();
    expect(
      world.scene.getObjectsByProperty('name', 'empty-cradle-rim'),
    ).toHaveLength(2);
    expect(
      Math.hypot(world.camera.position.x, world.camera.position.z),
    ).toBeLessThan(6);
    const cameraPosition = world.camera.position.clone();
    const sea = world.scene.getObjectByName('sea') as Mesh;
    const before = sea.geometry.getAttribute('position').getY(0);

    world.animate(12);

    expect(sea.geometry.getAttribute('position').getY(0)).not.toBe(before);
    expect(world.camera.position).toEqual(cameraPosition);
    world.scene.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof Points)) return;
      const positions = object.geometry.getAttribute('position');
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      object.geometry.computeBoundingSphere();
      expect(object.geometry.boundingSphere?.radius).toBeLessThan(250);
    });
    const direction = world.camera.getWorldDirection(new Vector3());
    expect(direction.y).toBeLessThan(0);
    world.dispose();
  });

  it('recreates the same scene on a revisit and disposes each shared resource once', () => {
    const first = buildLighthouseScene();
    const revisit = buildLighthouseScene();
    first.animate(7);
    revisit.animate(7);
    const firstSea = first.scene.getObjectByName('sea') as Mesh;
    const revisitSea = revisit.scene.getObjectByName('sea') as Mesh;
    expect(firstSea.geometry.getAttribute('position').array).toEqual(
      revisitSea.geometry.getAttribute('position').array,
    );
    const materials = new Set<Material>();
    const sky = first.scene.environment as Texture;
    const ripples = (firstSea.material as MeshStandardMaterial).normalMap!;
    vi.spyOn(sky, 'dispose');
    vi.spyOn(ripples, 'dispose');
    first.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points) {
        vi.spyOn(object.geometry, 'dispose');
        materials.add(object.material as Material);
      }
    });
    materials.forEach((material) => vi.spyOn(material, 'dispose'));

    first.dispose();

    expect(sky.dispose).toHaveBeenCalledTimes(1);
    expect(ripples.dispose).toHaveBeenCalledTimes(1);
    materials.forEach((material) =>
      expect(material.dispose).toHaveBeenCalledTimes(1),
    );
    first.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points) {
        expect(object.geometry.dispose).toHaveBeenCalledTimes(1);
      }
    });
    revisit.dispose();
  });
});
