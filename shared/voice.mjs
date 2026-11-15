export const defaultVoicePreset = {
    id: "voice-default",
    note: "",
    voice_id: "",
    voice_name: "",
    model: "",
    words: "",
};

export function stripVoiceTags(text) {
    return text.replace(/\[[^\]]*(?:\]|$)/g, "").trim();
}

export function estimatedVoiceDuration(text) {
    const spoken = stripVoiceTags(text);
    const chinese = spoken.match(/\p{Script=Han}/gu)?.length ?? 0;
    const ellipses = spoken.match(/…|\.{3}/g)?.length ?? 0;
    const tags = text.match(/\[[^\]]*\]/g)?.length ?? 0;
    return chinese * 0.3 + ellipses * 0.5 + tags * 2;
}

export function splitVoiceText(text) {
    if (stripVoiceTags(text).length <= 300) return [text];
    const parts = [];
    let part = "";
    for (const sentence of text.match(/[^。]*。|[^。]+$/g) ?? []) {
        if (part && stripVoiceTags(part + sentence).length > 300) {
            parts.push(part);
            part = "";
        }
        part += sentence;
    }
    if (part) parts.push(part);
    return parts;
}
