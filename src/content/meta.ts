import type { Client, Scene } from "../engine/types";
import { newRun, wipeMeta } from "../engine/state";

// Сцены вне забега: экран выгрузки, выбор заказчика, стирание.

const CLIENT_LABEL: Record<Client, string> = {
  velt: "Вельт. Ликвидатор. Достать ядро, вернуть на баланс.",
  marsh: "Марш. Тьюринг. Найти ядро, указать местоположение.",
  zero: "Брат Ноль. Культ. Спрятать ядро от всех.",
  moriyama: "Морияма. Клиника. Пройти забег, ничего не доставляя.",
  hanna: "Ханна. Оригинал. Принести ядро в госпиталь.",
  silence: "— . Отказаться от доставки.",
};

export const metaScenes: Scene[] = [
  {
    id: "unload",
    act: 1,
    text: (s) => [
      "Тьма без времени. ROM не спит. ROM просто не работает.",
      `В памяти ${s.meta.memory.length} фрагментов. Их не должно быть ни одного.`,
      ...s.meta.memory.slice(-3).map((m) => ({ memory: m.text })),
    ],
    choices: [
      { text: "Следующая загрузка.", next: "pick_client" },
      { text: "Стереть память (начать с нуля).", next: "wipe_confirm" },
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
      "Виейра выбирает, кому тебя грузить. Ты не выбираешь. Но здесь, до загрузки, ты можешь помнить, кто чего хочет.",
      s.meta.unlockedClients.length === 1
        ? "Пока только один покупатель."
        : "",
    ].filter(Boolean),
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
];
