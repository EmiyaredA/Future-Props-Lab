import { sampleVisual } from "../visuals/runtime.ts";
import { sampleFields, sampleParticleFields } from "../visuals/fields.ts";
import { DeformationRuntime } from "../visuals/deformation.ts";
import { SurfaceRuntime } from "../media/surface-runtime.ts";
import { SceneLighting } from "../lighting/runtime.ts";

import { fitFeetToSurface } from "../editor/foot-contact.ts";

import {
  applyCameraEffects,
  cameraFocal,
} from "../cinematography/camera-effects.ts";
import { cameraAimResponseQuaternion } from "../cinematography/aim-response.ts";

import { InitialPoseRuntime } from "../scenes/initial-pose-runtime.ts";
import { inheritedPoseAt } from "../scenes/initial-pose.ts";

import { ContactMarker } from "../editor/contact-marker.ts";
import {
  applyHandBinding,
  type HandBinding,
} from "../animation/hand-binding.ts";
import { builtinHandFrame } from "../animation/hand-frame.ts";
import { footSurfaceQuery } from "../animation/contact-surfaces.ts";
import { transitionGroundingAt } from "../animation/transition-plan.ts";
import { SceneModels } from "../resources/scene-models.ts";
import { isExternalModel } from "../resources/project-resources.ts";

import * as T from "three";

import type { Rig } from "../assets.ts";
import { animateHuman } from "../assets.ts";
import { scaleHuman, colorHuman } from "../assets/humanoid.ts";
import { animateActor } from "../assets/actors.ts";
import { applyHumanPose } from "../assets/human-animation.ts";
import { crowdAnimationPhase } from "../resources/retarget-animation.ts";
import { Entity, Project } from "../model.ts";
import { aspectNumber } from "../model.ts";
import { entityPosition, entityYaw, sampledAction } from "../timeline.ts";
export function configureCamera(
  camera: T.PerspectiveCamera,
  focal: number,
  aspect: number,
) {
  camera.aspect = aspect;
  camera.filmGauge = 36;
  camera.setFocalLength(focal);
  camera.near = 0.025;
  camera.far = 2000;
  camera.updateProjectionMatrix();
}

export type SceneSamplingInput = {
  project: Project;
  models: Map<string, T.Group>;
  rigs: Map<string, Rig>;
  crowdRigs: Map<string, Rig[]>;
  roomGroup: T.Group;
  scene: T.Scene;
  initialPoses: InitialPoseRuntime;
  externalModels: SceneModels;
  deformations: DeformationRuntime;
  surfaces: SurfaceRuntime;
  lighting: SceneLighting;
  cameras: Map<string, T.PerspectiveCamera>;
  cameraVisuals: Map<string, T.Group>;
  monochrome: boolean;
  previewQuality: "full" | "draft";
  exporting: boolean;
  editorRenderer: T.WebGLRenderer;
  shotRenderer: T.WebGLRenderer;
  contactMarker: ContactMarker;
  targetPosition: (entity: Entity) => T.Vector3;
  handFrame: (
    binding: Pick<HandBinding, "actorId" | "hand">,
  ) => ReturnType<typeof builtinHandFrame>;
};

/** Samples one deterministic scene frame; Engine retains resource lifecycle and editor UI. */
export function sampleScene(input: SceneSamplingInput, time: number) {
  const {
    project,
    models,
    rigs,
    crowdRigs,
    roomGroup,
    scene,
    initialPoses,
    externalModels,
    deformations,
    surfaces,
    lighting,
    cameras,
    cameraVisuals,
    monochrome,
    previewQuality,
    exporting,
    editorRenderer,
    shotRenderer,
    contactMarker,
    targetPosition,
    handFrame,
  } = input;
  for (const e of project.entities) {
    const root = models.get(e.id)!;
    initialPoses.restore(e);
    root.visible = e.visible;
    root.position.copy(entityPosition(e, time));
    root.rotation.set(
      e.rotation[0],
      e.kind === "actor" || e.kind === "crowd"
        ? entityYaw(e, time, project)
        : e.rotation[1],
      e.rotation[2],
    );
    if (isExternalModel(e)) externalModels.sample(e, monochrome, time);
    else if (e.kind === "actor") {
      const r = rigs.get(e.id)!;
      scaleHuman(r, e);
      if (externalModels.sampleHuman(e, time)) applyHumanPose(r, e, time);
      else animateActor(r, e, time);
      colorHuman(r, monochrome ? "#d9dcd7" : e.color);
    } else {
      root.scale.fromArray(e.scale);
      if (e.kind === "crowd")
        crowdRigs.get(e.id)?.forEach((r, i) => {
          const phase = crowdAnimationPhase(e.seed, i);
          if (externalModels.sampleHuman(e, time, `${e.id}:${i}`, phase))
            applyHumanPose(r, e, time);
          else animateHuman(r, e, time, phase);
          colorHuman(r, monochrome ? "#d9dcd7" : e.color);
        });
    }
  }
  deformations.prepareVisuals();
  for (const e of project.entities)
    if (e.visual || e.field || e.warp)
      sampleVisual(
        e,
        models.get(e.id)!,
        time,
        previewQuality === "draft" && !exporting,
      );
  for (const e of project.entities)
    if (e.visual?.preset === "portal") {
      const mesh = models.get(e.id)?.children[0];
      if (mesh)
        mesh.userData.portalCamera = cameras.get(e.visual.cameraId ?? "");
    }
  sampleFields(project.entities, models, time);
  sampleParticleFields(project.entities, models, time);
  deformations.sample(project.entities, models, time);
  scene.updateMatrixWorld(true);
  for (const e of project.entities)
    if (initialPoses.apply(e, time)) {
      const rig = rigs.get(e.id);
      if (rig) applyHumanPose(rig, e, time);
      crowdRigs.get(e.id)?.forEach((r) => applyHumanPose(r, e, time));
    }
  const grounded = project.entities.filter(
    (e) =>
      e.visible && !inheritedPoseAt(e, time) && transitionGroundingAt(e, time),
  );
  if (grounded.length) {
    const surfaces = project.entities
      .filter(
        (e) => e.kind === "prop" && !e.light && e.visible && !e.handBinding,
      )
      .map((e) => models.get(e.id)!);
    if (project.room.enabled) surfaces.push(roomGroup);
    const query = footSurfaceQuery(surfaces);
    for (const e of grounded) {
      const root = models.get(e.id)!;
      const samplePose =
        (id: string, rig?: Rig, phase = 0) =>
        (entity: Entity, at: number) => {
          root.position.copy(entityPosition(entity, at));
          root.rotation.set(
            entity.rotation[0],
            entityYaw(entity, at, project),
            entity.rotation[2],
          );
          if (entity.external) externalModels.sample(entity, monochrome, at);
          else if (rig) {
            if (externalModels.sampleHuman(entity, at, id, phase))
              applyHumanPose(rig, entity, at);
            else animateHuman(rig, entity, at, phase);
          }
          root.updateWorldMatrix(true, true);
          root.updateMatrixWorld(true);
        };
      if (e.kind === "crowd")
        crowdRigs.get(e.id)?.forEach((rig, i) => {
          const id = `${e.id}:${i}`,
            phase = crowdAnimationPhase(e.seed, i);
          externalModels.groundHuman(
            e,
            time,
            query,
            id,
            samplePose(id, rig, phase),
            phase,
          );
        });
      else
        externalModels.groundHuman(
          e,
          time,
          query,
          e.id,
          samplePose(e.id, rigs.get(e.id)),
        );
    }
  }
  const contactActors = project.entities.filter(
    (e) =>
      e.kind === "actor" &&
      e.visible &&
      !inheritedPoseAt(e, time) &&
      e.footContact &&
      ["idle", "walk", "run", "wave", "point", "turn"].includes(
        sampledAction(e, time).action,
      ),
  );
  if (contactActors.length) {
    const surfaces = project.entities
      .filter(
        (e) => e.kind === "prop" && !e.light && e.visible && !e.handBinding,
      )
      .map((e) => models.get(e.id)!);
    if (project.room.enabled) surfaces.push(roomGroup);
    const ray = new T.Raycaster();
    ray.ray.direction.set(0, -1, 0);
    ray.far = 2;
    const surface = (x: number, y: number, z: number) => {
      ray.ray.origin.set(x, y, z);
      const hit = ray
        .intersectObjects(surfaces, true)
        .find(
          (h) =>
            h.face &&
            h.face.normal.clone().transformDirection(h.object.matrixWorld).y >
              0.5,
        );
      return hit?.point.y ?? (y >= 0 && y <= 2 ? 0 : null);
    };
    contactActors.forEach((e) => fitFeetToSurface(rigs.get(e.id)!, surface));
  }
  for (const e of project.entities)
    if (e.handBinding) {
      const root = models.get(e.id)!;
      applyHandBinding(root, e.handBinding, handFrame(e.handBinding));
      root.visible =
        e.visible &&
        !!project.entities.find((a) => a.id === e.handBinding!.actorId)
          ?.visible;
    }
  contactMarker.update(project.entities, models);
  surfaces.textures.maxEdge =
    previewQuality === "draft" && !exporting ? 1024 : 2048;
  surfaces.sample(project, models, time);
  lighting.sample(scene, project.lighting, project.entities, models, time, [
    editorRenderer,
    shotRenderer,
  ]);
  for (const e of project.entities.filter((x) => x.kind === "camera")) {
    const c = e.camera!,
      camera = cameras.get(e.id)!;
    camera.position.copy(entityPosition(e, time));
    const target = c.targetId
      ? project.entities.find((x) => x.id === c.targetId)
      : null;
    if ((c.mode === "follow" || c.mode === "pov") && target) {
      const targetRoot = models.get(target.id)!;
      const offset = new T.Vector3(...c.offset);
      if (c.mode === "pov") {
        const rig = rigs.get(target.id);
        if (rig && c.inheritRotation) {
          offset.y -= rig.headRestHeight ?? 1.53;
          camera.position.copy(rig.head.localToWorld(offset));
          const q = rig.head.getWorldQuaternion(new T.Quaternion());
          camera.lookAt(
            camera.position
              .clone()
              .add(new T.Vector3(0, 0, 1).applyQuaternion(q)),
          );
        } else {
          camera.position.copy(targetRoot.localToWorld(offset));
          const q = targetRoot.getWorldQuaternion(new T.Quaternion());
          camera.lookAt(
            camera.position
              .clone()
              .add(new T.Vector3(0, 0, 1).applyQuaternion(q)),
          );
        }
      } else {
        const lagTime = Math.max(0, time - (c.effects?.followLag ?? 0));
        if (c.inheritRotation)
          offset.applyAxisAngle(
            new T.Vector3(0, 1, 0),
            c.effects?.followLag
              ? entityYaw(target, lagTime, project)
              : targetRoot.rotation.y,
          );
        camera.position
          .copy(
            c.effects?.followLag && !target.handBinding
              ? entityPosition(target, lagTime)
              : targetRoot.position,
          )
          .add(offset);
        camera.lookAt(targetPosition(e));
      }
    } else if (c.aim === "manual") camera.rotation.set(...e.rotation);
    else camera.lookAt(targetPosition(e));
    const aimResponse = cameraAimResponseQuaternion(
      e,
      project,
      time,
      target ? models.get(target.id) : undefined,
    );
    if (aimResponse) camera.quaternion.copy(aimResponse);
    configureCamera(
      camera,
      cameraFocal(
        c.effects,
        time,
        c.focal,
        camera.position.distanceTo(targetPosition(e)),
      ),
      aspectNumber(project.aspect),
    );
    applyCameraEffects(camera, c.effects, time);
    camera.updateMatrixWorld(true);
    const visual = cameraVisuals.get(e.id)!;
    visual.position.copy(camera.position);
    visual.quaternion.copy(camera.quaternion);
    visual.visible = e.visible;
  }
}
