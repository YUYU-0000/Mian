export type Provider = "codex" | "gemini" | "kimi";
export type Subscription = {
  loggedIn: boolean;
  account: string;
  plan: string;
  model: string;
};
export type Quota = { left: number; resetAt: string };
export type ApiPreset = {
  id: string;
  note: string;
  endpoint: string;
  key?: string;
  hasKey?: boolean;
  keyHint?: string;
  model: string;
  format: "openai";
};
export type VoiceConfig = {
  apiKey: string;
  voiceId: string;
  model: string;
  text: string;
};
