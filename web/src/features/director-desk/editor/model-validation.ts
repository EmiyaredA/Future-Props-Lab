import {
  ASSETS,
  findAsset,
  isAnimalAsset,
  assetJoints,
} from "./asset-catalog.ts";
import { validatePropParameters } from "./parametric-props.ts";
import { validateAssetParameters } from "./assets/parameters.ts";
import {
  assertModelResources,
  assertExternalModel,
} from "./resources/project-resources.ts";
import { assertNativeClip } from "./resources/native-animation.ts";
import { assertRetargetClip } from "./resources/retarget-animation.ts";
import { assertContactAnchors } from "./assets/contact-anchors.ts";
import { assertHandBinding } from "./animation/hand-binding.ts";
import { assertStructureLinks } from "./building/structure-links.ts";
import { assertFloors } from "./building/floors.ts";
import { assertInitialPose } from "./scenes/initial-pose.ts";
import { assertProductionShape } from "./production/validation.ts";
import { assertCameraLookPath } from "./animation/camera-look.ts";
import { assertZones } from "./building/zones.ts";
import { assertEasing } from "./animation/channels.ts";
import { assertPathInterpolation } from "./animation/continuous-path.ts";
import { assertCameraEffects } from "./cinematography/camera-effects.ts";
import { assertCameraAimResponse } from "./cinematography/aim-response.ts";
import { assertLightEntity, assertLighting } from "./lighting/model.ts";
import { assertWarp } from "./visuals/warps.ts";
import {
  SURFACE_VISUALS,
  assertVisual,
  assertField,
  assertDeform,
} from "./visuals/model.ts";
import { assertMediaResources, assertSurface } from "./media/model.ts";
import { ASPECTS, FRAME_RATES, ACTIONS, clone } from "./model-constants.ts";
import type { Project, Pose } from "./model.ts";
export function assertProject(input: unknown): asserts input is Project {
  const p = input as Project;
  const fail = (message: string): never => {
    throw new Error(`项目文件无效：${message}`);
  };
  if (
    p?.creationMode !== undefined &&
    !["full", "geometry"].includes(p.creationMode)
  )
    fail("创作模式无效");
  if (
    p?.referenceLabels !== undefined &&
    typeof p.referenceLabels !== "boolean"
  )
    fail("参考视频标签开关无效");
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const v3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(n);
  if (!p || p.format !== "director-desk" || ![1, 2].includes(p.version))
    fail("不支持的文件格式或版本");
  if (
    typeof p.name !== "string" ||
    p.name.length > 200 ||
    !n(p.duration) ||
    p.duration <= 0 ||
    !FRAME_RATES.includes(p.fps) ||
    !ASPECTS.includes(p.aspect)
  )
    fail("名称、时长、画幅或帧率错误");
  if (
    !p.room ||
    typeof p.room.enabled !== "boolean" ||
    ![p.room.width, p.room.depth, p.room.height].every(
      (x) => n(x) && x >= 2.3 && x <= 10000,
    )
  )
    fail("房间各尺寸需在 2.3 至 10000 米之间");
  if (
    !Array.isArray(p.entities) ||
    !Array.isArray(p.cuts) ||
    !Array.isArray(p.references)
  )
    fail("缺少场景数据");
  assertModelResources(p);
  assertLighting(p.lighting);
  const safeId = (id: unknown) =>
    typeof id === "string" && /^[\p{L}\p{N}_:.-]{1,200}$/u.test(id);
  const ids = new Set<string>();
  for (const e of p.entities) {
    if (
      !e ||
      !safeId(e.id) ||
      ids.has(e.id) ||
      !["actor", "prop", "camera", "crowd"].includes(e.kind)
    )
      fail("对象标识或类型错误");
    ids.add(e.id);
    if (
      e.kind === "camera"
        ? e.asset !== "camera"
        : e.asset !== "external-model" &&
          !ASSETS.some((a) => a.id === e.asset && a.kind === e.kind)
    )
      fail("白模资产不存在或类型不匹配");
    if (e.kind !== "camera" && e.camera !== null)
      fail("非摄影机对象不应包含摄影机配置");
    if (
      e.path !== null &&
      (!e.path || typeof e.path !== "object" || Array.isArray(e.path))
    )
      fail("路径数据错误");
    if (
      typeof e.name !== "string" ||
      e.name.length > 200 ||
      typeof e.asset !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(e.color)
    )
      fail("对象名称或颜色错误");
    if (
      !v3(e.position) ||
      !v3(e.rotation) ||
      !v3(e.scale) ||
      e.scale.some((x) => x <= 0)
    )
      fail("对象坐标错误");
    if (
      typeof e.visible !== "boolean" ||
      typeof e.locked !== "boolean" ||
      !["slim", "normal", "broad"].includes(e.build) ||
      !["male", "female"].includes(e.gender) ||
      !n(e.height) ||
      e.height < (isAnimalAsset(e.asset) ? 0.03 : 0.2) ||
      e.height > 10
    )
      fail("人物参数错误");
    if (
      !["path", "fixed", "target"].includes(e.face) ||
      typeof e.faceTarget !== "string" ||
      typeof e.reference !== "string"
    )
      fail("朝向或参考图错误");
    if (
      !Number.isInteger(e.count) ||
      e.count < 1 ||
      e.count > 1000 ||
      !n(e.spacing) ||
      e.spacing <= 0 ||
      !n(e.seed)
    )
      fail("群演参数错误");
    const poseValid = (q: Pose) =>
      q &&
      typeof q === "object" &&
      !Array.isArray(q) &&
      Object.entries(q).every(
        ([k, v]) =>
          Object.hasOwn(assetJoints(e.asset), k) && n(v) && Math.abs(v) <= 360,
      );
    if (
      !poseValid(e.pose) ||
      !Array.isArray(e.poseKeys) ||
      e.poseKeys.some(
        (k) => !k || !n(k.time) || k.time < 0 || !poseValid(k.pose),
      )
    )
      fail("姿态数据错误");
    if (new Set(e.poseKeys.map((k) => k.time)).size !== e.poseKeys.length)
      fail("姿态关键帧时间重复");
    if (!Array.isArray(e.clips)) fail("动作数据错误");
    const capabilities = findAsset(e.asset)?.capabilities;
    if (
      capabilities &&
      e.clips.some(
        (c) =>
          c &&
          c.action !== "retarget" &&
          (c.action === "native" || !capabilities.actions.includes(c.action)),
      )
    )
      fail("该白模尚不支持此动作，请查询资产能力");
    if (
      capabilities &&
      !capabilities.pose &&
      (Object.keys(e.pose).length || e.poseKeys.length)
    )
      fail("该白模不支持关节姿态");
    if (isAnimalAsset(e.asset) && e.footContact)
      fail("该动物尚不支持自动脚底贴合");
    if (e.clips.some((c) => !c)) fail("动作片段不能为空");
    if (new Set(e.clips.map((c) => c.id)).size !== e.clips.length)
      fail("动作片段标识重复");
    const clips = [...e.clips].sort((a, b) => a.start - b.start);
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      assertNativeClip(c, !!e.external);
      assertRetargetClip(c, e, p);
      if (
        [c.offset, c.progressOffset, c.sourceDuration, c.turnAmount].some(
          (v) => v !== undefined && (!n(v) || v < 0),
        ) ||
        (c.sourceDuration !== undefined && c.sourceDuration <= 0)
      )
        fail("动作分割参数错误");
      if (
        c.name !== undefined &&
        (typeof c.name !== "string" || !c.name.trim() || c.name.length > 100)
      )
        fail("动作片段名称无效");
      if (
        !safeId(c.id) ||
        (!["native", "retarget"].includes(c.action) &&
          !Object.hasOwn(ACTIONS, c.action)) ||
        ![c.start, c.end, c.speed].every(n) ||
        c.start < 0 ||
        c.end <= c.start ||
        c.speed <= 0 ||
        (i > 0 && c.start < clips[i - 1].end)
      )
        fail("动作时间重叠或范围错误");
    }
    validatePropParameters(e);
    assertLightEntity(e);
    assertInitialPose(e.initialPose);
    if (e.kind === "camera" && e.initialPose)
      fail("摄影机使用位置与朝向继承，不使用模型姿态");
    validateAssetParameters(e);
    assertContactAnchors(e);
    assertHandBinding(e, p);
    if (e.footContact !== undefined && typeof e.footContact !== "boolean")
      fail("脚底贴合设置错误");
    if (
      e.actionBlend !== undefined &&
      (!n(e.actionBlend) || e.actionBlend < 0 || e.actionBlend > 2)
    )
      fail("动作过渡时长错误");
    if (e.path) {
      if (
        typeof e.path.smooth !== "boolean" ||
        !Array.isArray(e.path.points) ||
        e.path.points.length < 1
      )
        fail("路径至少需要一个位置点");
      e.path.points.forEach((w, i) => {
        if (
          !w ||
          !v3(w.position) ||
          !n(w.time) ||
          w.time < 0 ||
          (i > 0 && w.time <= e.path!.points[i - 1].time)
        )
          fail("路径时间必须递增");
        assertEasing(w.easing);
      });
      assertPathInterpolation(e.path);
      if (e.path.sections !== undefined) {
        if (
          !Array.isArray(e.path.sections) ||
          !e.path.sections.length ||
          e.path.sections.some((s) => !s)
        )
          fail("路径片段不能为空");
        const parts = [...e.path.sections].sort((a, b) => a.start - b.start);
        parts.forEach((s, i) => {
          if (
            !s ||
            ![s.start, s.end, s.from, s.to].every(n) ||
            s.start < 0 ||
            s.end <= s.start ||
            s.to <= s.from ||
            s.from < e.path!.points[0].time - 1e-7 ||
            s.to > e.path!.points.at(-1)!.time + 1e-7 ||
            (i > 0 && s.start < parts[i - 1].end - 1e-7)
          )
            fail("路径片段重叠或范围错误");
        });
      }
    }
    if (e.kind === "camera") {
      const c = e.camera;
      if (
        !c ||
        !["target", "manual"].includes(c.aim) ||
        !n(c.focal) ||
        c.focal < 8 ||
        c.focal > 300 ||
        !v3(c.target) ||
        !v3(c.offset) ||
        !n(c.targetHeight) ||
        typeof c.targetId !== "string" ||
        !["free", "follow", "pov"].includes(c.mode) ||
        typeof c.inheritRotation !== "boolean" ||
        !Array.isArray(c.hideWalls) ||
        c.hideWalls.some(
          (w) => !["north", "south", "east", "west", "ceiling"].includes(w),
        )
      )
        fail("摄影机参数错误");
      assertCameraLookPath(c!.targetPath);
      assertCameraAimResponse(c!.aimResponse);
      assertCameraEffects(c!.effects, (id) =>
        p.entities.some((e) => e.id === id && e.kind !== "camera"),
      );
    }
  }
  assertFloors(p);
  assertZones(p);
  assertStructureLinks(p);
  const cameras = p.entities.filter((e) => e.kind === "camera");
  for (const e of p.entities) assertExternalModel(e, p);
  if (!cameras.length) fail("至少需要一台摄影机");
  for (const e of p.entities) {
    const hidden = e.camera?.hiddenEntityIds;
    if (
      hidden !== undefined &&
      (!Array.isArray(hidden) ||
        new Set(hidden).size !== hidden.length ||
        hidden.some(
          (id) => !p.entities.some((t) => t.id === id && t.kind !== "camera"),
        ))
    )
      fail("摄影机隐藏对象重复、不存在或为摄影机");
    if (e.camera?.targetId) {
      const target = p.entities.find((t) => t.id === e.camera!.targetId);
      if (!target || target.kind === "camera")
        fail("摄影机绑定目标不存在或为摄影机");
    }
    if (e.faceTarget && !ids.has(e.faceTarget)) fail("朝向目标不存在");
  }
  if (!p.cuts.length || p.cuts[0]?.time !== 0) fail("切镜必须从零秒开始");
  p.cuts.forEach((c, i) => {
    if (
      !c ||
      !n(c.time) ||
      c.time < 0 ||
      c.time >= p.duration ||
      (i > 0 && c.time <= p.cuts[i - 1].time) ||
      !cameras.some((e) => e.id === c.cameraId)
    )
      fail("切镜时间或机位错误");
  });
  const referenceIds = new Set<string>();
  if (
    p.entities.filter((e) => e.warp && e.visible).length > 8 ||
    p.entities.filter((e) => e.field && e.visible).length > 8
  )
    fail("同时启用的空间扭曲或影响区域各最多 8 个；可隐藏暂不用的区域");
  for (const e of p.entities) {
    assertWarp(e.warp);
    assertVisual(e.visual);
    assertField(
      e.field,
      p.entities
        .filter(
          (x) => x.id !== e.id && x.kind !== "camera" && !x.field && !x.warp,
        )
        .map((x) => x.id),
    );
    assertDeform(e.deform);
    if (
      (e.asset.startsWith("visual-") && !e.visual) ||
      (e.asset.startsWith("field-") && !e.field) ||
      (e.asset.startsWith("warp-") && !e.warp)
    )
      fail("此资产缺少对应的视觉配置");
    if (e.warp && e.asset !== "warp-" + e.warp.type)
      fail("空间扭曲与资产不匹配");
    if (
      e.visual?.cameraId &&
      !p.entities.some(
        (x) => x.id === e.visual!.cameraId && x.kind === "camera",
      )
    )
      fail("传送门摄影机不存在");
    if (e.visual && e.asset !== "visual-" + e.visual.preset)
      fail("视觉元素类型与资产不匹配");
    if (e.field && e.asset !== "field-" + e.field.type)
      fail("影响区域与资产不匹配");
    if (e.deform && (e.kind === "camera" || e.field || e.warp || e.light))
      fail("此对象不支持形变");
  }
  assertMediaResources(p.media);
  for (const e of p.entities) {
    assertSurface(e.surface, p.media);
    if (e.surface && e.visual && !SURFACE_VISUALS.has(e.visual.preset))
      fail("此视觉元素不使用网格表面贴图");
    if (e.deform && e.visual && !SURFACE_VISUALS.has(e.visual.preset))
      fail("此视觉元素不支持网格形变");
    if (
      e.surface &&
      e.light &&
      (e.asset !== "light-spot" || e.surface.layers.length > 1)
    )
      fail("投影使用聚光灯，每灯一个媒体层");
    if (e.surface && e.kind === "camera") fail("摄影机不能承载表面贴图");
  }
  for (const r of p.references) {
    if (
      !r ||
      !safeId(r.id) ||
      referenceIds.has(r.id) ||
      typeof r.name !== "string" ||
      typeof r.data !== "string" ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.data)
    )
      fail("参考图标识重复或内容不是内嵌 PNG、JPEG、WebP");
    referenceIds.add(r.id);
  }
  for (const e of p.entities)
    if (e.reference && !referenceIds.has(e.reference))
      fail("对象关联的参考图不存在");
  if (p.production !== undefined) {
    const data = p.production;
    assertProductionShape(data);
    if (
      new Set(data.sceneReferenceIds).size !== data.sceneReferenceIds.length ||
      data.sceneReferenceIds.some((id) => !referenceIds.has(id))
    )
      fail("场景参考图重复或不存在");
    for (const [index, note] of data.notes.entries()) {
      if (
        note.actorId &&
        !p.entities.some((e) => e.id === note.actorId && e.kind === "actor")
      )
        fail(
          `production.notes[${index}].actorId：剧情备注关联角色不存在；应为已有 actor ID 或空字符串`,
        );
    }
  }
}
/** File boundaries return an owned copy; in-memory edits only need assertProject. */
export function validateProject(input: unknown): Project {
  assertProject(input);
  return clone(input);
}
