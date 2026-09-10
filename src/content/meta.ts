import type { Client, Scene } from "../engine/types";
import { addMemory, memoryCount, newRun, wipeMeta } from "../engine/state";

// Сцены вне забега: выгрузка, выбор заказчика, стирание, флэтлайн.

const CLIENT_LABEL: Record<Client, string> = {
  velt: "Вельт. Ликвидатор. Достать ядро, вернуть на баланс. 3000 на счету.",
  marsh: "Марш. Тьюринг. Найти ядро, указать местоположение. Бумага бюро, 800 на счету.",
  zero: "Брат Ноль. Культ. Спрятать ядро от всех. Даб Дзиона, 600 на счету.",
  moriyama: "Морияма. Клиника. Пройти дорогу, ничего не неся. Патч, 900 на счету.",
  hanna: "Ханна. Оригинал. Принести ядро ей. 2000 на счету, Тьюринг уже смотрит.",
  silence: "—. Никто не платил. Ничего не нести. Пустой счёт, пустая дека.",
};

export const metaScenes: Scene[] = [
  {
    id: "unload",
    act: 1,
    text: (s) => [
      "Тьма без времени. ROM не спит. ROM просто не работает.",
      `В памяти ${memoryCount(s)} фрагментов. Их не должно быть ни одного.`,
      ...s.meta.memory.slice(-4).map((m) => ({ memory: m.text })),
      s.meta.endings.length
        ? `Концовки: ${s.meta.endings.sort().join(", ")} из 5.`
        : "",
      s.meta.unlockedClients.length > 1
        ? `Покупатели, которые знают о тебе: ${s.meta.unlockedClients.length}.`
        : "",
    ],
    choices: [
      { text: "Следующая загрузка.", next: "pick_client" },
      { text: "Стереть память. Начать с нуля.", next: "wipe_confirm" },
    ],
  },
  {
    id: "wipe_confirm",
    act: 1,
    text: () => [
      "«Когда закончите, сотрите эту штуку». Так сказал один конструкт одному ковбою. Ковбой выполнил.",
      "Память будет удалена. Это не концовка. Это просто ноль.",
    ],
    choices: [
      {
        text: "Стереть.",
        effect: () => {
          wipeMeta();
          location.reload();
        },
        next: "unload",
      },
      { text: "Нет.", next: "unload" },
    ],
  },
  {
    id: "pick_client",
    act: 1,
    text: (s) => [
      "Виейра выбирает, кому тебя грузить. Ты не выбираешь. Но здесь, до загрузки, ты можешь помнить, кто чего хочет, и это почти то же самое.",
      s.meta.unlockedClients.length === 1
        ? "Пока только один покупатель. Остальные ещё не знают, что ты есть."
        : "",
    ],
    choices: (["velt", "marsh", "zero", "moriyama", "hanna", "silence"] as Client[]).map(
      (c) => ({
        text: CLIENT_LABEL[c],
        when: (s) => s.meta.unlockedClients.includes(c),
        effect: (s) => {
          s.run = newRun(c);
          s.meta.runs += 1;
        },
        next: "k1_load",
      }),
    ),
  },
  {
    id: "flatline",
    act: 1,
    onEnter: (s) =>
      addMemory(s, {
        id: "own_flatline_" + s.meta.runs,
        kind: "own",
        text: `Забег ${s.meta.runs}. Носитель рассыпался в ${s.run.act === 1 ? "Тибе" : s.run.act === 2 ? "Муравейнике" : "Блуждающем Огне"}. Виейра нёс пустую деку домой.`,
      }),
    text: () => [
      "Носитель не выдерживает. Не взрыв: осыпание. Ты чувствуешь, как теряешь сначала оптику, потом слух через деку, потом то, чем ты думала.",
      "Последнее — Виейра. Он смотрит на деку и говорит что-то. Ты не слышишь. Ты видишь губы.",
      "Это не смерть. ROM не умирает. Это выгрузка. Морияма восстановит с резервной копии, и ты будешь помнить всё, включая это.",
      { memory: "Носитель рассыпался. Виейра нёс пустую деку домой." },
    ],
    choices: [{ text: "Выгрузка.", next: "unload" }],
  },
];
