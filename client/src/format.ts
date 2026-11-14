// 小时、分钟和纸片编号统一补足两位。
export const pad2 = (value: number) => String(value).padStart(2, "0");

// 由浏览器提供用户所在时区的日期与时间。
export function localDateTime(date = new Date()) {
  const day = "日一二三四五六"[date.getDay()];
  return `現在是 ${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} 星期${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
