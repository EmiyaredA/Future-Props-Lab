import type {
  PetEnvironment,
  PetGeometry,
  PetMotionFrame,
  PetEdge,
  PetPosePlayback,
} from "@platform/petMotion";
import { motionOrigin } from "@platform/petMotion";
import { motionPhases } from "./phases";
import { alignEdge, horizontalEdge, nearestEdge, nextEdge } from "./edges";
import { boundedMotionTarget, remainingMotionBudget } from "./motionBudget";

export type ActivitySettings = {
  roam: "off" | "calm" | "free";
  size: number;
  edgeClimbing: boolean;
  highGliding: boolean;
  dropDuration?: number;
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
  private attached: {
    edge: PetEdge;
    age: number;
    duration: number;
    elapsed: number;
    direction: -1 | 1;
    stage: "settling" | "moving" | "resting" | "turning";
    origin: { x: number; y: number };
    from?: PetEdge;
  } | null = null;
  private placementPending = false;
  private placedDelay: number | null = null;
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
    this.x = motionOrigin(environment).x;
    this.y = motionOrigin(environment).y;
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
    if (changed && !this.pressed) {
      const attachment = this.attached;
      const previous = this.frame;
      this.stop();
      if (attachment && settings.edgeClimbing && settings.roam !== "off") {
        this.attached = {
          ...attachment,
          stage: "resting",
          age: 0,
          from: undefined,
        };
        this.frame = {
          ...previous,
          velocity: { x: 0, y: 0 },
          edgeTurn: undefined,
          attachment: "resting",
        };
      }
    }
  }
  stop() {
    this.attached = null;
    this.placementPending = false;
    this.placedDelay = null;
    this.frame = {
      ...idleMotion(),
      facing: this.frame.facing,
      travel: { ...this.travel },
    };
    this.x = motionOrigin(this.environment).x;
    this.y = motionOrigin(this.environment).y;
    this.wait = this.age = 0;
  }
  updateEnvironment(value: PetEnvironment) {
    this.release(true);
    this.environment = value;
    this.travel = { x: 0, y: 0 };
    this.x = motionOrigin(value).x;
    this.y = motionOrigin(value).y;
    this.stop();
  }
  cancelled(value: PetEnvironment) {
    if (this.pressed) {
      const dx = motionOrigin(value).x - motionOrigin(this.environment).x;
      const dy = motionOrigin(value).y - motionOrigin(this.environment).y;
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
    if (!this.pressed) {
      this.x = motionOrigin(value).x;
      this.y = motionOrigin(value).y;
    }
  }
  receipt(
    value: PetEnvironment,
    seconds: number,
    submitted = { x: this.x, y: this.y },
  ) {
    const dx = motionOrigin(value).x - motionOrigin(this.environment).x;
    const dy = motionOrigin(value).y - motionOrigin(this.environment).y;
    if (this.pressed?.held) {
      // The host can constrain a drag to the current monitor. Rebase the drag
      // origin and its local grip by the constraint, rather than applying it
      // again at every pointer update.
      const correction = {
        x: motionOrigin(value).x - submitted.x,
        y: motionOrigin(value).y - submitted.y,
      };
      this.pressed.x += correction.x;
      this.pressed.y += correction.y;
      this.x += correction.x;
      this.y += correction.y;
      if (this.frame.grip)
        this.frame.grip = {
          x: this.frame.grip.x - correction.x,
          y: this.frame.grip.y - correction.y,
        };
    }
    this.environment = value;
    this.travel = { x: this.travel.x + dx, y: this.travel.y + dy };
    if (
      this.x === submitted.x &&
      Math.abs(motionOrigin(value).x - this.x) > 1.1
    )
      this.x = motionOrigin(value).x;
    if (
      this.y === submitted.y &&
      Math.abs(motionOrigin(value).y - this.y) > 1.1
    )
      this.y = motionOrigin(value).y;
    this.frame = {
      ...this.frame,
      phase:
        this.frame.phase +
        ((this.frame.state === "climb"
          ? Math.hypot(dx, dy)
          : this.frame.state === "walk"
            ? Math.abs(dx)
            : this.frame.state === "held"
              ? 0
              : Math.hypot(dx, dy)) /
          (this.frame.strideLength ?? this.settings.size * 0.22)) *
          Math.PI *
          2,
      velocity: { x: dx / seconds, y: dy / seconds },
      travel: { ...this.travel },
      strideLength: this.frame.strideLength ?? this.settings.size * 0.22,
    };
    this.frame = motionPhases(
      this.frame,
      this.attached?.age ?? this.age,
      this.attached
        ? this.attached.stage === "moving"
          ? this.attached.duration - this.attached.elapsed
          : Infinity
        : this.duration - this.age,
    );
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
    const edge = this.settings.edgeClimbing
      ? nearestEdge(
          this.x,
          this.y,
          geometry,
          this.environment.workArea,
          this.settings.size,
        )
      : null;
    if (edge) {
      this.attach(edge, geometry, false);
      return;
    }
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
      x: screenX - motionOrigin(this.environment).x,
      y: screenY - motionOrigin(this.environment).y,
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
    this.placementPending = Boolean(held && !cancelled);
    if (held) this.event("drop");
    return existed && !held && !cancelled;
  }
  /** Called only after the last manual position has been acknowledged by the host. */
  placed(value: PetEnvironment, shape: PetGeometry) {
    if (!this.placementPending || this.pressed) return;
    this.placementPending = false;
    this.environment = value;
    this.x = motionOrigin(value).x;
    this.y = motionOrigin(value).y;
    if (
      this.paused ||
      !value.visible ||
      this.settings.roam === "off" ||
      !this.settings.edgeClimbing ||
      shape.supportedEdges?.length === 0
    )
      return;
    // Wait for the renderer's drop reaction and release anchor to settle before measuring its support planes.
    this.placedDelay = this.settings.dropDuration ?? 1.8;
  }
  private attach(edge: PetEdge, shape: PetGeometry, settle: boolean) {
    const area = this.environment.workArea;
    const direction = horizontalEdge(edge)
      ? this.x + shape.feet.x < area.x + area.width / 2
        ? 1
        : -1
      : -1;
    this.attached = {
      edge,
      direction,
      age: 0,
      duration: 2 + this.random() * 3,
      elapsed: 0,
      stage: settle ? "settling" : "moving",
      origin: { x: this.x, y: this.y },
    };
    this.begin("climb", Infinity);
    this.frame.edge = edge;
    this.frame.facing = horizontalEdge(edge)
      ? direction
      : edge === "left"
        ? -1
        : 1;
    this.frame.attachment = this.attached.stage;
  }
  private limitTarget(remaining: number) {
    if (!Number.isFinite(remaining)) return;
    const target = boundedMotionTarget(
      motionOrigin(this.environment),
      { x: this.x, y: this.y },
      remaining,
    );
    this.x = target.x;
    this.y = target.y;
  }
  private stepAttached(dt: number, shape: PetGeometry, remaining = Infinity) {
    const activity = this.attached!;
    const area = this.environment.workArea;
    if (!(shape.supportedEdges ?? ["left", "right"]).includes(activity.edge)) {
      this.stop();
      return false;
    }
    activity.age += dt;
    const interval = this.settings.roam === "free" ? 7 : 17;
    this.frame.attachment = activity.stage;
    if (activity.stage === "resting") {
      this.frame.velocity = { x: 0, y: 0 };
      if (activity.age + 0.00001 < interval) return false;
      if (
        nearestEdge(
          this.x,
          this.y,
          shape,
          area,
          this.settings.size,
          activity.edge,
        ) !== activity.edge
      ) {
        this.stop();
        return false;
      }
      activity.stage = "moving";
      activity.age = 0;
      activity.duration = 2 + this.random() * 3;
      activity.elapsed = 0;
      this.event("roam");
    }
    const aligned = alignEdge(this.x, this.y, shape, area, activity.edge);
    if (activity.stage !== "settling") activity.elapsed += dt;
    if (activity.stage === "moving" && activity.elapsed >= activity.duration) {
      activity.stage = "resting";
      activity.age = 0;
      this.frame.attachment = "resting";
      this.frame.velocity = { x: 0, y: 0 };
      return false;
    }
    if (activity.stage === "settling" || activity.stage === "turning") {
      // Allow the drop reaction to finish before changing into the edge posture.
      const delay = 0;
      if (activity.age < delay) {
        this.frame.state = "idle";
        return false;
      }
      this.frame.state = "climb";
      this.frame.edge = activity.edge;
      const u = Math.min(
        1,
        (activity.age - delay) / (activity.stage === "settling" ? 0.25 : 0.35),
      );
      const blend = u * u * (3 - 2 * u);
      this.x = activity.origin.x + (aligned.x - activity.origin.x) * blend;
      this.y = activity.origin.y + (aligned.y - activity.origin.y) * blend;
      this.limitTarget(remaining);
      this.frame.progress = u;
      if (activity.from)
        this.frame.edgeTurn = {
          from: activity.from,
          to: activity.edge,
          progress: u,
        };
      if (
        u >= 1 &&
        Math.hypot(this.x - aligned.x, this.y - aligned.y) <= 1e-7
      ) {
        activity.stage = "moving";
        activity.age = 0;
        activity.from = undefined;
        this.frame.edgeTurn = undefined;
      }
      return true;
    }
    this.x = aligned.x;
    this.y = aligned.y;
    const scale =
      (this.settings.size / 220) * (this.settings.roam === "free" ? 1 : 0.7);
    const ramp = Math.max(
      0,
      Math.min(
        1,
        activity.age / 0.15,
        (activity.duration - activity.elapsed) / 0.15,
      ),
    );
    const distance =
      40 * scale * ramp * ramp * (3 - 2 * ramp) * dt * activity.direction;
    if (horizontalEdge(activity.edge)) this.x += distance;
    else this.y += distance;
    this.limitTarget(remaining);
    const box = shape.visible;
    const minX = area.x + 4 - box.x,
      maxX = area.x + area.width - 4 - box.x - box.width;
    const minY = area.y + 4 - box.y,
      maxY = area.y + area.height - 4 - box.y - box.height;
    const corner = horizontalEdge(activity.edge)
      ? activity.direction < 0
        ? this.x <= minX
        : this.x >= maxX
      : activity.direction < 0
        ? this.y <= minY
        : this.y >= maxY;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
    if (corner) {
      const edge = nextEdge(activity.edge, activity.direction);
      if ((shape.supportedEdges ?? ["left", "right"]).includes(edge)) {
        activity.from = activity.edge;
        activity.edge = edge;
        activity.direction = horizontalEdge(edge)
          ? activity.from === "left"
            ? 1
            : -1
          : activity.from === "top"
            ? 1
            : -1;
        activity.stage = "turning";
        activity.age = 0;
        activity.origin = { x: this.x, y: this.y };
        this.frame.edge = edge;
        this.frame.facing = horizontalEdge(edge)
          ? activity.direction
          : edge === "left"
            ? -1
            : 1;
        this.frame.contactAnchors = undefined;
      } else {
        activity.direction = activity.direction === 1 ? -1 : 1;
        if (horizontalEdge(activity.edge))
          this.frame.facing = activity.direction;
      }
    } else if (activity.elapsed >= activity.duration) {
      activity.stage = "resting";
      activity.age = 0;
      this.frame.velocity = { x: 0, y: 0 };
    }
    this.frame.attachment = activity.stage;
    this.frame = motionPhases(
      this.frame,
      activity.age,
      activity.duration - activity.elapsed,
    );
    return true;
  }
  step(
    seconds: number,
    geometry: PetGeometry,
    playback?: PetPosePlayback | null,
  ) {
    const budget = this.pressed ? undefined : playback?.motionBudget;
    const remaining = budget
      ? remainingMotionBudget(budget, this.travel)
      : Infinity;
    if (
      !this.pressed &&
      this.attached?.stage !== "resting" &&
      remaining <= 1e-8
    )
      return false;
    return this.advance(seconds, geometry, playback, remaining);
  }
  private advance(
    seconds: number,
    geometry: PetGeometry,
    playback?: PetPosePlayback | null,
    remaining = Infinity,
  ) {
    const dt = clamp(seconds, 0, 0.05);
    this.frame.strideLength =
      geometry.strideLength ?? this.settings.size * 0.22;
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
    if (this.placedDelay !== null) {
      this.placedDelay -= dt;
      if (this.placedDelay > 0.00001) return false;
      if (playback && playback.progress < 1) return false;
      this.placedDelay = null;
      const edge = nearestEdge(
        this.x,
        this.y,
        geometry,
        this.environment.workArea,
        this.settings.size,
      );
      if (edge) {
        this.attach(edge, geometry, true);
        // Publish the edge entry before settling moves the host window. A
        // complete drop/entry resource can now block its first displacement.
        return false;
      }
    }
    // Full-view transitions own their resource duration. Keep the current
    // trajectory and activity/rest clocks still until their last cel is drawn.
    // Manual holding above continues to follow the pointer during this time.
    if (
      playback &&
      playback.progress < 1 &&
      !(playback.motionBudget && this.attached?.stage === "resting")
    )
      return false;
    if (this.attached) return this.stepAttached(dt, geometry, remaining);
    if (this.frame.state === "idle") {
      this.wait += dt;
      if (this.wait + 0.00001 < (this.settings.roam === "free" ? 7 : 17))
        return false;
      this.start(geometry);
      // Publish the new intent before submitting any displacement. The next
      // tick can then wait for the renderer's complete entry resource.
      return false;
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
      this.limitTarget(remaining);
      if (this.x <= minX || this.x >= maxX) {
        this.x = clamp(this.x, minX, maxX);
        if (this.settings.edgeClimbing) {
          this.attach(
            this.frame.facing < 0 ? "left" : "right",
            geometry,
            false,
          );
        } else this.frame.facing = this.frame.facing === 1 ? -1 : 1;
      }
      if (this.frame.state === "walk" && this.age >= this.duration) this.stop();
    } else if (this.frame.state === "climb") {
      this.x = this.frame.edge === "left" ? minX : maxX;
      this.y += this.vertical * 40 * speed * easing * dt;
      this.limitTarget(remaining);
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
