import { createApp, h, shallowRef } from "vue";
import "element-plus/theme-chalk/base.css";
import "element-plus/theme-chalk/el-button.css";
import "element-plus/theme-chalk/el-checkbox.css";
import "element-plus/theme-chalk/el-checkbox-group.css";
import "element-plus/theme-chalk/el-form.css";
import "element-plus/theme-chalk/el-form-item.css";
import "element-plus/theme-chalk/el-icon.css";
import "element-plus/theme-chalk/el-input.css";
import "element-plus/theme-chalk/el-input-number.css";
import "element-plus/theme-chalk/el-option.css";
import "element-plus/theme-chalk/el-option-group.css";
import "element-plus/theme-chalk/el-popover.css";
import "element-plus/theme-chalk/el-popper.css";
import "element-plus/theme-chalk/el-progress.css";
import "element-plus/theme-chalk/el-radio.css";
import "element-plus/theme-chalk/el-radio-group.css";
import "element-plus/theme-chalk/el-select.css";
import "element-plus/theme-chalk/el-slider.css";
import "element-plus/theme-chalk/el-switch.css";
import "element-plus/theme-chalk/el-tag.css";
import "element-plus/theme-chalk/el-tooltip.css";
import "element-plus/theme-chalk/el-scrollbar.css";
import Studio from "./truman-map/sceneStudio.vue";
import { parseSceneDocument } from "./truman-map/sceneValidation";
import { resolveAssetModel } from "./truman-map/assetModelResolver";
import { matchSetTemplate, setTemplates } from "./truman-map/setTemplates";

export function scriptSetOptions(script) {
  return { suggested: matchSetTemplate(script)?.id ?? "", items: setTemplates.map(({ id, name }) => ({ id, name })) };
}

export function mountTrumanMap(element, initial) {
  const props = shallowRef(initial);
  const monitor = shallowRef(initial.document);
  const studio = shallowRef(null);
  const app = createApp({
    setup() {
      return () => {
        const { document, onChange, loadProjectModel, prepareProjectModel, importProjectModel, ...options } = props.value;
        return h(Studio, {
          ...options,
          ref: studio,
          modelValue: options.readOnly ? monitor.value : document,
          "onUpdate:modelValue": onChange,
          onMonitorPlayback: (document) => {
            monitor.value = document;
          },
          allowLocalImport: Boolean(importProjectModel),
          async loadModel(asset) {
            if (loadProjectModel && asset.path) return loadProjectModel(asset.path);
            throw new Error("请选择内置或项目 3D 素材");
          },
          async prepareAsset(asset, signal) {
            signal.throwIfAborted();
            if (asset.path && loadProjectModel && /^assets\/project-models\/[a-f0-9-]{36}\.glb$/.test(asset.path)) {
              return prepareProjectModel ? prepareProjectModel(asset, signal) : asset;
            }
            if (asset.kind !== "primitive" && !resolveAssetModel(asset)) {
              throw new Error("请选择内置场景素材");
            }
            return {
              ...asset,
              path: undefined,
              url: undefined,
              thumbnail: undefined,
              normalize: false,
            };
          },
          async importModel(file, signal) {
            if (importProjectModel) return importProjectModel(file, signal);
            throw new Error("当前视图无法导入模型");
          },
        });
      };
    },
  });
  app.mount(element);
  return {
    async buildScript(script, template) {
      if (!studio.value) throw new Error("3D 预览未准备好");
      return studio.value.hostBuildScript(script, template);
    },
    isBusy() {
      return studio.value?.hostIsBusy() ?? false;
    },
    playPreview() {
      studio.value?.hostPlayPreview();
    },
    update(next) {
      if (
        next.document !== props.value.document ||
        next.readOnly !== props.value.readOnly
      ) {
        monitor.value = next.document;
      }
      props.value = next;
    },
    dispose() {
      app.unmount();
    },
  };
}

export function validateScene(value) {
  return parseSceneDocument(value);
}
