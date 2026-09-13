import program from "virtual:rom";
import { Game } from "./engine/game.ts";
import { browserKV } from "./engine/state.ts";
import { loadTitlePage } from "./mainpage.ts";
import { createRenderer } from "./ui.ts";

let game: Game;
const renderer = createRenderer(
  (i) => game.pick(i),
  () => game.openTitle(),
);
game = new Game(program, renderer, browserKV(), Math.random, loadTitlePage());
game.start();

// Для отладки из консоли браузера: game.state, game.goto("id"), game.enterLoc("id").
(window as unknown as { game: Game }).game = game;
