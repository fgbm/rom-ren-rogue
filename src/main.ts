import { Game } from "./engine/game";
import { loadMeta, newRun } from "./engine/state";
import type { GameState } from "./engine/types";
import { act1 } from "./content/act1";
import { metaScenes } from "./content/meta";
import { createRenderer } from "./ui";

const meta = loadMeta();
const state: GameState = { meta, run: newRun("velt") };

let game: Game;
const renderer = createRenderer(
  (c) => game.choose(c),
  (c) => game.canAfford(c),
);
game = new Game([...metaScenes, ...act1], state, renderer);

// Первый запуск: сразу в забег. Повторный: экран выбора заказчика.
if (meta.runs === 0) {
  state.meta.runs = 1;
  game.goto("k1_load");
} else {
  game.goto("pick_client");
}
