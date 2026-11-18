import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DodecahedronGeometry,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Material,
} from 'three/webgpu';

function makeSky() {
  const pixels = new Uint8Array(128 * 64 * 4);
  const zenith = new Color(0x789fae);
  const horizon = new Color(0xe4ddd0);
  const below = new Color(0x496c70);
  const tint = new Color();
  for (let y = 0; y < 64; y++) {
    const height = y / 63;
    tint.copy(below).lerp(horizon, Math.min(height * 2, 1));
    if (height > 0.5) tint.copy(horizon).lerp(zenith, (height - 0.5) * 2);
    for (let x = 0; x < 128; x++) {
      const offset = (y * 128 + x) * 4;
      pixels[offset] = tint.r * 255;
      pixels[offset + 1] = tint.g * 255;
      pixels[offset + 2] = tint.b * 255;
      pixels[offset + 3] = 255;
    }
  }
  const sky = new DataTexture(pixels, 128, 64);
  sky.mapping = EquirectangularReflectionMapping;
  sky.needsUpdate = true;
  return sky;
}

function makeRipples() {
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const u = (x * Math.PI) / 32;
      const v = (y * Math.PI) / 32;
      const offset = (y * 64 + x) * 4;
      pixels[offset] = 128 + Math.sin(u * 4 + Math.cos(v * 3)) * 45;
      pixels[offset + 1] = 128 + Math.cos(v * 5 + Math.sin(u * 2)) * 45;
      pixels[offset + 2] = 245;
      pixels[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, 64, 64);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(50, 50);
  texture.needsUpdate = true;
  return texture;
}

function makeSea() {
  const geometry = new PlaneGeometry(350, 350, 48, 48);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshStandardMaterial({
    color: 0x477d7b,
    metalness: 0.15,
    roughness: 0.3,
    normalMap: makeRipples(),
    normalScale: new Vector2(0.7, 0.7),
  });
  const sea = new Mesh(geometry, material);
  sea.name = 'sea';
  sea.position.y = -8;
  const positions = geometry.getAttribute('position');

  function animate(seconds: number) {
    material.normalMap!.offset.set(seconds * 0.004, seconds * 0.002);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      positions.setY(
        i,
        Math.sin(x * 0.19 + seconds * 0.6) * 0.22 +
          Math.cos(z * 0.24 - seconds * 0.45) * 0.18,
      );
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  animate(0);
  return { sea, animate };
}

function makeRoom(scene: Scene) {
  const stone = new MeshStandardMaterial({
    color: 0xaaa493,
    roughness: 0.95,
    side: DoubleSide,
  });
  const iron = new MeshStandardMaterial({
    color: 0x37525b,
    roughness: 0.65,
    metalness: 0.2,
  });
  const seam = new MeshStandardMaterial({ color: 0x827d6e, roughness: 1 });
  const glass = new MeshStandardMaterial({
    color: 0xbad9d4,
    transparent: true,
    opacity: 0.07,
    roughness: 0.15,
    metalness: 0.25,
    depthWrite: false,
    side: DoubleSide,
  });

  function place(
    geometry: BufferGeometry,
    material: Material,
    x: number,
    y: number,
    z: number,
  ) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = material !== glass;
    scene.add(mesh);
    return mesh;
  }

  place(new CylinderGeometry(6.15, 6.15, 0.35, 10), stone, 0, -0.18, 0);
  place(new CylinderGeometry(6, 6, 0.8, 10, 1, true), stone, 0, 0.4, 0);
  place(new CylinderGeometry(6.15, 6.15, 0.16, 10), iron, 0, 5.35, 0);
  place(new CylinderGeometry(6.05, 6.05, 0.13, 10, 1, true), iron, 0, 0.85, 0);

  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5;
    const between = angle + Math.PI / 10;
    place(
      new CylinderGeometry(0.085, 0.12, 4.45, 8),
      iron,
      Math.sin(angle) * 6,
      3.08,
      Math.cos(angle) * 6,
    );
    const pane = place(
      new BoxGeometry(3.62, 4.2, 0.025),
      glass,
      Math.sin(between) * 5.7,
      3.1,
      Math.cos(between) * 5.7,
    );
    pane.rotation.y = between;
    const crossbar = place(
      new BoxGeometry(3.7, 0.055, 0.07),
      iron,
      Math.sin(between) * 5.7,
      3.55,
      Math.cos(between) * 5.7,
    );
    crossbar.rotation.y = between;
    const spoke = place(
      new BoxGeometry(0.015, 0.008, 5.8),
      seam,
      Math.sin(angle) * 2.9,
      0.008,
      Math.cos(angle) * 2.9,
    );
    spoke.rotation.y = angle;
  }

  return place;
}

function makeRocks(place: ReturnType<typeof makeRoom>) {
  const rock = new MeshStandardMaterial({
    color: 0x687576,
    roughness: 1,
    flatShading: true,
  });
  const geometry = new DodecahedronGeometry(1, 0);
  for (let i = 0; i < 12; i++) {
    const island = place(
      geometry,
      rock,
      -20 + Math.sin(i * 3.7) * 16,
      -7.5,
      -25 - i * 3,
    );
    island.scale.set(1.4 + (i % 3), 1.6 + (i % 4) * 0.9, 2 + (i % 2));
    island.rotation.set(i * 0.6, i * 1.3, i * 0.2);
  }
}

function makeCradle(place: ReturnType<typeof makeRoom>) {
  const brass = new MeshStandardMaterial({
    color: 0xc6a565,
    metalness: 0.7,
    roughness: 0.32,
  });
  const darkBrass = new MeshStandardMaterial({
    color: 0x76643f,
    metalness: 0.65,
    roughness: 0.42,
  });
  place(new CylinderGeometry(0.8, 1.05, 0.23, 32), darkBrass, 0, 0.15, 0);
  place(new CylinderGeometry(0.23, 0.38, 1.15, 24), brass, 0, 0.8, 0);
  place(new CylinderGeometry(0.9, 0.64, 0.17, 32), darkBrass, 0, 1.45, 0);
  for (const height of [1.6, 2.4]) {
    const rim = place(
      new TorusGeometry(0.93, 0.055, 10, 48),
      brass,
      0,
      height,
      0,
    );
    rim.rotation.x = Math.PI / 2;
    rim.name = 'empty-cradle-rim';
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    place(
      new CylinderGeometry(0.035, 0.035, 0.8, 8),
      brass,
      Math.sin(angle) * 0.93,
      2,
      Math.cos(angle) * 0.93,
    );
  }
  const flame = place(
    new SphereGeometry(0.065, 12, 8),
    new MeshBasicMaterial({ color: 0xffd393 }),
    0,
    1.73,
    0,
  );
  flame.scale.set(0.7, 1.8, 0.7);
}

function makeDesk(place: ReturnType<typeof makeRoom>) {
  const wood = new MeshStandardMaterial({ color: 0x745239, roughness: 0.85 });
  place(new BoxGeometry(1.7, 0.14, 0.85), wood, -3.4, 0.97, -1.2);
  for (const x of [-4.05, -2.75]) {
    for (const z of [-1.5, -0.9]) {
      place(new BoxGeometry(0.09, 0.92, 0.09), wood, x, 0.46, z);
    }
  }
  const pages = new MeshStandardMaterial({ color: 0xe8dfc2, roughness: 1 });
  const book = place(
    new BoxGeometry(0.55, 0.045, 0.38),
    pages,
    -3.4,
    1.065,
    -1.2,
  );
  book.rotation.y = -0.25;
}

function makeDust() {
  const positions = [];
  for (let i = 0; i < 65; i++) {
    positions.push(
      Math.sin(i * 4.7) * 4.7,
      0.8 + (i % 13) * 0.3,
      Math.cos(i * 2.3) * 4.7,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new Points(
    geometry,
    new PointsMaterial({
      color: 0xf8dfac,
      size: 0.035,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
}

/** Only public lantern-room scenery: the missing lens and all hidden evidence stay absent. */
export function buildLighthouseScene() {
  const scene = new Scene();
  const sky = makeSky();
  scene.background = scene.environment = sky;
  scene.environmentIntensity = 0.7;
  scene.fog = new Fog(0xb8cbd0, 35, 180);
  const camera = new PerspectiveCamera(62, 1, 0.1, 250);
  camera.position.set(3.5, 2.8, 4.65);
  camera.lookAt(-0.7, 1.9, -1.2);

  scene.add(new HemisphereLight(0xd8eef0, 0x706451, 2.5));
  scene.add(new AmbientLight(0xffdec0, 0.3));
  const sun = new DirectionalLight(0xffe5b5, 3.2);
  sun.position.set(-9, 12, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
  sun.shadow.camera.right = sun.shadow.camera.top = 8;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const lamp = new PointLight(0xffbb60, 4, 6, 2);
  lamp.position.set(0, 1.9, 0);
  scene.add(lamp);

  const place = makeRoom(scene);
  makeCradle(place);
  makeDesk(place);
  makeRocks(place);
  const { sea, animate: animateSea } = makeSea();
  scene.add(sea);
  const dust = makeDust();
  scene.add(dust);

  function animate(seconds: number) {
    animateSea(seconds);
    dust.rotation.y = Math.sin(seconds * 0.025) * 0.07;
    dust.position.y = Math.sin(seconds * 0.18) * 0.045;
    lamp.intensity = 4 + Math.sin(seconds * 2.3) * 0.15;
  }

  function dispose() {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
        }
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    sky.dispose();
    sea.material.normalMap!.dispose();
    sun.shadow.dispose();
  }

  return { scene, camera, animate, dispose };
}
