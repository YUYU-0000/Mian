import { DEFAULT_BUBBLE_SIZE, type FontSettings } from "./settingsTypes";

export const INVALID_FONT = "請貼上完整的 @font-face 代碼。";
export type ParsedFont = { family: string; css: string };

export function parseFontFace(face: string, id: string): ParsedFont {
  const source = face.trim();
  const family = `MianFont_${id}`;
  const sheet = new CSSStyleSheet();
  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    sheet.replaceSync(
      `@font-face { font-family: ${JSON.stringify(family)}; src: url(${JSON.stringify(url.href)}); font-display: swap; }`,
    );
  } else {
    sheet.replaceSync(source);
  }
  const rules = Array.from(sheet.cssRules).filter(
    (rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule,
  );
  if (
    !rules.length ||
    rules.some((rule) => !/url\(/i.test(rule.style.getPropertyValue("src")))
  )
    throw new Error(INVALID_FONT);
  // 私有字体名避免覆盖全局字库，同名的两张纸片也互不影响。
  for (const rule of rules) rule.style.fontFamily = JSON.stringify(family);
  return { family, css: rules.map((rule) => rule.cssText).join("\n") };
}

export function installFont(font: ParsedFont, id: string) {
  const key = `mian-font-${id}`;
  let style = document.getElementById(key);
  if (!style) {
    style = document.createElement("style");
    style.id = key;
    document.head.append(style);
  }
  style.textContent = font.css;
}

export function applyBubbleFont(settings: FontSettings) {
  const font = settings.style.face
    ? parseFontFace(settings.style.face, "active")
    : { family: "ZSFT-br", css: "" };
  installFont(font, "active");
  document.documentElement.style.setProperty(
    "--bubble-font-family",
    `${JSON.stringify(font.family)}, "LXGW Heart Serif", sans-serif`,
  );
  document.documentElement.style.setProperty(
    "--bubble-font-scale",
    String(settings.style.size / DEFAULT_BUBBLE_SIZE),
  );
}
