/** Shared catalog geometry contracts, independent of the catalogs that construct presets. */
export interface QuadrupedShape {
  body: number;
  leg: number;
  neck: number;
  head: number;
  muzzle: number;
  ear: number;
  tail: number;
  width: number;
  hoof?: boolean;
  horn?: boolean;
  species:
    | "dog"
    | "cat"
    | "rabbit"
    | "rodent"
    | "horse"
    | "cow"
    | "sheep"
    | "pig"
    | "deer"
    | "turtle"
    | "lizard"
    | "camel"
    | "bear"
    | "lion"
    | "tiger"
    | "elephant"
    | "giraffe"
    | "gorilla";
}

export interface CreatureShape {
  rig: "bird" | "fish" | "serpent";
  species:
    | "chicken"
    | "duck"
    | "pigeon"
    | "eagle"
    | "pterosaur"
    | "fish"
    | "shark"
    | "snake";
  height: number;
  body: number;
  width: number;
  leg: number;
  neck: number;
  wing: number;
}

export interface HumanProportions {
  thigh: number;
  shin: number;
  torso: number;
  upperArm: number;
  forearm: number;
  shoulder: number;
  pelvis: number;
  head: number;
  girth: number;
  form?: "elf" | "orc" | "robot" | "skeleton";
  outfit?:
    | "casual"
    | "dress"
    | "robe"
    | "armor"
    | "uniform"
    | "helmet"
    | "hat"
    | "backpack";
}
