import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Mesh, Points } from 'three/webgpu';
import { SceneManifestSchema } from '@my2/shared';
import { buildScene } from './scene-world';
import { createProceduralScene } from '../../../../tests/testkit/src/fixtures';

describe('the recipe renderer', () => {
  it('builds each of the mock case scenes with finite geometry, stable cameras, and repeatable motion', () => {
    const manifest = SceneManifestSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.resolve('../tests/testkit/src/mock-case-scenes.json'),
          'utf8',
        ),
      ),
    );
    expect(manifest.scenes.length).toBeGreaterThan(0);
    for (const recipe of manifest.scenes) {
      const world = buildScene(recipe);
      const camera = world.camera.position.clone();
      world.animate(12);
      expect(world.camera.position).toEqual(camera);
      world.scene.traverse((object) => {
        if (!(object instanceof Mesh || object instanceof Points)) return;
        expect(
          Array.from(object.geometry.getAttribute('position').array).every(
            Number.isFinite,
          ),
        ).toBe(true);
        expect(object.position.toArray().every(Number.isFinite)).toBe(true);
      });
      world.animate(0);
      for (const object of recipe.objects)
        expect(
          world.scene.getObjectByName(object.id)?.position.toArray(),
        ).toEqual(object.position);
      world.dispose();
    }
  });

  it('shares geometry and materials and frees each shared resource only once', () => {
    const base = createProceduralScene();
    const world = buildScene({
      ...base,
      objects: [
        base.objects[0],
        { ...base.objects[0], id: 'second', position: [2, 0, 0] },
      ],
    });
    const first = world.scene.getObjectByName('floor') as Mesh;
    const second = world.scene.getObjectByName('second') as Mesh;
    expect(second.geometry).toBe(first.geometry);
    expect(second.material).toBe(first.material);
    const geometry = vi.spyOn(first.geometry, 'dispose');
    const material = Array.isArray(first.material)
      ? first.material[0]
      : first.material;
    const dispose = vi.spyOn(material, 'dispose');
    first.material = [material, material];
    world.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
