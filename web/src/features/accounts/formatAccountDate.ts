export const formatAccountDate = (value: string | null) =>
  value
    ? new Date(
        /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`,
      ).toLocaleString("zh-CN")
    : "尚未登录";
