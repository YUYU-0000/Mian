import { Router } from "express";
import { parseClue, readClues, writeClues, removeClue } from "./clues.js";

export function clueRoutes() {
  const router = Router();
  router.get("/", async (_request, response) => {
    response.json(await readClues());
  });
  router.put("/", async (request, response) => {
    try {
      const wall = {
        ...request.body,
        cards: request.body.cards.map(parseClue),
      };
      await writeClues(wall);
      response.json(wall);
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  router.get("/:id", async (request, response) => {
    const clue = (await readClues()).cards.find(
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
      const wall = await readClues();
      if (wall.cards.some((item) => item.id === clue.id)) {
        response.status(409).json({ error: "線索已存在。" });
        return;
      }
      await writeClues({ ...wall, cards: [...wall.cards, clue] });
      response.status(201).json(clue);
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  router.put("/:id", async (request, response) => {
    try {
      const wall = await readClues();
      const clues = wall.cards;
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
      await writeClues(wall);
      response.json(clue);
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });
  router.delete("/:id", async (request, response) => {
    await writeClues(removeClue(await readClues(), request.params.id));
    response.json({ ok: true });
  });
  return router;
}
