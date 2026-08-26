import { describe, expect, it } from "vitest";
import {
  dialogueEffectiveOpacity,
  dialogueBoxPresetStyle,
  dialogueSpeakerNameLayout,
  resolveDialogueBoxStyle,
} from "@features/galgame-workshop/api";

describe("Galgame dialogue box styles", () => {
  it("resolves the classic gradient preset into a complete reusable style", () => {
    const style = dialogueBoxPresetStyle("classicGradient");

    expect(style).toMatchObject({
      preset: "classicGradient",
      borderRadius: 0,
      layout: {
        mode: "bottomOverlay",
        widthPercent: 100,
        heightPercent: 30,
        contentInsetXPercent: 11,
        contentInsetTopPercent: 12,
      },
      background: {
        mode: "verticalGradient",
        gradientTopOpacity: 0.18,
        gradientBottomOpacity: 0.94,
        topRule: "double",
      },
      body: {
        fontSizePx: 30,
        lineHeight: 1.55,
        align: "left",
        maxWidthPercent: 78,
      },
      speakerName: {
        placement: "bottomCenter",
        fontSizePx: 22,
        decoration: "sideLines",
      },
      advanceIndicator: {
        visible: true,
        position: "bottomLeft",
        style: "compact",
        showInExport: true,
      },
    });
  });

  it("keeps legacy dialogue box values and fills only missing modern fields", () => {
    const style = resolveDialogueBoxStyle({
      preset: "custom",
      backgroundColor: "#172033",
      textColor: "#F8FAFC",
      nameColor: "#FB7185",
      backgroundOpacity: 0.7,
      borderRadius: 18,
      fontScale: 1.1,
      assetId: null,
    });

    expect(style.backgroundColor).toBe("#172033");
    expect(style.borderRadius).toBe(18);
    expect(style.layout.mode).toBe("boxed");
    expect(style.background.mode).toBe("solid");
    expect(style.speakerName.placement).toBe("topLeft");
  });

  it("uses the complete runtime preset without leaking configured custom fields", () => {
    const style = resolveDialogueBoxStyle(
      {
        ...dialogueBoxPresetStyle("accent"),
        preset: "custom",
        body: {
          ...dialogueBoxPresetStyle("accent").body,
          align: "right",
        },
      },
      "classicGradient",
    );

    expect(style.preset).toBe("classicGradient");
    expect(style.body.align).toBe("left");
    expect(style.layout.mode).toBe("bottomOverlay");
  });

  it("multiplies the overall opacity into each gradient node", () => {
    expect(dialogueEffectiveOpacity(0.82, 1)).toBe(0.82);
    expect(dialogueEffectiveOpacity(0.82, 0.5)).toBe(0.41);
    expect(dialogueEffectiveOpacity(2, 1)).toBe(1);
    expect(dialogueEffectiveOpacity(-1, 1)).toBe(0);
  });

  it.each([
    ["topLeft", { horizontal: "left", vertical: "top" }],
    ["topCenter", { horizontal: "center", vertical: "top" }],
    ["bottomLeft", { horizontal: "left", vertical: "bottom" }],
    ["bottomCenter", { horizontal: "center", vertical: "bottom" }],
    ["hidden", { horizontal: "left", vertical: "hidden" }],
  ] as const)(
    "maps the %s speaker placement to browser layout",
    (value, expected) => {
      expect(dialogueSpeakerNameLayout(value)).toEqual(expected);
    },
  );
});
