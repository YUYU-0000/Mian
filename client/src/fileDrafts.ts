import { api } from "./api";
import { createId } from "./id";
import type { ChatFile } from "./types";

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export type FileDraft = {
  draftId: string;
  file: ChatFile;
  progress: number;
  uploaded: boolean;
  previewUrl?: string;
};

// 草稿属于会话，切页时上传继续，完成后只把票根信息写进记录。
export class FileDrafts {
  private drafts: FileDraft[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly uploads = new Map<string, AbortController>();

  constructor(private readonly conversationId: string) {}

  readonly getSnapshot = () => this.drafts;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(drafts: FileDraft[]) {
    this.drafts = drafts;
    this.listeners.forEach((listener) => listener());
  }

  add(files: File[], fail: (title: string, error: unknown) => void) {
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        fail("文件太大", "單個文件不能超過 20MB。");
        continue;
      }
      const draftId = createId();
      const controller = new AbortController();
      this.uploads.set(draftId, controller);
      this.publish([
        ...this.drafts,
        {
          draftId,
          file: {
            id: draftId,
            name: file.name,
            size: file.size,
            mimeType: file.type,
            createdAt: new Date().toISOString(),
          },
          progress: 0,
          uploaded: false,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
        },
      ]);
      void api
        .uploadFile(
          this.conversationId,
          file,
          (progress) => {
            this.publish(
              this.drafts.map((draft) =>
                draft.draftId === draftId ? { ...draft, progress } : draft,
              ),
            );
          },
          controller.signal,
        )
        .then((uploaded) => {
          this.publish(
            this.drafts.map((draft) =>
              draft.draftId === draftId
                ? { ...draft, file: uploaded, progress: 100, uploaded: true }
                : draft,
            ),
          );
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            this.remove(draftId);
            fail("上傳失敗", error);
          }
        })
        .finally(() => this.uploads.delete(draftId));
    }
  }

  remove(draftId: string) {
    this.uploads.get(draftId)?.abort();
    this.release(this.drafts.filter((draft) => draft.draftId === draftId));
    this.publish(this.drafts.filter((draft) => draft.draftId !== draftId));
  }

  take() {
    const files = this.drafts.map((draft) => draft.file);
    this.release(this.drafts);
    this.publish([]);
    return files;
  }

  dispose() {
    for (const upload of this.uploads.values()) upload.abort();
    this.release(this.drafts);
    this.listeners.clear();
  }

  // 本地缩略图只随草稿存在，不写进记录。
  private release(drafts: FileDraft[]) {
    for (const draft of drafts)
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
  }
}
