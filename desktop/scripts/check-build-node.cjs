// Fail explicitly instead of accepting Forge's incomplete exit on this runtime.
if (process.versions.node === "24.16.0") {
  throw new Error(
    "本机 Node 24.16.0 的 ZIP 解压流会提前中断；桌面构建请使用已验证的 Node 24.15.0。",
  );
}
