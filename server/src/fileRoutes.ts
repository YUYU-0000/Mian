import express from "express";
import { ChatFiles, FILE_TOO_LARGE, MAX_FILE_SIZE } from "./chatFiles.js";

export function fileRoutes(
  files: ChatFiles,
  requireConversation: (id: string) => unknown,
) {
  const router = express.Router();
  router.post(
    "/conversations/:id/files",
    express.raw({ type: "application/octet-stream", limit: MAX_FILE_SIZE }),
    async (request, response) => {
      try {
        requireConversation(request.params.id);
        if (
          !request.get("Content-Type")?.startsWith("application/octet-stream")
        )
          throw new Error("請選擇文件");
        const file = await files.save(
          request.params.id,
          String(request.query.name ?? ""),
          request.body ?? Buffer.alloc(0),
          String(request.query.type ?? ""),
        );
        response.status(201).json(file);
      } catch (error) {
        response.status(400).json({ error: (error as Error).message });
      }
    },
  );
  router.get("/conversations/:id/files/:fileId", async (request, response) => {
    try {
      requireConversation(request.params.id);
      const stored = await files.get(request.params.id, request.params.fileId);
      response.setHeader("X-Content-Type-Options", "nosniff");
      if (
        request.query.inline === "1" &&
        (stored.file.mimeType === "application/pdf" ||
          /\.pdf$/i.test(stored.file.name))
      ) {
        response
          .type("application/pdf")
          .sendFile(stored.path, { dotfiles: "allow" });
        return;
      }
      response.setHeader("Content-Security-Policy", "sandbox");
      if (
        request.query.inline === "1" &&
        stored.file.mimeType.startsWith("image/")
      ) {
        response
          .type(stored.file.mimeType)
          .sendFile(stored.path, { dotfiles: "allow" });
      } else
        response.download(stored.path, stored.file.name, { dotfiles: "allow" });
    } catch (error) {
      response.status(404).json({ error: (error as Error).message });
    }
  });
  router.use(
    (
      error: Error & { type?: string },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response.status(error.type === "entity.too.large" ? 413 : 400).json({
        error:
          error.type === "entity.too.large" ? FILE_TOO_LARGE : error.message,
      });
    },
  );
  return router;
}
