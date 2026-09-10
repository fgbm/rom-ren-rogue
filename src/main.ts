import { Game } from "./engine/game";
import { loadMeta, newRun } from "./engine/state";
import type { GameState } from "./engine/types";
import { act1 } from "./content/act1";
import { act2 } from "./content/act2";
import { act3 } from "./content/act3";
import { metaScenes } from "./content/meta";
import { createRenderer } from "./ui";

const meta = loadMeta();
const state: GameState = { meta, run: newRun("velt") };

let game: Game;
const renderer = createRenderer(
  (c) => game.choose(c),
  (c) => game.locked(c),
);
game = new Game([...metaScenes, ...act1, ...act2, ...act3], state, renderer, {
  acts: {
    1: { poolLength: 3, exit: "act1_exit" },
    2: { poolLength: 4, exit: "act2_exit" },
    3: { poolLength: 2, exit: "k11_library" },
  },
  intercept: "turing_intercept",
  flatline: "flatline",
});

// Первый запуск: сразу в забег. Повторный: экран выбора заказчика.
if (meta.runs === 0) {
  state.meta.runs = 1;
  game.goto("k1_load");
} else {
  game.goto("pick_client");
}

// Для отладки из консоли браузера.
(window as unknown as { game: Game }).game = game;
