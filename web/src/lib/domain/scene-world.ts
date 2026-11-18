import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three/webgpu';
import type { SceneRecipe, ProceduralScene, SceneObject } from '@my2/shared';
import { buildLighthouseScene } from './lighthouse-scene';
import { disposeScene } from './scene-resources';

const SHAPES = {
  box: () => new BoxGeometry(),
  sphere: () => new SphereGeometry(0.5, 20, 12),
  cylinder: () => new CylinderGeometry(0.5, 0.5, 1, 20),
  cone: () => new ConeGeometry(0.5, 1, 20),
  torus: () => new TorusGeometry(0.5, 0.06, 8, 32),
};

function makeMaterial(object: SceneObject) {
  return new MeshStandardMaterial({
    color: object.color,
    roughness: object.material === 'metal' ? 0.35 : 0.85,
    metalness: object.material === 'metal' ? 0.5 : 0,
    transparent: object.material === 'glass',
    opacity: object.material === 'glass' ? 0.18 : 1,
    depthWrite: object.material !== 'glass',
    emissive: object.material === 'glow' ? object.color : '#000000',
    emissiveIntensity: object.material === 'glow' ? 1.2 : 0,
  });
}

export function buildProceduralScene(recipe: ProceduralScene) {
  const scene = new Scene();
  scene.background = new Color(recipe.sky);
  scene.fog = new Fog(recipe.sky, 30, 180);
  const camera = new PerspectiveCamera(55, 1, 0.1, 500);
  camera.position.fromArray(recipe.camera.position);
  camera.lookAt(...recipe.camera.target);
  scene.add(new HemisphereLight(recipe.ambient, '#34404a', 2));
  scene.add(new AmbientLight(recipe.ambient, 0.5));
  const sun = new DirectionalLight(recipe.sun.color, 2.8);
  sun.position.fromArray(recipe.sun.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
  sun.shadow.camera.right = sun.shadow.camera.top = 25;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  const geometries = new Map<string, BufferGeometry>();
  const materials = new Map<string, MeshStandardMaterial>();
  const animated: Array<{ mesh: Mesh; object: SceneObject }> = [];
  for (const object of recipe.objects) {
    let geometry = geometries.get(object.shape);
    if (!geometry) {
      geometry = SHAPES[object.shape]();
      geometries.set(object.shape, geometry);
    }
    const key = `${object.color}/${object.material}`;
    let material = materials.get(key);
    if (!material) {
      material = makeMaterial(object);
      materials.set(key, material);
    }
    const mesh = new Mesh(geometry, material);
    mesh.name = object.id;
    mesh.position.fromArray(object.position);
    mesh.rotation.set(...object.rotation);
    mesh.scale.fromArray(object.scale);
    mesh.castShadow = object.material !== 'glass';
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (object.motion !== 'still') animated.push({ mesh, object });
  }

  function animate(seconds: number) {
    for (const { mesh, object } of animated) {
      if (object.motion === 'bob')
        mesh.position.y = object.position[1] + Math.sin(seconds * 0.8) * 0.08;
      if (object.motion === 'sway')
        mesh.rotation.z = object.rotation[2] + Math.sin(seconds * 0.5) * 0.04;
    }
  }
  return { scene, camera, animate, dispose: () => disposeScene(scene) };
}

export function buildScene(recipe: SceneRecipe) {
  return recipe.kind === 'lighthouse'
    ? buildLighthouseScene()
    : buildProceduralScene(recipe);
}
