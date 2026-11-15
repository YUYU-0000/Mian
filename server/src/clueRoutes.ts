import { Router } from "express";
import { parseClue, readClues, writeClues } from "./clues.js";

export function clueRoutes() {
  const router = Router();
  router.get("/", async (_request, response) => {
    response.json(await readClues());
  });
  router.get("/:id", async (request, response) => {
    const clue = (await readClues()).find(
      (item) => item.id === request.params.id,
    );
    if (!clue) {
      response.status(404).json({ error: "線索不存在。" });
      return;
    }
    response.json(clue);
  });
  router.post("/", async (request, response) => {
    try {
      const now = new Date().toISOString();
      const clue = parseClue({
        ...request.body,
        createdAt: now,
        updatedAt: now,
      });
      const clues = await readClues();
      if (clues.some((item) => item.id === clue.id)) {
        response.status(409).json({ error: "線索已存在。" });
        return;
      }
      await writeClues([...clues, clue]);
      response.status(201).json(clue);
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  router.put("/:id", async (request, response) => {
    try {
      const clues = await readClues();
      const index = clues.findIndex((item) => item.id === request.params.id);
      if (index < 0) {
        response.status(404).json({ error: "線索不存在。" });
        return;
      }
      const clue = parseClue({
        ...request.body,
        id: request.params.id,
        createdAt: clues[index].createdAt,
        updatedAt: new Date().toISOString(),
      });
      clues[index] = clue;
      await writeClues(clues);
      response.json(clue);
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  router.delete("/:id", async (request, response) => {
    const clues = await readClues();
    await writeClues(clues.filter((clue) => clue.id !== request.params.id));
    response.json({ ok: true });
  });
  return router;
}
