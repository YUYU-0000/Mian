export type VoicePreset = {
    id: string;
    note: string;
    voice_id: string;
    voice_name?: string;
    model: string;
    words: string;
    key?: string;
    hasKey?: boolean;
};
export type VoiceSettings = { presets: VoicePreset[]; activeId: string };
export type VoicePart = { url: string; duration: number };
export type VoiceClip = { url: string; text: string; duration?: number; parts?: VoicePart[]; peaks?: number[] };
export type VoiceOption = { id: string; name: string };
export const defaultVoicePreset: Omit<VoicePreset, "key" | "hasKey">;
export function stripVoiceTags(text: string): string;
export function estimatedVoiceDuration(text: string): number;
export function splitVoiceText(text: string): string[];
