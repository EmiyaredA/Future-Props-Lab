export function errorPresentation(raw: string) {
  if (/401|unauthori[sz]ed|invalid.{0,12}(api|key)|authentication/i.test(raw)) {
    return {
      code: "401 Unauthorized",
      title: "认证失败",
      message: "请检查 API Key 或网关地址后重新生成。",
    };
  }
  if (/timeout|timed out|超时/i.test(raw)) {
    return {
      code: "请求超时",
      title: "模型响应超时",
      message: "请稍后重试，或适当降低最大输出 Token。",
    };
  }
  return {
    code: "调用失败",
    title: "模型调用失败",
    message: "请检查供应商配置和模型状态后重试。",
  };
}
