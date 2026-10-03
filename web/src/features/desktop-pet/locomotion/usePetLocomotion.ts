import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PetGeometry,
  PetMotionFrame,
  PetEnvironment,
} from "@platform/petMotion";
import { PetLocomotion, idleMotion, type ActivitySettings } from "./controller";

export function usePetLocomotion({
  enabled,
  settings,
  blocked,
  geometry,
  onEvent,
}: {
  enabled: boolean;
  settings: ActivitySettings;
  blocked: boolean;
  geometry: () => PetGeometry | null;
  onEvent: (name: "roam" | "grab" | "drop") => void;
}) {
  const [frame, setFrame] = useState<PetMotionFrame>(idleMotion);
  const [environment, setEnvironment] = useState<PetEnvironment | null>(null);
  const [error, setError] = useState("");
  const [shape, setShape] = useState<PetGeometry | null>(null);
  const model = useRef<PetLocomotion | null>(null);
  const generation = useRef(0),
    sequence = useRef(0),
    pending = useRef(false),
    failed = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const latest = useRef({ settings, blocked, geometry, onEvent });
  latest.current = { settings, blocked, geometry, onEvent };
  const signature = JSON.stringify([settings, blocked]);
  const cancel = useCallback(() => {
    const value = model.current;
    if (!value) return;
    const next = ++generation.current;
    return window.futurePropsDesktop
      ?.cancelPetMotion?.(next)
      .then((env) => {
        if (generation.current !== next || model.current !== value) return;
        value.cancelled(env);
        setEnvironment(env);
        return env;
      })
      .catch(() => {
        if (model.current === value && generation.current === next)
          setError("运动中断失败，请关闭桌宠后重新打开");
      });
  }, []);
  useEffect(() => {
    const bridge = window.futurePropsDesktop;
    if (!enabled || !bridge?.petEnvironment || !bridge.movePetFrame) return;
    let alive = true;
    const acceptEnvironment = (env: PetEnvironment) => {
      if (!alive) return;
      failed.current = false;
      generation.current = Math.max(generation.current, env.generation);
      if (model.current) model.current.updateEnvironment(env);
      else
        model.current = new PetLocomotion(
          env,
          latest.current.settings,
          (name) => latest.current.onEvent(name),
        );
      model.current.configure(latest.current.settings, latest.current.blocked);
      setEnvironment(env);
      setFrame({ ...model.current.frame });
    };
    void bridge
      .petEnvironment()
      .then(acceptEnvironment)
      .catch(() => {
        if (alive) setError("无法读取桌面边界，请重新打开桌宠");
      });
    const off = bridge.onPetEnvironment?.((env) => {
      acceptEnvironment(env);
      cancel();
    });
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(),
        dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const value = model.current;
      if (!value || pending.current || failed.current) return;
      const body = latest.current.geometry();
      if (!body) return;
      setShape((previous) =>
        JSON.stringify(previous) === JSON.stringify(body) ? previous : body,
      );
      if (!value.step(dt, body)) {
        setFrame((current) =>
          current.state === "idle" ? current : { ...value.frame },
        );
        return;
      }
      setFrame({ ...value.frame });
      pending.current = true;
      const owner = generation.current;
      const target = { x: value.x, y: value.y };
      const operation = bridge.movePetFrame!({
        generation: owner,
        sequence: ++sequence.current,
        environmentRevision: value.environment.revision,
        x: value.x,
        y: value.y,
        geometry: body,
        manual: value.manual,
      })
        .then((env) => {
          if (!alive || owner !== generation.current) return;
          value.receipt(env, Math.max(dt, 0.016), target);
          setFrame({ ...value.frame });
          setEnvironment(env);
          setError("");
        })
        .catch(() => {
          if (!alive || owner !== generation.current) return;
          value.stop();
          setFrame({ ...value.frame });
          setError("走动失败，请关闭桌宠后重新打开");
          failed.current = true;
          void bridge.petEnvironment!()
            .then((env) => {
              if (alive && owner === generation.current) {
                value.updateEnvironment(env);
                setEnvironment(env);
              }
            })
            .catch(() => undefined);
        });
      inFlight.current = operation;
      void operation.finally(() => {
        if (inFlight.current === operation) {
          pending.current = false;
          inFlight.current = null;
        }
      });
    }, 1000 / 30);
    return () => {
      alive = false;
      off?.();
      window.clearInterval(timer);
      cancel();
      model.current = null;
    };
  }, [enabled, cancel]);
  useEffect(() => {
    const value = model.current;
    if (!value) return;
    if (blocked && value.pressing) value.release(true);
    value.configure(settings, blocked);
    cancel();
    setFrame({ ...value.frame });
    // Only actual settings/pause changes cancel a trajectory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, cancel]);
  return {
    frame,
    environment,
    shape,
    error,
    press(x: number, y: number) {
      cancel();
      model.current?.press(x, y);
      setFrame({ ...(model.current?.frame ?? idleMotion()) });
    },
    pointer(x: number, y: number) {
      model.current?.pointer(x, y);
      if (model.current) setFrame({ ...model.current.frame });
    },
    release(cancelled = false) {
      const value = model.current;
      const held = value?.manual;
      const target = value ? { x: value.x, y: value.y } : null;
      const previous = inFlight.current;
      const tap = value?.release(cancelled) ?? false;
      const interrupted = cancel();
      const owner = generation.current;
      if (
        held &&
        !cancelled &&
        target &&
        value &&
        (Math.abs(target.x - value.environment.bounds.x) > 0.5 ||
          Math.abs(target.y - value.environment.bounds.y) > 0.5)
      ) {
        pending.current = true;
        const operation = Promise.all([interrupted, previous])
          .then(async ([env]) => {
            const bridge = window.futurePropsDesktop;
            if (
              !env ||
              model.current !== value ||
              owner !== generation.current ||
              !bridge?.movePetFrame
            )
              return;
            const body = latest.current.geometry();
            if (!body) return;
            const placed = await bridge.movePetFrame({
              generation: owner,
              sequence: ++sequence.current,
              environmentRevision: env.revision,
              ...target,
              geometry: body,
              manual: true,
            });
            if (model.current !== value || owner !== generation.current) return;
            value.cancelled(placed);
            setEnvironment(placed);
            setFrame({ ...value.frame });
          })
          .catch(() => {
            if (model.current !== value || owner !== generation.current) return;
            failed.current = true;
            setError("放置失败，请关闭桌宠后重新打开");
          });
        inFlight.current = operation;
        void operation.finally(() => {
          if (inFlight.current === operation) {
            pending.current = false;
            inFlight.current = null;
          }
        });
      }
      if (model.current) setFrame({ ...model.current.frame });
      return tap;
    },
  };
}
