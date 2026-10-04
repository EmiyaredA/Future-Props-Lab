import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PetGeometry,
  PetMotionFrame,
  PetEnvironment,
  PetPosePlayback,
} from "@platform/petMotion";
import { PetLocomotion, idleMotion, type ActivitySettings } from "./controller";
import { unshiftGeometry } from "@platform/petMotion";

export function usePetLocomotion({
  enabled,
  settings,
  blocked,
  geometry,
  placementGeometry,
  placementDelta,
  motionFailure,
  motionTransition,
  cancelPlayback,
  onEvent,
}: {
  enabled: boolean;
  settings: ActivitySettings;
  blocked: boolean;
  geometry: () => PetGeometry | null;
  placementGeometry?: () => PetGeometry | null;
  placementDelta?: () => { x: number; y: number };
  motionFailure?: () => string | null;
  motionTransition?: () => PetPosePlayback | null;
  cancelPlayback?: () => void;
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
  const latest = useRef({
    settings,
    blocked,
    geometry,
    placementGeometry,
    placementDelta,
    motionFailure,
    motionTransition,
    cancelPlayback,
    onEvent,
  });
  latest.current = {
    settings,
    blocked,
    geometry,
    placementGeometry,
    placementDelta,
    motionFailure,
    motionTransition,
    cancelPlayback,
    onEvent,
  };
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
      if (!value || failed.current || (pending.current && !value.pressing))
        return;
      const poseFailure = latest.current.motionFailure?.();
      if (poseFailure) {
        failed.current = true;
        value.stop();
        setFrame({ ...value.frame });
        setError(
          poseFailure.includes("unsupported")
            ? "当前角色资源不支持自然运动，已停止自主运动，请更新角色资源"
            : poseFailure.includes("view") ||
                poseFailure === "needs-authored-transition"
              ? "该动作缺少连续过渡姿势，已停止自主运动"
              : "角色姿势无法保持支撑，已停止自主运动，请更新角色资源",
        );
        void cancel();
        return;
      }
      const raw = latest.current.geometry();
      if (!raw) return;
      const body = unshiftGeometry(raw, value.environment.sceneOffset);
      setShape((previous) =>
        JSON.stringify(previous) === JSON.stringify(body) ? previous : body,
      );
      if (!value.step(dt, body, latest.current.motionTransition?.())) {
        setFrame((current) =>
          JSON.stringify(current) === JSON.stringify(value.frame)
            ? current
            : { ...value.frame },
        );
        return;
      }
      setFrame({ ...value.frame });
      // Network backpressure must not suspend the 150ms gesture threshold or
      // held settling. Only the latest target is sent once the in-flight RPC ends.
      if (pending.current) return;
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
        grab: value.manual ? value.frame.grip : undefined,
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
    failed.current = false;
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
      failed.current = false;
      setError("");
      latest.current.cancelPlayback?.();
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
      const shift = latest.current.placementDelta?.() ?? { x: 0, y: 0 };
      const target = value
        ? { x: value.x + shift.x, y: value.y + shift.y }
        : null;
      const previous = inFlight.current;
      const tap = value?.release(cancelled) ?? false;
      const interrupted = cancel();
      const owner = generation.current;
      if (held && !cancelled && target && value) {
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
            const neutral = latest.current.placementGeometry?.();
            const raw = neutral ?? latest.current.geometry();
            if (!raw) return;
            const body = unshiftGeometry(raw, {
              x:
                (value.environment.sceneOffset?.x ?? 0) +
                (neutral ? 0 : shift.x),
              y:
                (value.environment.sceneOffset?.y ?? 0) +
                (neutral ? 0 : shift.y),
            });
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
            value.placed(placed, body);
            setEnvironment(placed);
            setFrame({ ...value.frame, placementShift: shift });
          })
          .catch((cause) => {
            if (model.current !== value || owner !== generation.current) return;
            failed.current = true;
            value.stop();
            setFrame({ ...value.frame });
            const reason = cause instanceof Error ? cause.message : "";
            setError(
              reason.includes("当前系统无法")
                ? "当前系统无法在该位置显示完整角色，请移回桌面范围"
                : reason.includes("可见范围") ||
                    reason.includes("接触边缘") ||
                    reason.includes("几何")
                  ? "无法确认角色的可见范围，请关闭桌宠后重新打开"
                  : "放置失败，请关闭桌宠后重新打开",
            );
            console.error("Pet placement failed", cause);
          });
        inFlight.current = operation;
        void operation.finally(() => {
          if (inFlight.current === operation) {
            pending.current = false;
            inFlight.current = null;
          }
        });
      }
      if (model.current && (!held || cancelled))
        setFrame({ ...model.current.frame });
      return tap;
    },
  };
}
