export const CARD_WIDTH = 84;
export const CARD_HEIGHT = 88;
export const PORTRAIT_ID = "portrait";

export function removeClue(wall, id) {
  const pins = wall.pins.filter((pin) => pin.cardId !== id);
  const ids = new Set(pins.map((pin) => pin.id));
  return {
    ...wall,
    cards: wall.cards.filter((card) => card.id !== id),
    pins,
    threads: wall.threads.filter(
      (thread) => ids.has(thread.from) && ids.has(thread.to),
    ),
  };
}

export function removePin(wall, id) {
  return {
    ...wall,
    pins: wall.pins.filter((pin) => pin.id !== id),
    threads: wall.threads.filter(
      (thread) => thread.from !== id && thread.to !== id,
    ),
  };
}
