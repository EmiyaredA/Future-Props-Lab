import {
  Color,
  Fog,
  type MeshStandardMaterial,
  type Object3D,
  type Scene,
} from "three";

/** Editor-only colors are restored even if rendering fails. Captures never call this. */
export function renderEditorAppearance(
  scene: Scene,
  ground: MeshStandardMaterial,
  background: Color,
  floor: Color | undefined,
  render: () => void,
  skies: (Object3D | undefined)[] = [],
) {
  const originalBackground = scene.background;
  const originalFog = scene.fog;
  const originalGround = ground.color.clone();
  const visibility = skies.map((sky) => sky?.visible);
  try {
    for (const sky of skies) if (sky) sky.visible = false;
    scene.background = background;
    scene.fog = new Fog(background, 65, 180);
    if (floor) ground.color.copy(floor);
    render();
  } finally {
    scene.background = originalBackground;
    scene.fog = originalFog;
    ground.color.copy(originalGround);
    skies.forEach((sky, index) => {
      if (sky) sky.visible = visibility[index]!;
    });
  }
}
