import { Color, Fog, MeshStandardMaterial, Object3D, Scene } from "three";
import { expect, test } from "vitest";
import { renderEditorAppearance } from "../../vendor/toonflow/truman-map/editorAppearance";

test.each([false, true])(
  "editing palette restores world colors after rendering (failure=%s)",
  (fail) => {
    const scene = new Scene();
    const background = new Color("#f5f7fa");
    const fog = new Fog("#e5e7eb", 10, 100);
    const material = new MeshStandardMaterial({ color: "#f0eeee" });
    const color = material.color.clone();
    const sky = new Object3D();
    scene.background = background;
    scene.fog = fog;
    const render = () =>
      renderEditorAppearance(
        scene,
        material,
        new Color("#343a3d"),
        new Color("#3a4042"),
        () => {
          expect(scene.background).not.toBe(background);
          expect(material.color.getHexString()).toBe("3a4042");
          expect(sky.visible).toBe(false);
          if (fail) throw new Error("context lost");
        },
        [sky],
      );
    if (fail) expect(render).toThrow("context lost");
    else render();
    expect(scene.background).toBe(background);
    expect(scene.fog).toBe(fog);
    expect(material.color.equals(color)).toBe(true);
    expect(sky.visible).toBe(true);
    material.dispose();
  },
);
