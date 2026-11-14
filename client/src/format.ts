// 小时、分钟和纸片编号统一补足两位。
export const pad2 = (value: number) => String(value).padStart(2, "0");
