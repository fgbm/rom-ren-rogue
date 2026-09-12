import program from "virtual:rom";
import { Game } from "./engine/game.ts";
import { browserKV } from "./engine/state.ts";
import { createRenderer } from "./ui.ts";

let game: Game;
const renderer = createRenderer((i) => game.pick(i));
game = new Game(program, renderer, browserKV());
game.start();

// Для отладки из консоли браузера: game.state, game.goto("id"), game.enterLoc("id").
(window as unknown as { game: Game }).game = game;
