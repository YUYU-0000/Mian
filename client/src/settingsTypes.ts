export const DEFAULT_FONT_ID = "1";
export const DEFAULT_BUBBLE_SIZE = 14.5;
export type FontPreset = {
  id: string;
  name: string;
  face: string;
  view: string;
  size: number;
};
export type FontSettings = {
  presets: FontPreset[];
  activeId: string;
  style: { face: string; size: number };
};
export const defaultFont: FontPreset = {
  id: DEFAULT_FONT_ID,
  name: "預設",
  face: "",
  view: "Still water.",
  size: DEFAULT_BUBBLE_SIZE,
};
export const defaultFontSettings = (): FontSettings => ({
  presets: [{ ...defaultFont }],
  activeId: DEFAULT_FONT_ID,
  style: { face: "", size: DEFAULT_BUBBLE_SIZE },
});
