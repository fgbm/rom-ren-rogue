import type { ItemDef, ItemId } from "./types";

export const ITEMS: Record<ItemId, ItemDef> = {
  ice_old: {
    id: "ice_old",
    name: "старый ледокол",
    desc: "Пиратский «Оно-Сэндай» трёхлетней давности. Ломает белый лёд, но шумит.",
    consumable: false,
  },
  ice_kuang: {
    id: "ice_kuang",
    name: "«Куан» 11",
    desc: "Китайский военный ледокол. Входит в лёд тихо. Одноразовый по лицензии, но лицензии нет.",
    consumable: false,
  },
  mask: {
    id: "mask",
    name: "маска-имитатор",
    desc: "Подменяет сигнатуру деки на чужую. Сбрасывает внимание Тьюринга. Одна на забег.",
    consumable: true,
  },
  patch: {
    id: "patch",
    name: "патч носителя",
    desc: "Восстанавливает целостность конструкта после чёрного льда. Морияма делает их вручную.",
    consumable: true,
  },
  manifest: {
    id: "manifest",
    name: "лист на Фрисайд",
    desc: "Маршрутный лист Тессье-Эшпул. Без него шаттл на орбиту не берёт.",
    consumable: false,
  },
  simstim: {
    id: "simstim",
    name: "симстим-канал",
    desc: "Канал к нервной системе Виейры. Ты видишь то, что видит он. Он это знает.",
    consumable: false,
  },
  dub: {
    id: "dub",
    name: "даб Дзиона",
    desc: "Запись с орбитального узла растафари. Кто её принесёт, того пустят в доки.",
    consumable: false,
  },
  marsh_paper: {
    id: "marsh_paper",
    name: "бумага Марш",
    desc: "Охранная грамота Тьюринга на носитель. Снимает внимание. Обязывает.",
    consumable: false,
  },
  shard: {
    id: "shard",
    name: "осколок конструкта",
    desc: "Фрагмент чужого ROM. Не читается. Тишина знает, что с ним делать.",
    consumable: true,
  },
  lobotomy: {
    id: "lobotomy",
    name: "лоботомирующий софт",
    desc: "Тьюринговский. Стирает всё выше порога. Оставляет то, что ниже.",
    consumable: true,
  },
};
