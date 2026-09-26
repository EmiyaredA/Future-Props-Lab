import { unzipSync, strFromU8 } from "fflate";
import coreUrl from "../../../vendor/cubism-sdk-5-r5/Core/live2dcubismcore.min.js?url";

export interface CubismMetadata {
  modelPath: string;
  mocPath: string;
  textures: string[];
  motions: Record<string, string[]>;
  expressions: { name: string; path: string }[];
  physics: boolean;
  pose: boolean;
  fileCount: number;
  sdkCheck: string;
}

export interface CubismParameter {
  id: string;
  minimum: number;
  maximum: number;
  defaultValue: number;
}

export interface CubismDrawable {
  id: string;
  textureIndex: number;
  positions: number[];
  uvs: number[];
  triangles: number[];
  opacity: number;
  order: number;
  masks: number[];
  blendMode: number;
}

let coreReady: Promise<void> | null = null;
function loadCore(): Promise<void> {
  if (coreReady) return coreReady;
  coreReady = new Promise<void>((resolve, reject) => {
    if (typeof Live2DCubismCore !== "undefined") {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = coreUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("官方 Cubism Core 无法加载"));
    document.head.append(script);
  });
  return coreReady;
}

type FrameworkModule = typeof import("../../../vendor/cubism-sdk-5-r5/framework.js");
let frameworkReady: Promise<FrameworkModule> | null = null;
async function framework(): Promise<FrameworkModule> {
  await loadCore();
  frameworkReady ??= import("../../../vendor/cubism-sdk-5-r5/framework.js").then((sdk) => {
    sdk.CubismFramework.startUp();
    sdk.CubismFramework.initialize();
    return sdk;
  });
  return frameworkReady;
}

function bytes(files: Record<string, Uint8Array>, path: string): Uint8Array {
  const value = files[path];
  if (!value) throw new Error(`Cubism 文件缺失：${path}`);
  return value;
}

function exactBuffer(source: Uint8Array): ArrayBuffer {
  return source.slice().buffer as ArrayBuffer;
}

export class CubismRuntime {
  private constructor(
    private canvas: HTMLCanvasElement,
    private gl: WebGLRenderingContext,
    // The official Framework JS is bundled separately and owns these instances.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private model: any,
    private sdk: FrameworkModule,
    private textures: WebGLTexture[],
    private motions: Map<string, unknown>,
    private expressions: Map<string, unknown>,
    private files: Record<string, Uint8Array>,
  ) {}

  static async open(canvas: HTMLCanvasElement, archive: Blob, metadata: CubismMetadata): Promise<CubismRuntime> {
    const sdk = await framework();
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true }) ??
      canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL 不可用；Cubism 预览需要图形加速");
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const settings = JSON.parse(strFromU8(bytes(files, metadata.modelPath))) as { FileReferences?: Record<string, unknown> };
    const mocBytes = exactBuffer(bytes(files, metadata.mocPath));
    if (Live2DCubismCore.Version.csmGetMocVersion(mocBytes) > Live2DCubismCore.Version.csmGetLatestMocVersion()) {
      throw new Error("此 .moc3 版本高于当前 Cubism SDK 支持版本");
    }
    const model = new sdk.CubismUserModel();
    model.loadModel(mocBytes, true);
    if (!model.getModel()) throw new Error("官方 SDK 无法加载此 .moc3");
    model.createRenderer(canvas.width, canvas.height);
    model.getRenderer().startUp(gl);
    const textures: WebGLTexture[] = [];
    try {
      for (const [index, path] of metadata.textures.entries()) {
        const source = await createImageBitmap(new Blob([new Uint8Array(bytes(files, path))], { type: "image/png" }));
        const texture = gl.createTexture();
        if (!texture) throw new Error("无法创建 Cubism 贴图");
        textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        source.close();
        model.getRenderer().bindTexture(index, texture);
      }
      const root = metadata.modelPath.includes("/") ? metadata.modelPath.slice(0, metadata.modelPath.lastIndexOf("/") + 1) : "";
      const ref = settings.FileReferences ?? {};
      for (const [key, loader] of [
        ["Physics", "loadPhysics"], ["Pose", "loadPose"],
      ] as const) {
        const path = ref[key];
        if (typeof path === "string") {
          const value = bytes(files, root + path);
          model[loader](exactBuffer(value), value.byteLength);
        }
      }
      const motions = new Map<string, unknown>();
      for (const [group, paths] of Object.entries(metadata.motions)) {
        for (const [index, path] of paths.entries()) {
          const value = bytes(files, path);
          motions.set(`${group}:${index}`, model.loadMotion(exactBuffer(value), value.byteLength, `${group}:${index}`));
        }
      }
      const expressions = new Map<string, unknown>();
      for (const expression of metadata.expressions) {
        const value = bytes(files, expression.path);
        expressions.set(expression.name, model.loadExpression(exactBuffer(value), value.byteLength, expression.name));
      }
      return new CubismRuntime(canvas, gl, model, sdk, textures, motions, expressions, files);
    } catch (error) {
      model.release();
      textures.forEach((texture) => gl.deleteTexture(texture));
      throw error;
    }
  }

  parameters(): CubismParameter[] {
    const m = this.model.getModel();
    return Array.from({ length: m.getParameterCount() }, (_, index) => ({
      id: m.getParameterId(index).getString(),
      minimum: m.getParameterMinimumValue(index),
      maximum: m.getParameterMaximumValue(index),
      defaultValue: m.getParameterDefaultValue(index),
    }));
  }

  canvasSize(): { width: number; height: number } {
    const m = this.model.getModel();
    return { width: m.getCanvasWidth(), height: m.getCanvasHeight() };
  }

  parameterKeys(index: number): number[] {
    return Array.from(this.model.getModel()._model.parameters.keyValues[index] as Float32Array);
  }

  drawables(): CubismDrawable[] {
    const m = this.model.getModel();
    const raw = m._model.drawables;
    return Array.from({ length: m.getDrawableCount() }, (_, index) => ({
      id: m.getDrawableId(index).getString(),
      textureIndex: m.getDrawableTextureIndex(index),
      positions: Array.from(m.getDrawableVertexPositions(index) as Float32Array),
      uvs: Array.from(m.getDrawableVertexUvs(index) as Float32Array),
      triangles: Array.from(m.getDrawableVertexIndices(index) as Uint16Array),
      opacity: m.getDrawableOpacity(index),
      order: raw.drawOrders[index],
      masks: Array.from(m.getDrawableMasks()[index] as Int32Array),
      blendMode: m.getDrawableBlendMode(index),
    }));
  }

  sampleParameter(index: number, value: number): CubismDrawable[] {
    const m = this.model.getModel();
    m.loadParameters();
    m.setParameterValueByIndex(index, value);
    m.update();
    return this.drawables();
  }

  file(path: string): Uint8Array {
    return bytes(this.files, path);
  }

  play(motionKey: string, expressionName: string): void {
    this.model._motionManager.stopAllMotions();
    this.model._expressionManager.stopAllMotions();
    const motion = this.motions.get(motionKey);
    const expression = this.expressions.get(expressionName);
    if (motion) this.model._motionManager.startMotionPriority(motion, false, 1);
    if (expression) this.model._expressionManager.startMotion(expression, false);
  }

  draw(deltaSeconds: number, camera: "avatar" | "stage", overrides: Record<string, number>): void {
    const m = this.model.getModel();
    m.loadParameters();
    this.model._motionManager.updateMotion(m, deltaSeconds);
    this.model._expressionManager.updateMotion(m, deltaSeconds);
    for (const [id, value] of Object.entries(overrides)) {
      m.setParameterValueById(this.sdk.CubismFramework.getIdManager().getId(id), value);
    }
    this.model._physics?.evaluate(m, deltaSeconds);
    this.model._pose?.updateParameters(m, deltaSeconds);
    m.saveParameters();
    m.update();
    const { width, height } = this.canvas;
    this.gl.viewport(0, 0, width, height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    const projection = new this.sdk.CubismMatrix44();
    if (width > height) projection.scale(height / width, 1);
    else projection.scale(1, width / height);
    if (camera === "avatar") {
      projection.scaleRelative(1.7, 1.7);
      projection.translateRelative(0, -0.42);
    }
    projection.multiplyByMatrix(this.model.getModelMatrix());
    this.model.getRenderer().setMvpMatrix(projection);
    this.model.getRenderer().setRenderState(null, [0, 0, width, height]);
    this.model.getRenderer().drawModel();
  }

  close(): void {
    this.model.release();
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
  }
}
