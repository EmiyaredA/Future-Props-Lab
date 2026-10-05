import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PetGeometry,
  PetMotionFrame,
  PetEnvironment,
  PetPosePlayback,
} from "@platform/petMotion";
import { PetLocomotion, idleMotion, type ActivitySettings } from "./controller";
import { unshiftGeometry } from "@platform/petMotion";

export type PetMotionIssue = {
  code: string;
  message: string;
} & (
  | { kind: "resource-unavailable"; severity: "warning" }
  | { kind: "pose-invalid" | "transport"; severity: "error" }
);

/** Renderer protocol codes are classified here; unknown failures remain errors. */
export function motionIssue(code: string): PetMotionIssue {
  const missing: Record<string, string> = {
    "sequence:missing-clip": "当前角色资源缺少此动作的完整画面",
    "sequence:missing-frame": "当前角色资源缺少此动作的画面帧",
    "sequence:missing-transition": "该动作缺少连续过渡姿势",
    "sequence:missing-transition-branch": "当前步相缺少连续过渡姿势",
    "sequence:missing-distance-per-cycle": "当前角色资源缺少此动作的循环步距",
    "sequence:transition-container": "此资源仅用于动作过渡，不能单独播放",
    "needs-authored-transition": "该动作缺少连续过渡姿势",
    "needs-stand-view": "当前角色资源缺少完整站姿",
    "needs-authored-turn-basis": "当前角色资源缺少连续转身画面",
    "needs-walk-turn-view": "当前角色资源缺少连续转身画面",
    "unsupported-motion-resource": "当前角色资源未提供此动作的完整姿势",
  };
  if (Object.hasOwn(missing, code))
    return {
      kind: "resource-unavailable",
      severity: "warning",
      code,
      message: `${missing[code]}，已保留当前画面并暂停自主运动`,
    };
  const registration: Record<string, string> = {
    "sequence:head-scale-mismatch": "动作画面的头部比例登记不一致",
    "sequence:missing-confirmed-travel": "无法确认动作对应的桌面位移",
    "sequence:missing-phase": "无法确认动作步相",
    "sequence:missing-support": "动作画面缺少必要支撑点",
    "sequence:support-conflict": "动作画面的支撑点相互冲突",
    "sequence:support-registration-mismatch": "动作画面的支撑点登记不一致",
    "sequence:support-handoff-missing": "动作缺少必要的支撑交接",
    "sequence:invalid-support-motion": "动作的支撑位移无效",
    "sequence:invalid-frame": "动作画面登记无效",
    "sequence:invalid-layout": "动作画面的统一尺寸登记无效",
    "sequence:invalid-time": "动作播放时间无效",
    "sequence:anchor-conflict": "动作的抓取与落脚位置相互冲突",
    "sequence:transition-entry-mismatch": "动作过渡的起始画面不一致",
    "sequence:transition-exit-mismatch": "动作过渡的结束画面不一致",
    "transition-support-mismatch": "角色姿势无法保持支撑，过渡支点不一致",
    "transition-support-plane-mismatch": "动作过渡的支撑平面不一致",
    "transition-support-handoff": "动作过渡缺少必要的支撑交接",
    "transition-bone-length-mismatch": "动作过渡的肢体比例不一致",
    "transition-entry-view-mismatch": "动作过渡的起始姿势不一致",
    "planned-pose-unreachable": "角色姿势无法保持支撑，目标超出关节可达范围",
    "initial-pose-unreachable": "角色姿势无法保持支撑，起步姿势不可达",
    "support-window-infeasible": "角色姿势无法保持支撑，支撑行程不可达",
    "missing-existing-support": "角色动作缺少已建立的支点",
    "invalid-source-floor": "角色动作的地面登记无效",
  };
  return {
    kind: "pose-invalid",
    severity: "error",
    code,
    message: `${Object.hasOwn(registration, code) ? registration[code] : "角色动作播放失败"}，已保留当前画面并停止运动，请检查角色资源`,
  };
}

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
  beginPlacementHandoff,
  commitPlacementHandoff,
  cancelPlacementHandoff,
  resourceRevision,
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
  beginPlacementHandoff?: (token: number) => boolean;
  commitPlacementHandoff?: (token: number) => boolean;
  cancelPlacementHandoff?: () => void;
  resourceRevision?: number;
  onEvent: (name: "roam" | "grab" | "drop") => void;
}) {
  const [frame, setFrame] = useState<PetMotionFrame>(idleMotion);
  const [environment, setEnvironment] = useState<PetEnvironment | null>(null);
  const [issue, setIssue] = useState<PetMotionIssue | null>(null);
  const issueRef = useRef<PetMotionIssue | null>(null);
  const reportIssue = useCallback((next: PetMotionIssue | null) => {
    issueRef.current = next;
    setIssue(next);
  }, []);
  const transportError = useCallback(
    (code: string, message: string) => {
      reportIssue({ kind: "transport", severity: "error", code, message });
    },
    [reportIssue],
  );
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
    beginPlacementHandoff,
    commitPlacementHandoff,
    cancelPlacementHandoff,
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
    beginPlacementHandoff,
    commitPlacementHandoff,
    cancelPlacementHandoff,
    onEvent,
  };
  const signature = JSON.stringify([settings, blocked, resourceRevision]);
  const previousResource = useRef(resourceRevision);
  const cancel = useCallback(() => {
    const value = model.current;
    if (!value) return;
    const next = ++generation.current;
    return window.futurePropsDesktop
      ?.cancelPetMotion?.(next)
      .then((env) => {
        if (generation.current !== next || model.current !== value) return;
        if (!env) throw new Error("Missing pet cancellation receipt");
        value.cancelled(env);
        setEnvironment(env);
        return env;
      })
      .catch(() => {
        if (model.current === value && generation.current === next)
          transportError("cancel-failed", "运动中断失败，请关闭桌宠后重新打开");
      });
  }, [transportError]);
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
        if (alive)
          transportError(
            "environment-failed",
            "无法读取桌面边界，请重新打开桌宠",
          );
      });
    const off = bridge.onPetEnvironment?.((env) => {
      latest.current.cancelPlacementHandoff?.();
      acceptEnvironment(env);
      cancel();
    });
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(),
        dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const value = model.current;
      if (!value || (pending.current && !value.pressing)) return;
      const poseFailure = latest.current.motionFailure?.();
      if (failed.current) {
        const previous = issueRef.current;
        // A transport failure still requires explicit recovery. Renderer errors
        // can recover only when its public committed-picture feedback changes;
        // an absent feedback callback is not a successful picture.
        if (previous?.kind === "transport") return;
        if (previous?.severity === "error") {
          if (
            poseFailure === undefined ||
            poseFailure === "" ||
            poseFailure === previous.code
          )
            return;
          if (poseFailure === null) {
            value.stop();
            failed.current = false;
            reportIssue(null);
            setFrame({ ...value.frame });
            return;
          }
          reportIssue(motionIssue(poseFailure));
        } else {
          if (poseFailure === previous?.code && !value.pressing) return;
          if (!poseFailure) {
            failed.current = false;
            reportIssue(null);
          }
        }
      }
      if (poseFailure) {
        failed.current = true;
        const next = motionIssue(poseFailure);
        if (
          issueRef.current?.code !== next.code &&
          (next.severity === "error" || issueRef.current?.severity !== "error")
        )
          reportIssue(next);
        // Missing artwork pauses autonomous activity. A deliberate manual drag
        // still moves the last correctly drawn cel; it never invents a pose.
        if (next.severity === "error" || !value.pressing) {
          value.stop();
          setFrame({ ...value.frame });
          void cancel();
          return;
        }
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
          if (!failed.current) reportIssue(null);
        })
        .catch(() => {
          if (!alive || owner !== generation.current) return;
          value.stop();
          setFrame({ ...value.frame });
          transportError("move-failed", "走动失败，请关闭桌宠后重新打开");
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
      latest.current.cancelPlacementHandoff?.();
      off?.();
      window.clearInterval(timer);
      cancel();
      model.current = null;
    };
  }, [enabled, cancel, reportIssue, transportError]);
  useEffect(() => {
    const value = model.current;
    if (!value) return;
    const resourceChanged = previousResource.current !== resourceRevision;
    previousResource.current = resourceRevision;
    latest.current.cancelPlacementHandoff?.();
    if ((blocked || resourceChanged) && value.pressing) value.release(true);
    if (resourceChanged) value.stop();
    value.configure(settings, blocked);
    failed.current = false;
    if (issueRef.current?.severity === "warning") reportIssue(null);
    cancel();
    setFrame({ ...value.frame });
    // Only actual settings/pause changes cancel a trajectory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, cancel, reportIssue]);
  return {
    frame,
    environment,
    shape,
    issue,
    error: issue?.severity === "error" ? issue.message : "",
    press(x: number, y: number) {
      failed.current = false;
      reportIssue(null);
      latest.current.cancelPlacementHandoff?.();
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
      if (cancelled) latest.current.cancelPlacementHandoff?.();
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
        latest.current.beginPlacementHandoff?.(owner);
        pending.current = true;
        const operation = Promise.all([interrupted, previous])
          .then(async ([env]) => {
            const bridge = window.futurePropsDesktop;
            if (model.current !== value || owner !== generation.current) return;
            if (!env || !bridge?.movePetFrame) {
              latest.current.cancelPlacementHandoff?.();
              failed.current = true;
              value.stop();
              setFrame({ ...value.frame });
              if (issueRef.current?.kind !== "transport")
                transportError(
                  "placement-unconfirmed",
                  "无法确认角色的桌面位置，请关闭桌宠后重新打开",
                );
              return;
            }
            const neutral = latest.current.placementGeometry?.();
            const raw = neutral ?? latest.current.geometry();
            if (!raw) {
              latest.current.cancelPlacementHandoff?.();
              failed.current = true;
              value.stop();
              setFrame({ ...value.frame });
              reportIssue({
                kind: "pose-invalid",
                severity: "error",
                code: "placement-geometry-unavailable",
                message: "无法确认角色的可见范围，请关闭桌宠后重新打开",
              });
              return;
            }
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
            latest.current.commitPlacementHandoff?.(owner);
            setEnvironment(placed);
            setFrame({ ...value.frame, placementShift: shift });
          })
          .catch((cause) => {
            if (model.current !== value || owner !== generation.current) return;
            latest.current.cancelPlacementHandoff?.();
            failed.current = true;
            value.stop();
            setFrame({ ...value.frame });
            const reason = cause instanceof Error ? cause.message : "";
            transportError(
              "placement-failed",
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
