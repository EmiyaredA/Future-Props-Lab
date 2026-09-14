const path = require("node:path");

module.exports = {
  hooks: {
    postPackage: async (_config, result) => {
      const { verifyApp } = require("./scripts/verify-app.cjs");
      for (const output of result.outputPaths)
        verifyApp(
          path.join(output, "Future Props Lab.app"),
          path.join(__dirname, "out/validation"),
        );
    },
  },
  packagerConfig: {
    name: "Future Props Lab",
    executableName: "Future Props Lab",
    appBundleId: "lab.futureprops.desktop",
    appCategoryType: "public.app-category.productivity",
    icon: path.join(__dirname, "assets/app-icon.icns"),
    asar: true,
    prune: true,
    ignore: (file) =>
      Boolean(file) && !/^\/(package\.json|dist(?:\/|$)|ui(?:\/|$))/.test(file),
    extraResource: [
      path.join(__dirname, "build/backend/fpl-server"),
      path.join(__dirname, "build/cli/fpl"),
      path.join(__dirname, "../web/dist"),
    ],
    osxSign: {
      identity: "-",
      identityValidation: false,
      hardenedRuntime: false,
      optionsForFile: () => ({
        hardenedRuntime: false,
        signatureFlags: "0x0",
        timestamp: "none",
        entitlements: [
          "com.apple.security.cs.allow-jit",
          "com.apple.security.device.audio-input",
        ],
      }),
    },
    extendInfo: {
      NSMicrophoneUsageDescription:
        "研究所需要麦克风权限，以进行语音模型测试与录音。",
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: { format: "ULFO", name: "Future Props Lab" },
    },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] },
  ],
};
