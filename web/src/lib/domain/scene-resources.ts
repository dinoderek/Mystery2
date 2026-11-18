import {
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Points,
  Texture,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three/webgpu';

/** Shared meshes and textures are released once when a scene leaves the page. */
export function disposeScene(scene: Scene) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  if (scene.background instanceof Texture) textures.add(scene.background);
  if (scene.environment) textures.add(scene.environment);
  scene.traverse((object) => {
    if (object instanceof DirectionalLight || object instanceof PointLight)
      object.shadow.dispose();
    if (!(object instanceof Mesh || object instanceof Points)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material);
      if (material instanceof MeshStandardMaterial && material.normalMap)
        textures.add(material.normalMap);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}
