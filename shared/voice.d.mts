export type VoicePreset = {
    id: string;
    note: string;
    voice_id: string;
    model: string;
    words: string;
    key?: string;
    hasKey?: boolean;
};
export type VoiceSettings = { presets: VoicePreset[]; activeId: string };
export type VoiceClip = { url: string; text: string };
export const defaultVoicePreset: Omit<VoicePreset, "key" | "hasKey">;
