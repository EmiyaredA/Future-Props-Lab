import type {
  PetEnvironment,
  PetGeometry,
  PetMotionFrame,
} from "@platform/petMotion";
import { motionPhases } from "./phases";

export type ActivitySettings = {
  roam: "off" | "calm" | "free";
  size: number;
  edgeClimbing: boolean;
  highGliding: boolean;
};
export const idleMotion = (): PetMotionFrame => ({
  state: "idle",
  facing: 1,
  edge: null,
  phase: 0,
  velocity: { x: 0, y: 0 },
  swing: 0,
});
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Pure screen-space simulation. Only host receipts advance the rendered stride. */
export class PetLocomotion {
  frame = idleMotion();
  environment: PetEnvironment;
  settings: ActivitySettings;
  x: number;
  y: number;
  private wait = 0;
  private age = 0;
  private duration = 0;
  private vertical = -1;
  private paused = false;
  private travel = { x: 0, y: 0 };
  private pressed: {
    screenX: number;
    screenY: number;
    x: number;
    y: number;
    age: number;
    held: boolean;
  } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  constructor(
    environment: PetEnvironment,
    settings: ActivitySettings,
    private readonly event: (name: "roam" | "grab" | "drop") => void,
    private readonly random = () => Math.random(),
  ) {
    this.environment = environment;
    this.settings = settings;
    this.x = environment.bounds.x;
    this.y = environment.bounds.y;
  }
  get pressing() {
    return Boolean(this.pressed);
  }
  get manual() {
    return Boolean(this.pressed?.held);
  }
  configure(settings: ActivitySettings, paused: boolean) {
    const changed =
      JSON.stringify(settings) !== JSON.stringify(this.settings) ||
      this.paused !== paused;
    this.settings = settings;
    this.paused = paused;
    if (changed && !this.pressed) this.stop();
  }
  stop() {
    this.frame = { ...idleMotion(), facing: this.frame.facing };
    this.x = this.environment.bounds.x;
    this.y = this.environment.bounds.y;
    this.wait = this.age = 0;
  }
  updateEnvironment(value: PetEnvironment) {
    this.release(true);
    this.environment = value;
    this.travel = { x: 0, y: 0 };
    this.x = value.bounds.x;
    this.y = value.bounds.y;
    this.stop();
  }
  cancelled(value: PetEnvironment) {
    if (this.pressed) {
      const dx = value.bounds.x - this.environment.bounds.x;
      const dy = value.bounds.y - this.environment.bounds.y;
      this.pressed.x += dx;
      this.pressed.y += dy;
      this.x += dx;
      this.y += dy;
      if (this.frame.grip)
        this.frame.grip = {
          x: this.frame.grip.x - dx,
          y: this.frame.grip.y - dy,
        };
    }
    this.environment = value;
    if (!this.pressed) this.stop();
  }
  receipt(
    value: PetEnvironment,
    seconds: number,
    submitted = { x: this.x, y: this.y },
  ) {
    const dx = value.bounds.x - this.environment.bounds.x;
    const dy = value.bounds.y - this.environment.bounds.y;
    this.environment = value;
    this.travel = { x: this.travel.x + dx, y: this.travel.y + dy };
    if (this.x === submitted.x && Math.abs(value.bounds.x - this.x) > 1.1)
      this.x = value.bounds.x;
    if (this.y === submitted.y && Math.abs(value.bounds.y - this.y) > 1.1)
      this.y = value.bounds.y;
    this.frame = {
      ...this.frame,
      phase:
        this.frame.phase +
        ((this.frame.state === "climb"
          ? Math.abs(dy)
          : this.frame.state === "walk"
            ? Math.abs(dx)
            : this.frame.state === "held"
              ? 0
              : Math.hypot(dx, dy)) /
          (this.settings.size * 0.22)) *
          Math.PI *
          2,
      velocity: { x: dx / seconds, y: dy / seconds },
      travel: { ...this.travel },
      strideLength: this.settings.size * 0.22,
    };
    this.frame = motionPhases(this.frame, this.age, this.duration - this.age);
  }
  private begin(state: PetMotionFrame["state"], duration = Infinity) {
    this.frame = { ...this.frame, state, velocity: { x: 0, y: 0 } };
    this.age = 0;
    this.duration = duration;
    this.frame = motionPhases(this.frame, 0, duration);
  }
  private high(geometry: PetGeometry) {
    const area = this.environment.workArea;
    return (
      area.y + area.height - 4 - (this.y + geometry.feet.y) >=
      Math.max(120, this.settings.size * 0.75)
    );
  }
  private glide(geometry: PetGeometry) {
    const area = this.environment.workArea;
    const center = this.x + geometry.feet.x;
    this.frame.facing = center < area.x + area.width / 2 ? 1 : -1;
    this.frame.edge = null;
    this.begin("glide");
  }
  private start(geometry: PetGeometry) {
    this.event("roam");
    this.frame.facing = this.random() < 0.5 ? -1 : 1;
    this.frame.edge = null;
    if (this.settings.highGliding && this.high(geometry) && this.random() < 0.5)
      this.glide(geometry);
    else this.begin("walk", 2 + this.random() * 2);
  }
  press(screenX: number, screenY: number) {
    this.stop();
    this.pressed = {
      screenX,
      screenY,
      x: this.x,
      y: this.y,
      age: 0,
      held: false,
    };
    this.lastPointer = { x: screenX, y: screenY };
    this.frame.grip = {
      x: screenX - this.environment.bounds.x,
      y: screenY - this.environment.bounds.y,
    };
  }
  private hold() {
    if (!this.pressed || this.pressed.held) return;
    this.pressed.held = true;
    this.begin("held");
    this.event("grab");
  }
  pointer(screenX: number, screenY: number) {
    const press = this.pressed;
    if (!press) return;
    const dx = screenX - press.screenX,
      dy = screenY - press.screenY;
    if (Math.hypot(dx, dy) > 4) this.hold();
    if (press.held) {
      const delta = screenX - (this.lastPointer?.x ?? screenX);
      this.frame.swing = clamp(this.frame.swing * 0.7 - delta * 0.7, -18, 18);
      this.x = press.x + dx;
      this.y = press.y + dy;
    }
    this.lastPointer = { x: screenX, y: screenY };
  }
  release(cancelled = false) {
    const held = this.pressed?.held;
    const existed = Boolean(this.pressed);
    this.pressed = null;
    this.lastPointer = null;
    this.stop();
    if (held) this.event("drop");
    return existed && !held && !cancelled;
  }
  step(seconds: number, geometry: PetGeometry) {
    const dt = clamp(seconds, 0, 0.05);
    if (this.pressed) {
      this.pressed.age += dt;
      if (this.pressed.age >= 0.15) this.hold();
      this.frame.swing *= Math.exp(-dt * 6);
      this.frame = motionPhases(this.frame, this.pressed.age - 0.15);
      return this.manual;
    }
    if (
      this.paused ||
      !this.environment.visible ||
      this.settings.roam === "off"
    )
      return false;
    if (this.frame.state === "idle") {
      this.wait += dt;
      if (this.wait + 0.00001 < (this.settings.roam === "free" ? 7 : 17))
        return false;
      this.start(geometry);
    }
    this.age += dt;
    this.frame = motionPhases(this.frame, this.age, this.duration - this.age);
    const speed =
      (this.settings.size / 220) * (this.settings.roam === "free" ? 1 : 0.7);
    const ramp = Math.max(
      0,
      Math.min(1, this.age / 0.15, (this.duration - this.age) / 0.15),
    );
    const easing = ramp * ramp * (3 - 2 * ramp);
    const area = this.environment.workArea,
      box = geometry.visible;
    const minX = area.x + 4 - box.x;
    const maxX = area.x + area.width - 4 - box.x - box.width;
    const top = area.y + 4 - box.y;
    const floor = area.y + area.height - 4 - geometry.feet.y;
    if (this.frame.state === "walk") {
      this.x += this.frame.facing * 60 * speed * easing * dt;
      if (this.x <= minX || this.x >= maxX) {
        this.x = clamp(this.x, minX, maxX);
        if (this.settings.edgeClimbing) {
          this.frame.edge = this.frame.facing < 0 ? "left" : "right";
          this.vertical = this.y <= top + 10 ? 1 : -1;
          this.begin("climb", 2 + this.random() * 3);
        } else this.frame.facing = this.frame.facing === 1 ? -1 : 1;
      }
      if (this.frame.state === "walk" && this.age >= this.duration) this.stop();
    } else if (this.frame.state === "climb") {
      this.x = this.frame.edge === "left" ? minX : maxX;
      this.y += this.vertical * 40 * speed * easing * dt;
      const hitTop = this.y <= top;
      const hitFloor = this.vertical > 0 && this.y >= floor;
      this.y = clamp(this.y, top, floor);
      if (hitTop || this.age >= this.duration) {
        if (this.settings.highGliding && this.high(geometry))
          this.glide(geometry);
        else if (hitTop) {
          this.vertical = 1;
          this.begin("climb", 2 + this.random() * 3);
        } else this.stop();
      } else if (hitFloor) this.stop();
    } else if (this.frame.state === "glide") {
      this.x += this.frame.facing * 110 * speed * easing * dt;
      this.y += 70 * speed * easing * dt;
      if (this.x <= minX || this.x >= maxX) {
        this.x = clamp(this.x, minX, maxX);
        this.frame.facing = this.x <= minX ? 1 : -1;
      }
      if (this.y >= floor) {
        this.y = floor;
        this.begin("land", 0.2);
      }
    } else if (this.frame.state === "land" && this.age >= this.duration) {
      this.event("drop");
      this.stop();
    }
    return true;
  }
}
