/**
 * Product copy and deployment-specific values. Nothing here is hardcoded in a
 * component: the beta explanation, the owner contact link, and the gate copy
 * all arrive from this file so a copy change is one edit.
 *
 * The contact link is a build-time value (`VITE_OWNER_CONTACT_URL`). The
 * fallback opens Telegram, not a named account, so a build without the variable
 * never sends a user to a stranger.
 */

const contactUrl = (import.meta.env.VITE_OWNER_CONTACT_URL ?? "").trim();

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
] as const;

const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

export const config = {
  productName: "Теле-Лента",
  ownerContactUrl: /^https:\/\/t\.me\//.test(contactUrl)
    ? contactUrl
    : "https://t.me",
  retentionDays: 30,
  gate: {
    checking: "Проверяем доступ",
    outsideTitle: "Откройте приложение из Telegram",
    outsideBody:
      "Это приложение работает только внутри Telegram, в чате с ботом.",
    inviteTitle: "Закрытая бета. Доступ по приглашению.",
    inviteBody: "Напишите владельцу, чтобы получить доступ.",
    contactAction: "Написать владельцу",
    errorTitle: "Не удалось проверить доступ",
    errorBody: "Проверьте связь и попробуйте ещё раз.",
    retry: "Повторить",
  },
  errors: {
    init_data_invalid: "Откройте приложение из Telegram.",
    init_data_expired: "Сессия устарела. Откройте приложение заново.",
    not_invited: "Доступ по приглашению. Напишите владельцу.",
    access_check_failed: "Не удалось проверить доступ. Проверьте связь.",
    not_found: "Ничего не найдено.",
    invalid_request: "Запрос не принят. Попробуйте ещё раз.",
    rate_limited: "Слишком много запросов. Подождите минуту.",
    upstream_unavailable:
      "Не удалось загрузить данные. Проверьте связь и попробуйте ещё раз.",
  },
  onboarding: {
    title: "Как это работает",
    lines: [
      "Читаем объявления из открытых чатов Черногории.",
      "Похожие объявления из разных чатов склеиваем в одну карточку.",
      "Контакты — в исходном чате. Нажмите «Открыть в Telegram».",
    ],
    dismiss: "Понятно",
  },
  calendar: {
    today: "Сегодня",
    yesterday: "Вчера",
    yesterdayRelative: "вчера",
    justNow: "только что",
    minutes: "мин",
    hours: "ч",
    days: "дн",
    monthsGenitive: MONTHS_GENITIVE,
    monthsShort: MONTHS_SHORT,
    weekdaysShort: WEEKDAYS_SHORT,
  },
  feed: {
    empty: "Пока пусто. Новые объявления появятся после следующего обновления.",
    sections: {
      classifieds: "Объявления",
      jobs: "Вакансии",
      events: "Мероприятия",
    },
    categories: {
      real_estate: "Недвижимость",
      auto: "Авто",
      goods: "Вещи",
      services: "Услуги",
      other: "Другое",
    },
    demand: {
      buy: "Куплю",
      seek: "Ищу",
      job: "Ищу работу",
    },
    status: {
      updatedAt: "Обновлено в",
      stale: "Нет связи",
      loading: "Загружаем ленту",
      refresh: "Обновить ленту",
    },
    loading: "Загружаем ленту",
    loadingMore: "Загружаем ещё",
    loadError:
      "Не удалось загрузить ленту. Проверьте связь и попробуйте ещё раз.",
    retry: "Повторить",
    end: "Вы дошли до конца. Мы храним объявления 30 дней.",
    sources: {
      one: "источник",
      few: "источника",
      many: "источников",
    },
    sourceCountName: "Источников",
    sourceOverflowPrefix: "ещё",
  },
  detail: {
    loading: "Загружаем объявление",
    loadError:
      "Не удалось загрузить объявление. Проверьте связь и попробуйте ещё раз.",
    retry: "Повторить",
    notFoundNotice: "Объявление больше недоступно. Показываем ленту.",
    noActionable:
      "Нет доступного источника: сообщение удалено или чат закрыт.",
    mainButton: "Открыть в Telegram",
    firstSource: "первым",
    publishedIn: "Опубликовано в",
    sourceForms: ["источнике", "источниках", "источниках"],
    sources: {
      public: "Открыть сообщение",
      invite: "Вступить в чат",
      closed: "Источник закрыт",
      deleted: "Сообщение удалено",
    },
    galleryLabel: "Фотографии",
    photoAlt: "Фото",
    photoAltOf: "из",
  },
  search: {
    title: "Поиск",
    label: "Поиск",
    placeholder: "Искать в ленте",
    hint: "Подгорица найдёт Podgorica",
    sectionLabel: "Секция",
    allSections: "Все",
    recents: "Недавние",
    clearRecents: "Очистить",
    clearInput: "Очистить запрос",
    results: ["результат", "результата", "результатов"],
    empty: "Ничего не нашлось. Попробуйте другое слово или уберите фильтры.",
    tooShort: "Введите хотя бы два символа.",
    reset: "Сбросить",
    loading: "Ищем",
    loadError:
      "Не удалось выполнить поиск. Проверьте связь и попробуйте ещё раз.",
    retry: "Повторить",
    end: "Вы дошли до конца.",
  },
  filters: {
    title: "Фильтры",
    sectionGroup: "Что показывать",
    categoryGroup: "Категория",
    demandGroup: "Тип",
    sourcesGroup: "Источники",
    all: "Все",
    demand: {
      classifieds: {
        offer: "Предлагаю",
        wanted: "Куплю/Ищу",
      },
      jobs: {
        offer: "Предлагаю работу",
        wanted: "Ищу работу",
      },
    },
    apply: "Показать",
    // Noun forms after a numeral in «Найдено N …».
    applyNouns: {
      classifieds: ["объявление", "объявления", "объявлений"],
      jobs: ["вакансия", "вакансии", "вакансий"],
      events: ["мероприятие", "мероприятия", "мероприятий"],
    },
    // Accusative forms governed by «Показать» in the primary button.
    applyAccusative: {
      classifieds: ["объявление", "объявления", "объявлений"],
      jobs: ["вакансию", "вакансии", "вакансий"],
      events: ["мероприятие", "мероприятия", "мероприятий"],
    },
    found: "Найдено",
    reset: "Сбросить",
    counting: "Считаем результаты…",
    countFailed: "Не удалось посчитать",
    chipsLabel: "Активные фильтры",
    removeChipLabel: "Убрать фильтр",
    filterButton: "Фильтры",
    empty: "По этим фильтрам пока ничего нет. Уберите фильтры или загляните позже.",
    emptyReset: "Сбросить фильтры",
    sourcesLoading: "Загружаем источники…",
    sourcesError: "Не удалось загрузить источники.",
    sourcesRetry: "Повторить",
    close: "Закрыть",
    openSources: "Показать источники",
    collapseSources: "Скрыть источники",
    saveSearch: "Сохранить этот поиск",
  },
  saved: {
    title: "Сохранённые поиски",
    loading: "Загружаем сохранённые поиски",
    loadError:
      "Не удалось загрузить сохранённые поиски. Проверьте связь и попробуйте ещё раз.",
    retry: "Повторить",
    empty:
      "Пока нет сохранённых поисков. Сохраните поиск, и бот пришлёт подходящие объявления, даже если приложение закрыто.",
    emptyAction: "Найти объявления",
    allFeed: "Вся лента",
    limitNote: "Можно сохранить до 10 поисков.",
    digestFor: "Дайджест для",
    digestNever: "Дайджест ещё не приходил",
    digestPrefix: "Дайджест:",
    rename: "Переименовать",
    delete: "Удалить",
    deleteConfirm: "Удалить?",
    cancel: "Отмена",
    save: "Сохранить",
    saving: "Сохраняем…",
    error:
      "Не удалось обновить. Проверьте связь и попробуйте ещё раз.",
    quotes: ["«", "»"] as const,
    demand: {
      offer: "Предлагаю",
      wanted: "Куплю/Ищу",
    },
  },
  saveSearch: {
    title: "Сохранить поиск",
    close: "Закрыть",
    name: "Название",
    nameError: "Название должно быть от 1 до 80 символов",
    summaryLabel: "Что будет искать",
    digestSwitch: "Присылать дайджест",
    submit: "Сохранить",
    submitting: "Сохраняем…",
    limit: "Можно сохранить не больше 10 поисков. Удалите один.",
    invalid: "Не удалось сохранить поиск.",
    network:
      "Не удалось сохранить. Проверьте связь и попробуйте ещё раз.",
    savedToast: "Поиск сохранён. Дайджест придёт в течение 30 минут.",
  },
  settings: {
    title: "Настройки",
    theme: "Тема",
    themeOptions: {
      auto: "Как в Telegram",
      light: "Светлая",
      dark: "Тёмная",
    },
    loading: "Загружаем настройки…",
    loadError:
      "Не удалось загрузить настройки. Проверьте связь и попробуйте ещё раз.",
    retry: "Повторить",
    saveError: "Не удалось сохранить настройку. Проверьте связь.",
    savedAt: "Сохранено",
    saving: "Сохраняем…",
    digest: {
      title: "Дайджест",
      switch: "Присылать дайджест",
      hint: "Раз в 30 минут, вне тихих часов.",
      on: "Дайджест включён",
      off: "Дайджест выключен",
    },
    quiet: {
      title: "Тихие часы",
      from: "С",
      to: "До",
      zone: "Черногория, Europe/Podgorica",
      hint: "В это время бот не присылает дайджест.",
      summaryLabel: "Тихие часы",
      summaryZone: "Черногория",
      timeError: "Время в формате ЧЧ:ММ, от 00:00 до 23:59.",
      sameError: "Начало и конец тихих часов должны различаться.",
    },
    filters: {
      title: "Фильтры",
      spam: "Скрывать спам",
      spamHint: "Ссылки без текста и повторы из шумных чатов.",
      ad: "Скрывать рекламу",
      adHint: "Рекламные посты и приглашения в чаты.",
      note: "Технические сообщения скрываются всегда.",
    },
    aboutSection: "О приложении",
    aboutRow: "Как мы собираем объявления",
    about: {
      title: "Как мы собираем объявления",
      paragraphs: [
        "Читаем только публичные чаты и каналы Черногории. В закрытые чаты и в чужой аккаунт не заходим.",
        "Бота в эти чаты не добавляем: нового участника в источниках не появляется.",
        "Одинаковые объявления из разных чатов склеиваем в одну карточку. Предложение видно один раз, а не пять.",
        "Храним объявления 30 дней. Дальше они исчезают из ленты сами.",
        "Контакты остаются в исходном чате: карточка ведёт к сообщению, переписка идёт там.",
      ],
    },
    contact: "Написать владельцу",
    contactHint: "Если что-то сломалось или нужен доступ.",
  },
  actions: {
    more: "Ещё",
    close: "Закрыть",
    back: "Назад",
    search: "Поиск",
    saved: "Сохранённые поиски",
    saveSearch: "Сохранить поиск",
  },
} as const;

export type Section = keyof typeof config.feed.sections;
export type ErrorCode = keyof typeof config.errors;
