/**
 * Telegram-бот для сервиса личного повара «Chef Financial Tracker» (г. Нячанг, Вьетнам)
 * 
 * Возможности:
 * 1. Интерактивная анкета для семей:
 *    - Состав семьи
 *    - Аллергии и непереносимости (лактоза, глютен, яйца, орехи, морепродукты, ягоды + ввод своего варианта текстом)
 *    - Стоп-продукты (кинза, вареный лук, острое, брокколи, грибы, свинина + ввод своего варианта)
 *    - Стиль питания и формат (на кухне клиента / доставка)
 * 2. Адаптивное меню под аллергии (замена пшеницы, молока и т.д.).
 * 3. Финансовая модель (Вьетнам, Нячанг):
 *    - от 250 000 VND/час на кухне клиента
 *    - от 350 000 VND/час (250k + 100k) при готовке вне кухни клиента
 *    - Продукты строго по чекам Lotte Mart, WinMart+, Mega Market, Moonmilk
 * 4. Профессиональные стандарты хранения: товарное соседство, контроль температур в тропиках, дефростация, маркировка.
 * 5. Заказ приготовления еды с передачей полной анкеты шефу.
 * 6. Панель шефа: учет чеков в VND, список покупок, заявки.
 * 
 * Запуск: node scripts/telegramBot.js
 */

const fs = require('fs');
const path = require('path');

// Чтение .env.local или .env если есть
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env')
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let val = (match[2] || '').trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          if (!process.env[key]) process.env[key] = val;
        }
      });
    }
  }
}
loadEnv();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || process.env.VITE_TELEGRAM_CHAT_ID || '1047014528';
const BASE_URL = `https://api.telegram.org/bot${TOKEN}`;
const WEBAPP_URL = 'https://borzenkovvladislav2003-web.github.io/chef-menu/?v=15';

// Локальная база данных (сохраняется в файл)
const DB_FILE = path.join(__dirname, '..', 'bot_data.json');
let db = {
  nextClientCode: 101,
  clients: {},
  orders: [],
  expenses: []
};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!db.nextClientCode) db.nextClientCode = 101;
      if (!db.clients) db.clients = {};
      if (!db.orders) db.orders = [];
      if (!db.expenses) db.expenses = [];
    }
  } catch (e) {
    console.error('Ошибка чтения bot_data.json:', e);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Ошибка сохранения bot_data.json:', e);
  }
}
loadDB();

// Получение или автоматическое создание клиента с выдачей номера #101, #102...
function getOrCreateClient(chatId, userInfo = {}) {
  const idStr = String(chatId);
  if (!db.clients[idStr]) {
    const code = db.nextClientCode || 101;
    db.nextClientCode = code + 1;
    db.clients[idStr] = {
      chatId: Number(chatId),
      clientCode: code,
      name: userInfo.first_name || '',
      username: userInfo.username || '',
      survey: null,
      expenses: [],
      orders: [],
      createdAt: new Date().toISOString()
    };
    saveDB();
  } else if (!db.clients[idStr].clientCode) {
    const code = db.nextClientCode || 101;
    db.nextClientCode = code + 1;
    db.clients[idStr].clientCode = code;
    if (!db.clients[idStr].expenses) db.clients[idStr].expenses = [];
    if (!db.clients[idStr].orders) db.clients[idStr].orders = [];
    saveDB();
  }
  return db.clients[idStr];
}

function findClientByCode(code) {
  const clean = String(code).replace(/^#/, '').trim();
  for (const c of Object.values(db.clients)) {
    if (String(c.clientCode) === clean) return c;
  }
  return null;
}

// Сессии пользователей в памяти
const sessions = {};

// Базовые технологические карты и меню
const MENU_ITEMS = {
  borsch: {
    id: 'borsch',
    title: '🍲 Наваристый домашний борщ на говядине',
    portion: 'Кастрюля 5 литров (8–9 порций)',
    desc: 'Классический домашний борщ на говяжьем бульоне длительного томления. Насыщенный цвет, свежая капуста, свёкла, картофель, морковь и нежное мясо. Подается со сметаной и зеленью.',
    suitableForKids: 'Идеально для всей семьи, умеренная кислотность, без острых специй.',
    ingredients: [
      { name: 'Говядина на кости', amount: '1200 г' },
      { name: 'Свёкла', amount: '450 г' },
      { name: 'Капуста белокочанная', amount: '450 г' },
      { name: 'Картофель', amount: '450 г' },
      { name: 'Морковь', amount: '150 г' },
      { name: 'Лук репчатый', amount: '150 г' },
      { name: 'Томатная паста', amount: '70 г' },
      { name: 'Чеснок', amount: '15 г' }
    ]
  },
  cutlets: {
    id: 'cutlets',
    title: '🥩 Сочные домашние котлеты',
    portion: '12 штук (~1 кг готового блюда / 6 порций)',
    desc: 'Нежнейшие мясные котлеты из отборной говядины и нежирной свинины (соотношение 60/40), с добавлением белого батона на молоке для сочности, в хрустящей панировке.',
    suitableForKids: 'Любимое блюдо детей: пышные, сочные, без хрящей и резких приправ.',
    ingredients: [
      { name: 'Мясной фарш (говядина + свинина)', amount: '850 г' },
      { name: 'Белый хлеб (батон)', amount: '120 г' },
      { name: 'Молоко', amount: '130 мл' },
      { name: 'Лук репчатый пассерованный', amount: '150 г' },
      { name: 'Панировочные сухари', amount: '60 г' },
      { name: 'Сливочное масло', amount: '30 г' }
    ]
  },
  beef_stew: {
    id: 'beef_stew',
    title: '🥘 Томленая говядина с овощами в соку',
    portion: 'Около 1.8–2.0 кг (8–9 порций)',
    desc: 'Нежнейшая мякоть говядины, нарезанная крупными кусочками и томленая 2 часа на слабом огне с морковью, сладким болгарским перцем, томатами и луком в собственном соку.',
    suitableForKids: 'Мясо становится настолько мягким, что распадается на волокна.',
    ingredients: [
      { name: 'Говядина (мякоть лопатки/бедра)', amount: '1100 г' },
      { name: 'Лук репчатый', amount: '250 г' },
      { name: 'Морковь', amount: '200 г' },
      { name: 'Сладкий болгарский перец', amount: '200 г' },
      { name: 'Томаты в соку', amount: '300 г' },
      { name: 'Томатная паста', amount: '30 г' }
    ]
  },
  pasta: {
    id: 'pasta',
    title: '🍝 Домашние гарниры на выбор (паста, пюре, рис, гречка)',
    portion: 'Готовый гарнир ~1.3 кг (8–9 порций)',
    desc: 'Четыре варианта любимых домашних гарниров на ваш выбор: паста твердых сортов al dente, нежное картофельное пюре, рассыпчатый рис или гречка.',
    suitableForKids: 'Универсальный детский гарнир, который дети готовы есть каждый день.',
    ingredients: [
      { name: 'Гарнир на выбор (паста / картофель / рис / гречка)', amount: '600–900 г' }
    ]
  },
  pie: {
    id: 'pie',
    title: '🥧 Домашний ягодный пирог к чаю',
    portion: '1 пирог (диаметр 24 см, 8 порций)',
    desc: 'Ароматный домашний пирог на песочном тесте с начинкой из сочных ягод с легкой кислинкой.',
    suitableForKids: 'Здоровая альтернатива покупным сладостям без красителей и консервантов.',
    ingredients: [
      { name: 'Мука пшеничная', amount: '300 г' },
      { name: 'Сливочное масло', amount: '150 г' },
      { name: 'Ягоды свежие/замороженные', amount: '400 г' },
      { name: 'Сахар', amount: '120 г' },
      { name: 'Яйцо куриное', amount: '2 шт' }
    ]
  }
};

// API обертка для Telegram с защитой от сетевых обрывов
async function api(method, data = {}) {
  if (!TOKEN) {
    console.error('Ошибка: TELEGRAM_BOT_TOKEN не задан!');
    return { ok: false };
  }
  const controller = new AbortController();
  const timeoutMs = method === 'getUpdates' ? 20000 : 15000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    // getUpdates периодически сбрасывается сетью/роутером по таймауту (ECONNRESET, ETIMEDOUT) — это штатное поведение long polling
    const isNetworkDrop = 
      err.name === 'AbortError' ||
      err.code === 'ETIMEDOUT' || 
      err.code === 'ECONNRESET' || 
      err?.cause?.code === 'ETIMEDOUT' || 
      err?.cause?.code === 'ECONNRESET' ||
      (err.message && (err.message.includes('fetch failed') || err.message.includes('network')));

    if (method === 'getUpdates' && isNetworkDrop) {
      // Штатный обрыв пустого ожидания long-polling в мобильных/тропических сетях — повторяем без спама в консоль
      return { ok: false, networkDrop: true };
    }
    console.error(`Ошибка Telegram API [${method}]:`, err.message || err);
    return { ok: false };
  }
}

// Главное меню
async function sendMainMenu(chatId, text) {
  const defaultText = `
👨‍🍳 <b>Шеф Владислав | Личный повар в Нячанге</b>
━━━━━━━━━━━━━━━━━━
Я полностью заменяю готовку для вашей семьи во Вьетнаме:
✨ Составляю меню под вкусы взрослых и предпочтения детей
🛒 Закупаю свежие продукты строго <b>по чекам магазинов без наценок</b> (Lotte Mart, Mega Market, WinMart)
🍳 Готовлю у вас дома или доставляю готовый запас привычной домашней еды на 3–4 дня вперед
🧽 Оставляю кухню в идеальной чистоте и порядке

<i>Забудьте про стояние у плиты и вечный вопрос «что приготовить детям».</i>
  `.trim();

  return api('sendMessage', {
    chat_id: chatId,
    text: text || defaultText,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Открыть интерактивное меню (Mini App)', web_app: { url: WEBAPP_URL } }],
        [{ text: '📋 Заполнить анкету семьи (1 мин)', callback_data: 'survey_start' }],
        [{ text: '🍲 Пример семейного меню', callback_data: 'menu_list' }],
        [{ text: '💰 Стоимость и прозрачность чеков', callback_data: 'info_pricing' }],
        [{ text: '🛡 Чистота, стандарты и хранение', callback_data: 'info_safety' }],
        [{ text: '👨‍🍳 Заказать приготовление еды', callback_data: 'book_chef' }],
        [{ text: '💬 Написать шефу лично', callback_data: 'contact_chef' }]
      ]
    }
  });
}

// Обработка нажатий на inline-кнопки
async function handleCallback(cq) {
  const chatId = cq.message.chat.id;
  const data = cq.data;
  const session = sessions[chatId] || (sessions[chatId] = {});

  if (data === 'my_receipts') {
    const client = getOrCreateClient(chatId);
    const codeBadge = '#' + client.clientCode;
    const expenses = client.expenses || [];
    const totalGroceries = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    let listText = '';
    if (expenses.length === 0) {
      listText = '<i>Чеков закупки пока нет. Когда шеф поедет за продуктами под ваш рацион в Lotte Mart, Big C или Mega Market, сюда донгов в донг прикрепятся все магазинные чеки.</i>';
    } else {
      listText = expenses.map((e, idx) => {
        const d = new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        return `${idx + 1}. <b>${Number(e.amount).toLocaleString('ru-RU')} VND</b> — ${e.note} <i>(${d})</i>`;
      }).join('\n');
    }

    const msg = `
🧾 <b>Личный кабинет семьи ${codeBadge}</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Клиент:</b> ${client.name || 'Семья'}
📍 <b>Кондо/Район:</b> ${client.address || client.survey?.address || 'Нячанг'}

🛒 <b>Магазинные чеки на продукты (строго без наценок):</b>
${listText}

━━━━━━━━━━━━━━━━━━
💰 <b>Итого продукты по чекам:</b> <code>${totalGroceries.toLocaleString('ru-RU')} VND</code>
⏱ <b>Работа шефа:</b> оплачивается отдельно по часам при сдаче кухни.
<i>Вы видите только чеки своей семьи. Всё полностью прозрачно и сохранено в вашем профиле!</i>
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Открыть интерактивное меню', web_app: { url: WEBAPP_URL } }],
          [{ text: '« В главное меню', callback_data: 'main_menu' }]
        ]
      }
    });
  }

  if (data === 'my_receipts') {
    const client = getOrCreateClient(chatId);
    const codeBadge = '#' + client.clientCode;
    const expenses = client.expenses || [];
    const totalGroceries = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    let listText = '';
    if (expenses.length === 0) {
      listText = '<i>Чеков закупки пока нет. Когда шеф поедет за продуктами под ваш рацион в Lotte Mart, Big C или Mega Market, сюда донгов в донг прикрепятся все магазинные чеки.</i>';
    } else {
      listText = expenses.map((e, idx) => {
        const d = new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        return `${idx + 1}. <b>${Number(e.amount).toLocaleString('ru-RU')} VND</b> — ${e.note} <i>(${d})</i>`;
      }).join('\n');
    }

    const msg = `
🧾 <b>Личный кабинет семьи ${codeBadge}</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Клиент:</b> ${client.name || 'Семья'}
📍 <b>Кондо/Район:</b> ${client.address || client.survey?.address || 'Нячанг'}

🛒 <b>Магазинные чеки на продукты (строго без наценок):</b>
${listText}

━━━━━━━━━━━━━━━━━━
💰 <b>Итого продукты по чекам:</b> <code>${totalGroceries.toLocaleString('ru-RU')} VND</code>
⏱ <b>Работа шефа:</b> оплачивается отдельно по часам при сдаче кухни.
<i>Вы видите только чеки своей семьи. Всё полностью прозрачно и сохранено в вашем профиле!</i>
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Открыть интерактивное меню', web_app: { url: WEBAPP_URL } }],
          [{ text: '« В главное меню', callback_data: 'main_menu' }]
        ]
      }
    });
  }

  if (data === 'main_menu') {
    session.step = null;
    return sendMainMenu(chatId);
  }

  // --- АНКЕТА СЕМЬИ ---
  if (data === 'survey_start') {
    session.survey = {
      familySize: null,
      allergies: [],
      stopFoods: [],
      style: null,
      format: null
    };
    return askFamilySize(chatId);
  }

  if (data.startsWith('size_')) {
    const sizeMap = {
      size_2_2: '2 взрослых + 2 детей',
      size_2_1: '2 взрослых + 1 ребенок',
      size_couple: '1–2 взрослых',
      size_big: 'Большая семья (5+ человек)'
    };
    session.survey.familySize = sizeMap[data] || data;
    return askAllergies(chatId);
  }

  if (data.startsWith('allergy_toggle_')) {
    const allergy = data.replace('allergy_toggle_', '');
    if (allergy === 'none') {
      session.survey.allergies = ['Нет аллергий'];
      return askStopFoods(chatId);
    }
    session.survey.allergies = session.survey.allergies.filter(a => a !== 'Нет аллергий');

    const idx = session.survey.allergies.indexOf(allergy);
    if (idx >= 0) {
      session.survey.allergies.splice(idx, 1);
    } else {
      session.survey.allergies.push(allergy);
    }
    return askAllergies(chatId);
  }

  if (data === 'allergy_custom_input') {
    session.step = 'awaiting_custom_allergy';
    return api('sendMessage', {
      chat_id: chatId,
      text: `
✍️ <b>Ввод своего варианта аллергии:</b>
━━━━━━━━━━━━━━━━━━
Напишите ответным сообщением продукт или ограничение (например: <i>мёд, соя, сельдерей, диабет</i>):
      `.trim(),
      parse_mode: 'HTML'
    });
  }

  if (data === 'allergy_done') {
    if (session.survey.allergies.length === 0) {
      session.survey.allergies = ['Нет аллергий'];
    }
    return askStopFoods(chatId);
  }

  if (data.startsWith('stop_toggle_')) {
    const item = data.replace('stop_toggle_', '');
    if (item === 'none') {
      session.survey.stopFoods = ['Едим всё'];
      return askStyle(chatId);
    }
    session.survey.stopFoods = session.survey.stopFoods.filter(s => s !== 'Едим всё');

    const idx = session.survey.stopFoods.indexOf(item);
    if (idx >= 0) {
      session.survey.stopFoods.splice(idx, 1);
    } else {
      session.survey.stopFoods.push(item);
    }
    return askStopFoods(chatId);
  }

  if (data === 'stop_custom_input') {
    session.step = 'awaiting_custom_stop';
    return api('sendMessage', {
      chat_id: chatId,
      text: `
✍️ <b>Ввод своего нелюбимого продукта:</b>
━━━━━━━━━━━━━━━━━━
Напишите в чат продукт, который в вашей семье не любят (например: <i>брокколи, вареная морковь, чеснок</i>):
      `.trim(),
      parse_mode: 'HTML'
    });
  }

  if (data === 'stop_done') {
    if (session.survey.stopFoods.length === 0) {
      session.survey.stopFoods = ['Едим всё'];
    }
    return askStyle(chatId);
  }

  if (data.startsWith('style_')) {
    const styleMap = {
      style_classic: 'Привычная домашняя классика (борщ, котлеты, пюре)',
      style_healthy: 'Правильное питание / ЗОЖ (на пару, минимум масла)',
      style_mix: 'Микс (домашнее + ресторанные блюда)'
    };
    session.survey.style = styleMap[data] || data;
    return askFormat(chatId);
  }

  if (data.startsWith('format_')) {
    const formatMap = {
      format_home: 'Готовка на вашей кухне (от 250 000 VND / час)',
      format_delivery: 'Готовка вне кухни клиента с доставкой (от 300 000 VND / час)'
    };
    session.survey.format = formatMap[data] || data;

    db.clients[chatId] = {
      chatId,
      survey: session.survey,
      updatedAt: new Date().toISOString()
    };
    saveDB();

    return showSurveySummary(chatId);
  }

  // --- МЕНЮ ---
  if (data === 'menu_list') {
    const clientSurvey = db.clients[chatId]?.survey || session.survey || {};
    let customNote = '';
    if (clientSurvey.allergies && clientSurvey.allergies.length > 0 && !clientSurvey.allergies.includes('Нет аллергий')) {
      customNote = `\n💡 <i>С учетом ваших ограничений (${clientSurvey.allergies.join(', ')}) шеф безопасно заменит ингредиенты.</i>\n`;
    }

    const msg = `
🍲 <b>Пример недельного семейного меню</b>
━━━━━━━━━━━━━━━━━━
Блюда готовятся из свежего охлажденного мяса и отборных овощей супермаркетов Нячанга. Без химических добавок и избытка соли — подходят и взрослым, и детям.${customNote}
Нажмите на блюдо, чтобы узнать подробности и адаптацию:
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🍲 Домашний борщ на говядине', callback_data: 'dish_borsch' }],
          [{ text: '🥩 Сочные домашние котлеты (12 шт)', callback_data: 'dish_cutlets' }],
          [{ text: '🥘 Томленая говядина с овощами', callback_data: 'dish_beef_stew' }],
          [{ text: '🍝 Гарниры: паста, пюре, рис, гречка', callback_data: 'dish_pasta' }],
          [{ text: '🥧 Домашний ягодный пирог', callback_data: 'dish_pie' }],
          [{ text: '👨‍🍳 Заказать приготовление еды', callback_data: 'book_chef' }],
          [{ text: '« В главное меню', callback_data: 'main_menu' }]
        ]
      }
    });
  }

  if (data.startsWith('dish_')) {
    const dishKey = data.replace('dish_', '');
    const dish = MENU_ITEMS[dishKey];
    if (!dish) return sendMainMenu(chatId);

    const clientSurvey = db.clients[chatId]?.survey || session.survey || {};
    let adaptationText = '';

    if (dishKey === 'cutlets' && clientSurvey.allergies?.some(a => a.toLowerCase().includes('глютен'))) {
      adaptationText = '\n✨ <b>Адаптация под семью:</b> батон и панировка исключаются, котлеты готовятся с сочным кабачком без глютена.';
    }
    if (dishKey === 'cutlets' && clientSurvey.allergies?.some(a => a.toLowerCase().includes('лактоз'))) {
      adaptationText += '\n✨ <b>Безлактозная адаптация:</b> молоко заменяется на растительное или воду, сливочное масло исключается.';
    }
    if (dishKey === 'pasta' && clientSurvey.allergies?.some(a => a.toLowerCase().includes('глютен'))) {
      adaptationText = '\n✨ <b>Адаптация под семью:</b> заменяется на кукурузную/рисовую пасту или нежное картофельное пюре.';
    }
    if (dishKey === 'pie' && clientSurvey.allergies?.some(a => a.toLowerCase().includes('глютен'))) {
      adaptationText = '\n✨ <b>Адаптация под семью:</b> выпекается на рисовой муке без пшеницы.';
    }

    const ingText = dish.ingredients.map(i => `• ${i.name}: <b>${i.amount}</b>`).join('\n');
    const msg = `
${dish.title}
━━━━━━━━━━━━━━━━━━
📦 <b>Объем:</b> ${dish.portion}
👶 <b>Для детей:</b> ${dish.suitableForKids}
${adaptationText ? adaptationText + '\n' : ''}
📝 <b>Описание:</b>
${dish.desc}

🥗 <b>Ключевые ингредиенты:</b>
${ingText}
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '👨‍🍳 Заказать это меню', callback_data: 'book_chef' }],
          [{ text: '« Назад к меню', callback_data: 'menu_list' }]
        ]
      }
    });
  }

  // --- СТОИМОСТЬ И ЧЕКИ (ВЬЕТНАМ / НЯЧАНГ) ---
  if (data === 'info_pricing') {
    const msg = `
💰 <b>Тарифы, условия, магазины и локация шефа</b>
━━━━━━━━━━━━━━━━━━
Никаких скрытых платежей и наценок — всё абсолютно прозрачно:

1️⃣ <b>Продукты — строго по чекам без наценки (0%)</b>
Шеф закупает продукты в любых проверенных точках Нячанга по вашему желанию:
• <b>Lotte Mart (Gold Coast & 23/10):</b> охлажденная говядина, птица, отборные овощи.
• <b>MM Mega Market (Metro):</b> крупный гипермаркет, отборное мясо, сыры, бакалея.
• <b>Go! Nha Trang (Big C):</b> широкий ассортимент продуктов для всей семьи.
• <b>Moonmilk Delicatessen:</b> европейские сыры, сливочное масло, молочка без сахара.
• <b>Свежая рыба и морепродукты:</b> отборный охлажденный лосось и дикие креветки без заморозки.
• <b>Местные рынки (Chợ Xóm Mới & Chợ Đầm):</b> свежайшая фермерская зелень и фрукты.
• <b>Чек-лист «Это есть дома»:</b> в Mini App можно отметить продукты, которые уже есть на вашей кухне (масло, специи, мука, яйца), чтобы шеф не покупал их повторно!
• <b>Календарь слотов в Mini App:</b> бронируйте день и удобное время выезда шефа: 🌅 Утро (09:00–12:30), ☀️ День (13:30–17:00), 🌙 Вечер / BBQ (17:30–21:00).
<i>Все чеки магазинов прикрепляются в ваш профиль. Оплата продуктов — ровно по чекам донг в донг!</i>

2️⃣ <b>Почасовая ставка и форматы</b>
• <b>На вашей кухне:</b> <code>от 250 000 VND / час</code> (~10$)
• <b>Вне кухни клиента (с доставкой):</b> <code>от 300 000 VND / час</code> (~12$)
• <b>Выездные мероприятия & BBQ на виллах:</b> организация званых ужинов и барбекю по договоренности.

⏱ <b>Минимальный заказ:</b>
• От <b>3 часов</b> работы (полный рацион на семью на 3–4 дня).
• За 3–3.5 часа шеф успевает приготовить: борщ/суп 5 л, мясное/рыбное блюдо, гарнир, салат или свежую выпечку.

📍 <b>Локация шефа, зоны выезда и такси:</b>
• 🏠 <b>База шефа:</b> север Нячанга, район <b>Đường Đệ (Ngô Văn Sở)</b>.
• 🚶 <b>В радиусе до 500 м:</b> шеф доходит <b>пешком бесплатно (0 ₫)</b>.
• 🚕 <b>Свыше 500 м (Scenia Bay, центр, An Vien, виллы, мероприятия):</b> поездка шефа с комплектом оборудования и закупленными продуктами на такси (Grab по чеку в обе стороны) оплачивается клиентом и входит в организацию работы.
• 🥂 <b>Выездные мероприятия & BBQ:</b> выезд на любые виллы по побережью (+ такси по чеку).
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Заполнить анкету семьи', callback_data: 'survey_start' }],
          [{ text: '👨‍🍳 Заказать приготовление еды', callback_data: 'book_chef' }],
          [{ text: '« В главное меню', callback_data: 'main_menu' }]
        ]
      }
    });
  }

  // --- ЧИСТОТА, СТАНДАРТЫ И ХРАНЕНИЕ ---
  if (data === 'info_safety') {
    const msg = `
🛡 <b>Чистота, безопасность и стандарты</b>
━━━━━━━━━━━━━━━━━━
Я понимаю, насколько важно доверие, когда повар готовит для вашей семьи и детей:

✅ <b>Опыт и санитарные нормы:</b> Профессиональный поварской стаж, знание технологий и строгая гигиена.
✅ <b>Безупречная чистота:</b> Работаю в чистой форме, соблюдаю правила обработки поверхностей и инвентаря.
✅ <b>Порядок на кухне:</b> После завершения работы рабочие зоны дезинфицируются, плита протирается, посуда моется. Ваша кухня остается в идеальной чистоте.
✅ <b>Профессиональное обращение и хранение:</b> В жарком и влажном климате Вьетнама это критически важно:
• <b>Товарное соседство:</b> сырое мясо, птица и морепродукты никогда не контактируют с готовыми блюдами, овощами и зеленью;
• <b>Температурный контроль:</b> правильное быстрое охлаждение после термообработки для предотвращения размножения бактерий;
• <b>Бережная дефростация:</b> разморозка в холодильной камере без потери структуры и сочности волокон;
• <b>Герметичная упаковка:</b> порционная фасовка в плотные контейнеры с обязательной маркировкой даты и времени приготовления.
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '👨‍🍳 Заказать приготовление еды', callback_data: 'book_chef' }],
          [{ text: '« В главное меню', callback_data: 'main_menu' }]
        ]
      }
    });
  }

  // --- ЗАКАЗ ПРИГОТОВЛЕНИЯ ЕДЫ ---
  if (data === 'book_chef') {
    const now = Date.now();
    if (session.step === 'ask_name' && session.lastBookChefTime && (now - session.lastBookChefTime < 5000)) {
      return;
    }
    session.step = 'ask_name';
    session.lastBookChefTime = now;
    return api('sendMessage', {
      chat_id: chatId,
      text: `
👨‍🍳 <b>Заявка на приготовление семейного рациона</b>
━━━━━━━━━━━━━━━━━━
Я свяжусь с вами, чтобы обсудить удобные даты, детали кухни и точное меню под вкусы вашей семьи.

Пожалуйста, напишите ваше <b>Имя</b>:
      `.trim(),
      parse_mode: 'HTML'
    });
  }

  // --- КОНТАКТ ШЕФА ---
  if (data === 'contact_chef') {
    return api('sendMessage', {
      chat_id: chatId,
      text: `
👨‍🍳 <b>Связь с шефом Владиславом:</b>
━━━━━━━━━━━━━━━━━━
Я на связи в Нячанге ежедневно:

💬 Telegram: @Compotikman (или пишите прямо сюда в чат)
📱 Локальный телефон / WhatsApp: +84 (0) 000-000-000
📍 Нячанг, Вьетнам
      `.trim(),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '« В главное меню', callback_data: 'main_menu' }]]
      }
    });
  }
}

// Вопрос 1: Состав семьи
async function askFamilySize(chatId) {
  return api('sendMessage', {
    chat_id: chatId,
    text: `
👨‍👩‍👧‍👦 <b>Шаг 1 из 5: Состав вашей семьи</b>
━━━━━━━━━━━━━━━━━━
Для скольких человек мы будем готовить рацион?
    `.trim(),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👨‍👩‍👧‍👦 2 взрослых + 2 детей', callback_data: 'size_2_2' }],
        [{ text: '👨‍👩‍👧 2 взрослых + 1 ребенок', callback_data: 'size_2_1' }],
        [{ text: '👫 1–2 взрослых', callback_data: 'size_couple' }],
        [{ text: '🏡 Большая семья (5+ человек)', callback_data: 'size_big' }]
      ]
    }
  });
}

// Вопрос 2: Аллергии
async function askAllergies(chatId) {
  const selected = sessions[chatId]?.survey?.allergies || [];
  const has = (item) => selected.includes(item) ? '✅ ' : '▫️ ';

  const customItems = selected.filter(item => 
    !['Лактоза / молоко', 'Глютен / пшеница', 'Куриные яйца', 'Орехи / арахис', 'Рыба и морепродукты', 'Ягоды / цитрусовые', 'Нет аллергий'].includes(item)
  );

  const customButtons = customItems.map(item => [
    { text: `✅ ${item} (нажмите, чтобы убрать)`, callback_data: `allergy_toggle_${item}` }
  ]);

  return api('sendMessage', {
    chat_id: chatId,
    text: `
⚠️ <b>Шаг 2 из 5: Аллергии и непереносимости</b>
━━━━━━━━━━━━━━━━━━
Безопасность детей и взрослых — приоритет №1. Отметьте ограничения (можно выбрать несколько или ввести свой вариант текстом):
    `.trim(),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: `${has('Лактоза / молоко')}🥛 Лактоза / коровье молоко`, callback_data: 'allergy_toggle_Лактоза / молоко' }],
        [{ text: `${has('Глютен / пшеница')}🌾 Глютен / пшеничная мука`, callback_data: 'allergy_toggle_Глютен / пшеница' }],
        [{ text: `${has('Куриные яйца')}🥚 Куриные яйца / белок`, callback_data: 'allergy_toggle_Куриные яйца' }],
        [{ text: `${has('Орехи / арахис')}🥜 Орехи / арахис`, callback_data: 'allergy_toggle_Орехи / арахис' }],
        [{ text: `${has('Рыба и морепродукты')}🦐 Рыба и морепродукты`, callback_data: 'allergy_toggle_Рыба и морепродукты' }],
        [{ text: `${has('Ягоды / цитрусовые')}🍓 Клубника / цитрусовые`, callback_data: 'allergy_toggle_Ягоды / цитрусовые' }],
        ...customButtons,
        [{ text: '✍️ Ввести свой вариант текстом', callback_data: 'allergy_custom_input' }],
        [{ text: '🟢 Нет аллергий', callback_data: 'allergy_toggle_none' }],
        [{ text: '➡️ Готово, далее', callback_data: 'allergy_done' }]
      ]
    }
  });
}

// Вопрос 3: Стоп-продукты
async function askStopFoods(chatId) {
  const selected = sessions[chatId]?.survey?.stopFoods || [];
  const has = (item) => selected.includes(item) ? '❌ ' : '▫️ ';

  const customItems = selected.filter(item => 
    !['Кинза и резкая зелень', 'Вареный лук', 'Острое и перец', 'Брокколи и цветная капуста', 'Грибы', 'Свинина', 'Едим всё'].includes(item)
  );

  const customButtons = customItems.map(item => [
    { text: `❌ ${item} (нажмите, чтобы убрать)`, callback_data: `stop_toggle_${item}` }
  ]);

  return api('sendMessage', {
    chat_id: chatId,
    text: `
🚫 <b>Шаг 3 из 5: «Стоп-продукты»</b>
━━━━━━━━━━━━━━━━━━
Что в вашей семье категорически не любят (особенно дети)? Эти продукты шеф полностью исключит:
    `.trim(),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: `${has('Кинза и резкая зелень')}🌿 Кинза`, callback_data: 'stop_toggle_Кинза и резкая зелень' }],
        [{ text: `${has('Вареный лук')}🧅 Вареный лук`, callback_data: 'stop_toggle_Вареный лук' }],
        [{ text: `${has('Острое и перец')}🌶 Острое / перец`, callback_data: 'stop_toggle_Острое и перец' }],
        [{ text: `${has('Брокколи и цветная капуста')}🥦 Брокколи / цветная капуста`, callback_data: 'stop_toggle_Брокколи и цветная капуста' }],
        [{ text: `${has('Грибы')}🍄 Грибы`, callback_data: 'stop_toggle_Грибы' }],
        [{ text: `${has('Свинина')}🐷 Свинина`, callback_data: 'stop_toggle_Свинина' }],
        ...customButtons,
        [{ text: '✍️ Ввести свой стоп-продукт текстом', callback_data: 'stop_custom_input' }],
        [{ text: '🟢 Едим всё / нет стоп-продуктов', callback_data: 'stop_toggle_none' }],
        [{ text: '➡️ Готово, далее', callback_data: 'stop_done' }]
      ]
    }
  });
}

// Вопрос 4: Стиль кухни
async function askStyle(chatId) {
  return api('sendMessage', {
    chat_id: chatId,
    text: `
🍽 <b>Шаг 4 из 5: Предпочтения по кухне</b>
━━━━━━━━━━━━━━━━━━
Какой стиль еды ближе вашей семье?
    `.trim(),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🍲 Привычная домашняя классика', callback_data: 'style_classic' }],
        [{ text: '🥗 Правильное питание / ЗОЖ', callback_data: 'style_healthy' }],
        [{ text: '✨ Микс (домашнее + ресторанные подачи)', callback_data: 'style_mix' }]
      ]
    }
  });
}

// Вопрос 5: Формат
async function askFormat(chatId) {
  return api('sendMessage', {
    chat_id: chatId,
    text: `
🏠 <b>Шаг 5 из 5: Формат работы</b>
━━━━━━━━━━━━━━━━━━
Где вам удобнее организовать приготовление?
    `.trim(),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🍳 На вашей кухне (от 250k VND / час)', callback_data: 'format_home' }],
        [{ text: '📦 Вне кухни клиента с доставкой (от 300k VND / час)', callback_data: 'format_delivery' }]
      ]
    }
  });
}

// Сводка анкеты
async function showSurveySummary(chatId) {
  const s = sessions[chatId]?.survey || {};

  let recommendations = '';
  if (s.allergies?.some(a => a.toLowerCase().includes('глютен'))) {
    recommendations += '\n• <b>Без глютена:</b> котлеты с сочным кабачком без батона, паста кукурузная/пюре, пирог на рисовой муке.';
  }
  if (s.allergies?.some(a => a.toLowerCase().includes('лактоз'))) {
    recommendations += '\n• <b>Без лактозы:</b> замена молочных продуктов на растительные альтернативы или топленое масло ГХИ.';
  }
  if (s.allergies?.some(a => a.toLowerCase().includes('яйц'))) {
    recommendations += '\n• <b>Без яиц:</b> связка котлет и выпечка готовятся без яичного белка.';
  }

  const msg = `
🎉 <b>Анкета вашей семьи сохранена!</b>
━━━━━━━━━━━━━━━━━━
👨‍👩‍👧‍👦 <b>Состав:</b> ${s.familySize || 'Не указан'}
⚠️ <b>Аллергии:</b> ${s.allergies?.join(', ') || 'Нет'}
🚫 <b>Стоп-продукты:</b> ${s.stopFoods?.join(', ') || 'Нет'}
🍽 <b>Стиль еды:</b> ${s.style || 'Классика'}
🏠 <b>Формат:</b> ${s.format || 'Не указан'}

${recommendations ? '🛡 <b>Безопасная адаптация меню шефом:</b>' + recommendations + '\n' : ''}
💡 <i>Шеф учтет все указанные нюансы при согласовании рациона!</i>
  `.trim();

  return api('sendMessage', {
    chat_id: chatId,
    text: msg,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🍲 Посмотреть рекомендованное меню', callback_data: 'menu_list' }],
        [{ text: '👨‍🍳 Заказать приготовление еды', callback_data: 'book_chef' }],
        [{ text: '« В главное меню', callback_data: 'main_menu' }]
      ]
    }
  });
}

// Обработка текстовых сообщений
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const session = sessions[chatId] || (sessions[chatId] = {});

  // --- ОБРАБОТКА ДАННЫХ ИЗ TELEGRAM MINI APP (web_app_data) ---
  if (msg.web_app_data && msg.web_app_data.data) {
    try {
      const order = JSON.parse(msg.web_app_data.data);
      db.orders.push({
        id: Date.now(),
        chatId,
        username: msg.from?.username || '',
        ...order,
        createdAt: new Date().toISOString()
      });
      saveDB();

      await api('sendMessage', {
        chat_id: chatId,
        text: `🎉 <b>Спасибо за заказ, ${order.name}!</b>\n━━━━━━━━━━━━━━━━━━\nВаша заявка из интерактивного меню успешно принята.\n\n🍽 <b>Выбранные блюда:</b>\n${(order.dishes || []).map(d => `• ${d}`).join('\n')}\n\n📅 <b>Дата и время:</b> ${order.bookingDate || 'Ближайшее время'} • ${order.bookingSlot || 'Уточняется'}\n🔥 <b>Кухня:</b> ${order.oven || 'Только плита'}\n💳 <b>Оплата:</b> ${order.paymentMethod || 'Донги VND'}\n📍 <b>Кондо/Район:</b> ${order.address || 'Не указан'}\n⏱ <b>Ориентир работы:</b> ~${order.hours || '3.0'} ч (~${order.fee || '750 000'} ₫) + чеки продуктов\n\nШеф Владислав свяжется с вами по контакту <code>${order.phone}</code> в ближайшее время!`,
        parse_mode: 'HTML'
      });

      if (ADMIN_CHAT_ID) {
        await api('sendMessage', {
          chat_id: ADMIN_CHAT_ID,
          text: `🔔 <b>НОВАЯ ЗАЯВКА ИЗ TELEGRAM MINI APP!</b>\n━━━━━━━━━━━━━━━━━━\n👤 <b>Клиент:</b> ${order.name} (@${msg.from?.username || 'нет'})\n📱 <b>Телефон/Контакт:</b> <code>${order.phone}</code>\n📍 <b>Кондо/Район:</b> ${order.address || 'Не указан'}\n🏠 <b>Формат:</b> ${order.format || 'Не указан'}\n🔥 <b>Духовка:</b> ${order.oven || 'Только плита'}\n💳 <b>Оплата:</b> ${order.paymentMethod || 'Донги VND'}\n📅 <b>Дата визита:</b> ${order.bookingDate || 'Не указана'}\n⏰ <b>Слот времени:</b> ${order.bookingSlot || 'Не указан'}\n🛒 <b>Магазины:</b> ${order.stores || 'Lotte Mart / Рынок'}\n⚠️ <b>Пожелания/Аллергии:</b> ${order.notes || 'Нет'}\n\n🍽 <b>Выбранные блюда (${(order.dishes || []).length}):</b>\n${(order.dishes || []).map(d => `• ${d}`).join('\n')}\n\n🏠 <b>Есть дома:</b> ${(order.pantryItems && order.pantryItems.length) ? order.pantryItems.join(', ') : 'Всё купить'}\n\n⏱ <b>Ориентир работы:</b> ~${order.hours || '3.0'} ч (~${order.fee || '750 000'} ₫) + чеки`,
          parse_mode: 'HTML'
        });
      }
      return;
    } catch (err) {
      console.error('Ошибка обработки web_app_data:', err);
    }
  }

  if (text === '/start' || text === '/menu') {
    session.step = null;
    return sendMainMenu(chatId, null, msg.from || {});
  }

  // --- ВВОД СВОЕГО ВАРИАНТА АЛЛЕРГИИ ---
  if (session.step === 'awaiting_custom_allergy') {
    if (!session.survey) session.survey = { allergies: [], stopFoods: [] };
    session.survey.allergies = session.survey.allergies.filter(a => a !== 'Нет аллергий');
    session.survey.allergies.push(text);
    session.step = null;

    await api('sendMessage', {
      chat_id: chatId,
      text: `✅ Добавлено ограничение: <b>${text}</b>`,
      parse_mode: 'HTML'
    });
    return askAllergies(chatId);
  }

  // --- ВВОД СВОЕГО ВАРИАНТА СТОП-ПРОДУКТА ---
  if (session.step === 'awaiting_custom_stop') {
    if (!session.survey) session.survey = { allergies: [], stopFoods: [] };
    session.survey.stopFoods = session.survey.stopFoods.filter(s => s !== 'Едим всё');
    session.survey.stopFoods.push(text);
    session.step = null;

    await api('sendMessage', {
      chat_id: chatId,
      text: `❌ Добавлен стоп-продукт: <b>${text}</b>`,
      parse_mode: 'HTML'
    });
    return askStopFoods(chatId);
  }

  // --- АДМИН-КОМАНДЫ ДЛЯ ШЕФА ---
  if (text.startsWith('/chef') || (String(chatId) === String(ADMIN_CHAT_ID) && text === '/admin')) {
    const clientsCount = Object.keys(db.clients).length;
    const ordersCount = db.orders.length;
    let totalAllExpenses = 0;
    Object.values(db.clients).forEach(c => {
      (c.expenses || []).forEach(e => { totalAllExpenses += Number(e.amount) || 0; });
    });

    const adminMsg = `
👨‍🍳 <b>Панель управления шефа (Нячанг)</b>
━━━━━━━━━━━━━━━━━━
👥 Семьей с персональными кодами: <b>${clientsCount}</b>
📝 Всего заявок: <b>${ordersCount}</b>
🧾 Сумма чеков по клиентам: <b>${totalAllExpenses.toLocaleString('ru-RU')} VND</b>

<b>Команды шефа:</b>
👥 <code>/clients</code> — список семей с их номерами и балансом
🧾 <code>/expense [код] [сумма] [описание]</code> — прикрепить чек к семье
<i>(например: <code>/expense 101 450000 Lotte Mart говядина</code>)</i>
📄 <code>/bill [код] [часы]</code> — выставить итоговый счет семье
<i>(например: <code>/bill 101 3.5</code>)</i>
🛒 <code>/groceries</code> — расчет корзины продуктов
📋 <code>/orders</code> — последние заявки
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: adminMsg,
      parse_mode: 'HTML'
    });
  }

  // Список клиентов шефа
  if (text === '/clients' || (String(chatId) === String(ADMIN_CHAT_ID) && text.startsWith('/clients'))) {
    const list = Object.values(db.clients);
    if (list.length === 0) {
      return api('sendMessage', { chat_id: chatId, text: 'Пока нет зарегистрированных семей.' });
    }
    const lines = list.map(c => {
      const expSum = (c.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const name = c.name || (c.username ? '@' + c.username : 'Семья');
      const count = (c.expenses || []).length;
      return `🔑 <b>#${c.clientCode}</b>: <b>${name}</b>\n   Чеков: ${count} шт. на <b>${expSum.toLocaleString('ru-RU')} VND</b>`;
    }).join('\n\n');

    return api('sendMessage', {
      chat_id: chatId,
      text: `👥 <b>Список семей клиентов:</b>\n━━━━━━━━━━━━━━━━━━\n${lines}\n\n💡 <i>Чтобы прикрепить чек:</i>\n<code>/expense 101 450000 Lotte Mart говядина</code>`,
      parse_mode: 'HTML'
    });
  }

  // Выставление счета клиенту
  if (text.startsWith('/bill')) {
    const parts = text.split(' ').filter(Boolean);
    const code = parts[1];
    const hours = parseFloat(parts[2]);

    if (!code || isNaN(hours)) {
      return api('sendMessage', {
        chat_id: chatId,
        text: '❌ <b>Формат команды:</b> <code>/bill 101 3.5</code>\n<i>Где 101 — код семьи, 3.5 — отработанные часы.</i>',
        parse_mode: 'HTML'
      });
    }

    const client = findClientByCode(code);
    if (!client) {
      return api('sendMessage', {
        chat_id: chatId,
        text: `❌ Клиент с кодом <b>#${code}</b> не найден. Посмотрите список: <code>/clients</code>`,
        parse_mode: 'HTML'
      });
    }

    const rate = (client.survey?.format && client.survey.format.includes('доставк')) ? 300000 : 250000;
    const chefFee = Math.round(hours * rate);
    const groceryTotal = (client.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalDue = chefFee + groceryTotal;

    const billMsg = `
📄 <b>Счет на оплату услуг шеф-повара (#${client.clientCode})</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Семья:</b> ${client.name || 'Клиент'}
⏱ <b>Работа шефа:</b> ${hours} ч × ${rate.toLocaleString('ru-RU')} ₫ = <b>${chefFee.toLocaleString('ru-RU')} VND</b>
🛒 <b>Продукты по магазинным чекам (${(client.expenses || []).length} шт):</b> <b>${groceryTotal.toLocaleString('ru-RU')} VND</b>
━━━━━━━━━━━━━━━━━━
💎 <b>ИТОГО К ОПЛАТЕ:</b> <code>${totalDue.toLocaleString('ru-RU')} VND</code>

💳 <i>Оплата наличными донгами (VND) или переводом на карту / рубли по курсу.</i>
Большое спасибо за заказ!
    `.trim();

    await api('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>Счет сформирован:</b>\n\n${billMsg}`,
      parse_mode: 'HTML'
    });

    if (client.chatId && String(client.chatId) !== String(chatId)) {
      await api('sendMessage', {
        chat_id: client.chatId,
        text: billMsg,
        parse_mode: 'HTML'
      });
    }
    return;
  }

  // Прикрепление чека к конкретному клиенту или в общий учет
  if (text.startsWith('/expense')) {
    const parts = text.split(' ').filter(Boolean);
    let targetCode = null;
    let amount = 0;
    let note = '';

    if (parts.length >= 3 && !isNaN(Number(parts[1])) && !isNaN(Number(parts[2]))) {
      targetCode = parts[1];
      amount = parseFloat(parts[2]);
      note = parts.slice(3).join(' ') || 'Закупка продуктов';
    } else if (parts.length >= 2 && !isNaN(Number(parts[1]))) {
      amount = parseFloat(parts[1]);
      note = parts.slice(2).join(' ') || 'Общие расходы шефа';
    } else {
      return api('sendMessage', {
        chat_id: chatId,
        text: '❌ <b>Формат команды:</b>\n<code>/expense [код] [сумма] [описание]</code>\nНапример: <code>/expense 101 450000 Lotte Mart говядина</code>',
        parse_mode: 'HTML'
      });
    }

    if (targetCode) {
      const client = findClientByCode(targetCode);
      if (!client) {
        return api('sendMessage', {
          chat_id: chatId,
          text: `❌ Клиент с кодом <b>#${targetCode}</b> не найден. Список: <code>/clients</code>`,
          parse_mode: 'HTML'
        });
      }

      if (!client.expenses) client.expenses = [];
      const expItem = {
        id: Date.now(),
        amount,
        note,
        date: new Date().toISOString()
      };
      client.expenses.push(expItem);
      saveDB();

      await api('sendMessage', {
        chat_id: chatId,
        text: `✅ Чек на <b>${amount.toLocaleString('ru-RU')} VND</b> прикреплен к семье <b>#${client.clientCode} (${client.name || 'Клиент'})</b>!\n🛒 Закупка: ${note}`,
        parse_mode: 'HTML'
      });

      if (client.chatId && String(client.chatId) !== String(chatId)) {
        await api('sendMessage', {
          chat_id: client.chatId,
          text: `🧾 <b>Шеф Владислав прикрепил чек закупки к вашему профилю (#${client.clientCode})!</b>\n━━━━━━━━━━━━━━━━━━\n🛒 <b>Покупки:</b> ${note}\n💰 <b>Сумма по кассовому чеку:</b> <code>${amount.toLocaleString('ru-RU')} VND</code>\n\n<i>Все чеки сохраняются в вашем личном кабинете в разделе «🧾 Мои чеки и баланс».</i>`,
          parse_mode: 'HTML'
        });
      }
      return;
    } else {
      db.expenses.push({ id: Date.now(), amount, note, date: new Date().toISOString() });
      saveDB();
      return api('sendMessage', {
        chat_id: chatId,
        text: `✅ Чек на <b>${amount.toLocaleString('ru-RU')} VND</b> сохранен в общий учет!\nЗаметка: ${note}`,
        parse_mode: 'HTML'
      });
    }
  }

  if (false && text.startsWith('/chef_old')) {
    const clientsCount = Object.keys(db.clients).length;
    const ordersCount = db.orders.length;
    let totalAllExpenses = 0;
    Object.values(db.clients).forEach(c => {
      (c.expenses || []).forEach(e => { totalAllExpenses += Number(e.amount) || 0; });
    });

    const adminMsg = `
👨‍🍳 <b>Панель управления шефа (Нячанг)</b>
━━━━━━━━━━━━━━━━━━
👥 Семьей с персональными кодами: <b>${clientsCount}</b>
📝 Всего заявок: <b>${ordersCount}</b>
🧾 Сумма чеков по клиентам: <b>${totalAllExpenses.toLocaleString('ru-RU')} VND</b>

<b>Команды шефа:</b>
👥 <code>/clients</code> — список семей с их номерами и балансом
🧾 <code>/expense [код] [сумма] [описание]</code> — прикрепить чек к семье
<i>(например: <code>/expense 101 450000 Lotte Mart говядина</code>)</i>
📄 <code>/bill [код] [часы]</code> — выставить итоговый счет семье
<i>(например: <code>/bill 101 3.5</code>)</i>
🛒 <code>/groceries</code> — расчет корзины продуктов
📋 <code>/orders</code> — последние заявки
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: adminMsg,
      parse_mode: 'HTML'
    });
  }

  // Список клиентов шефа
  if (text === '/clients' || (String(chatId) === String(ADMIN_CHAT_ID) && text.startsWith('/clients'))) {
    const list = Object.values(db.clients);
    if (list.length === 0) {
      return api('sendMessage', { chat_id: chatId, text: 'Пока нет зарегистрированных семей.' });
    }
    const lines = list.map(c => {
      const expSum = (c.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const name = c.name || (c.username ? '@' + c.username : 'Семья');
      const count = (c.expenses || []).length;
      return `🔑 <b>#${c.clientCode}</b>: <b>${name}</b>\n   Чеков: ${count} шт. на <b>${expSum.toLocaleString('ru-RU')} VND</b>`;
    }).join('\n\n');

    return api('sendMessage', {
      chat_id: chatId,
      text: `👥 <b>Список семей клиентов:</b>\n━━━━━━━━━━━━━━━━━━\n${lines}\n\n💡 <i>Чтобы прикрепить чек:</i>\n<code>/expense 101 450000 Lotte Mart говядина</code>`,
      parse_mode: 'HTML'
    });
  }

  // Выставление счета клиенту
  if (text.startsWith('/bill')) {
    const parts = text.split(' ').filter(Boolean);
    const code = parts[1];
    const hours = parseFloat(parts[2]);

    if (!code || isNaN(hours)) {
      return api('sendMessage', {
        chat_id: chatId,
        text: '❌ <b>Формат команды:</b> <code>/bill 101 3.5</code>\n<i>Где 101 — код семьи, 3.5 — отработанные часы.</i>',
        parse_mode: 'HTML'
      });
    }

    const client = findClientByCode(code);
    if (!client) {
      return api('sendMessage', {
        chat_id: chatId,
        text: `❌ Клиент с кодом <b>#${code}</b> не найден. Посмотрите список: <code>/clients</code>`,
        parse_mode: 'HTML'
      });
    }

    const rate = (client.survey?.format && client.survey.format.includes('доставк')) ? 300000 : 250000;
    const chefFee = Math.round(hours * rate);
    const groceryTotal = (client.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalDue = chefFee + groceryTotal;

    const billMsg = `
📄 <b>Счет на оплату услуг шеф-повара (#${client.clientCode})</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Семья:</b> ${client.name || 'Клиент'}
⏱ <b>Работа шефа:</b> ${hours} ч × ${rate.toLocaleString('ru-RU')} ₫ = <b>${chefFee.toLocaleString('ru-RU')} VND</b>
🛒 <b>Продукты по магазинным чекам (${(client.expenses || []).length} шт):</b> <b>${groceryTotal.toLocaleString('ru-RU')} VND</b>
━━━━━━━━━━━━━━━━━━
💎 <b>ИТОГО К ОПЛАТЕ:</b> <code>${totalDue.toLocaleString('ru-RU')} VND</code>

💳 <i>Оплата наличными донгами (VND) или переводом на карту / рубли по курсу.</i>
Большое спасибо за заказ!
    `.trim();

    await api('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>Счет сформирован:</b>\n\n${billMsg}`,
      parse_mode: 'HTML'
    });

    if (client.chatId && String(client.chatId) !== String(chatId)) {
      await api('sendMessage', {
        chat_id: client.chatId,
        text: billMsg,
        parse_mode: 'HTML'
      });
    }
    return;
  }

  // Прикрепление чека к конкретному клиенту или в общий учет
  if (text.startsWith('/expense')) {
    const parts = text.split(' ').filter(Boolean);
    let targetCode = null;
    let amount = 0;
    let note = '';

    if (parts.length >= 3 && !isNaN(Number(parts[1])) && !isNaN(Number(parts[2]))) {
      targetCode = parts[1];
      amount = parseFloat(parts[2]);
      note = parts.slice(3).join(' ') || 'Закупка продуктов';
    } else if (parts.length >= 2 && !isNaN(Number(parts[1]))) {
      amount = parseFloat(parts[1]);
      note = parts.slice(2).join(' ') || 'Общие расходы шефа';
    } else {
      return api('sendMessage', {
        chat_id: chatId,
        text: '❌ <b>Формат команды:</b>\n<code>/expense [код] [сумма] [описание]</code>\nНапример: <code>/expense 101 450000 Lotte Mart говядина</code>',
        parse_mode: 'HTML'
      });
    }

    if (targetCode) {
      const client = findClientByCode(targetCode);
      if (!client) {
        return api('sendMessage', {
          chat_id: chatId,
          text: `❌ Клиент с кодом <b>#${targetCode}</b> не найден. Список: <code>/clients</code>`,
          parse_mode: 'HTML'
        });
      }

      if (!client.expenses) client.expenses = [];
      const expItem = {
        id: Date.now(),
        amount,
        note,
        date: new Date().toISOString()
      };
      client.expenses.push(expItem);
      saveDB();

      await api('sendMessage', {
        chat_id: chatId,
        text: `✅ Чек на <b>${amount.toLocaleString('ru-RU')} VND</b> прикреплен к семье <b>#${client.clientCode} (${client.name || 'Клиент'})</b>!\n🛒 Закупка: ${note}`,
        parse_mode: 'HTML'
      });

      if (client.chatId && String(client.chatId) !== String(chatId)) {
        await api('sendMessage', {
          chat_id: client.chatId,
          text: `🧾 <b>Шеф Владислав прикрепил чек закупки к вашему профилю (#${client.clientCode})!</b>\n━━━━━━━━━━━━━━━━━━\n🛒 <b>Покупки:</b> ${note}\n💰 <b>Сумма по кассовому чеку:</b> <code>${amount.toLocaleString('ru-RU')} VND</code>\n\n<i>Все чеки сохраняются в вашем личном кабинете в разделе «🧾 Мои чеки и баланс».</i>`,
          parse_mode: 'HTML'
        });
      }
      return;
    } else {
      db.expenses.push({ id: Date.now(), amount, note, date: new Date().toISOString() });
      saveDB();
      return api('sendMessage', {
        chat_id: chatId,
        text: `✅ Чек на <b>${amount.toLocaleString('ru-RU')} VND</b> сохранен в общий учет!\nЗаметка: ${note}`,
        parse_mode: 'HTML'
      });
    }
  }

  if (false && text.startsWith('/chef_old')) {
    const ordersCount = db.orders.length;
    const clientsCount = Object.keys(db.clients).length;
    const totalExpenses = db.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const adminMsg = `
👨‍🍳 <b>Панель управления шефа (Нячанг)</b>
━━━━━━━━━━━━━━━━━━
👥 Сохраненных профилей семей: <b>${clientsCount}</b>
📝 Заявок на готовку: <b>${ordersCount}</b>
🧾 Внесенных расходов по чекам: <b>${totalExpenses.toLocaleString('ru-RU')} VND</b>

<b>Команды шефа:</b>
🛒 <code>/groceries</code> — рассчитать корзину продуктов по техкартам
🧾 <code>/expense [сумма_VND] [описание]</code> — внести чек (например: /expense 450000 Lotte Mart говядина)
📋 <code>/orders</code> — посмотреть последние заявки
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: adminMsg,
      parse_mode: 'HTML'
    });
  }

  // Расчет списка покупок
  if (text === '/groceries') {
    let groceryList = `
🛒 <b>Сводный список закупки (семья 4 чел, на 3-4 дня в Нячанге):</b>
━━━━━━━━━━━━━━━━━━
🥩 <b>Мясо (Lotte Mart / Mega Market):</b>
• Говядина на кости (бульон): 1.2 кг
• Мякоть говядины (тушение): 1.1 кг
• Свежий фарш 60/40: 850 г

🥕 <b>Овощи и зелень:</b>
• Картофель Далат: 1.5 кг
• Свёкла Далат: 500 г
• Капуста белокочанная: 500 г
• Лук репчатый: 600 г
• Морковь: 600 г
• Сладкий болгарский перец: 300 г
• Томаты: 400 г
• Чеснок: 1 головка

🧀 <b>Бакалея и молочные продукты (Lotte Mart / Moonmilk):</b>
• Паста твердых сортов: 1 пачка (500 г)
• Сливочное масло натуральное: 200 г
• Молоко свежее (Dalat Milk / TH True Milk): 1 пачка
• Батон для тостов: 1 шт
• Панировка / томатная паста: по 1 уп.
• Мука, сахар, яйца (для выпечки)
    `.trim();

    return api('sendMessage', {
      chat_id: chatId,
      text: groceryList,
      parse_mode: 'HTML'
    });
  }

  // Добавление чека в VND
  if (text.startsWith('/expense')) {
    const parts = text.split(' ');
    const amount = parseFloat(parts[1]);
    const note = parts.slice(2).join(' ') || 'Закупка продуктов в Нячанге';

    if (isNaN(amount)) {
      return api('sendMessage', {
        chat_id: chatId,
        text: '❌ Формат команды: <code>/expense 520000 Lotte Mart закупка</code>',
        parse_mode: 'HTML'
      });
    }

    const expItem = {
      id: Date.now(),
      amount,
      note,
      date: new Date().toISOString()
    };
    db.expenses.push(expItem);
    saveDB();

    return api('sendMessage', {
      chat_id: chatId,
      text: `✅ Чек на <b>${amount.toLocaleString('ru-RU')} VND</b> сохранен в учет расходов!\nМагазин/заметка: ${note}`,
      parse_mode: 'HTML'
    });
  }

  // Заявки
  if (text === '/orders') {
    if (db.orders.length === 0) {
      return api('sendMessage', { chat_id: chatId, text: 'Пока нет новых заявок.' });
    }
    const lastOrders = db.orders.slice(-5).reverse().map((o, idx) => `
${idx + 1}. <b>${o.name}</b> (${o.phone})
📍 Район/Кондо: ${o.address || 'Не указан'}
📅 Дата: ${o.date || 'Не указана'}
👨‍👩‍👧 Семья: ${o.survey?.familySize || 'Не указана'}
⚠️ Аллергии: ${o.survey?.allergies?.join(', ') || 'Нет'}
🏠 Формат: ${o.survey?.format || 'Не указан'}
    `.trim()).join('\n\n');

    return api('sendMessage', {
      chat_id: chatId,
      text: `📋 <b>Последние заявки:</b>\n\n${lastOrders}`,
      parse_mode: 'HTML'
    });
  }

  // --- ОФОРМЛЕНИЕ ЗАЯВКИ НА ПРИГОТОВЛЕНИЕ ЕДЫ ---
  if (session.step === 'ask_name') {
    session.name = text;
    session.step = 'ask_phone';
    return api('sendMessage', {
      chat_id: chatId,
      text: `Приятно познакомиться, <b>${text}</b>!\n\nУкажите ваш <b>номер телефона / WhatsApp или Telegram-ник</b> для связи:`,
      parse_mode: 'HTML'
    });
  }

  if (session.step === 'ask_phone') {
    session.phone = text;
    session.step = 'ask_address';
    return api('sendMessage', {
      chat_id: chatId,
      text: `Спасибо! В каком <b>районе Нячанга</b> (или кондоминиуме) вы находитесь?`,
      parse_mode: 'HTML'
    });
  }

  if (session.step === 'ask_address') {
    session.address = text;
    session.step = 'ask_date';
    return api('sendMessage', {
      chat_id: chatId,
      text: `Отлично. На какую <b>ориентировочную дату</b> вы хотите запланировать приготовление или доставку рациона?`,
      parse_mode: 'HTML'
    });
  }

  if (session.step === 'ask_date') {
    session.preferredDate = text;
    const clientSurvey = db.clients[chatId]?.survey || session.survey || {};

    const order = {
      id: Date.now(),
      chatId,
      name: session.name,
      phone: session.phone,
      address: session.address,
      date: session.preferredDate,
      survey: clientSurvey,
      createdAt: new Date().toISOString()
    };
    db.orders.push(order);
    saveDB();

    // Сообщение клиенту
    await api('sendMessage', {
      chat_id: chatId,
      text: `
🎉 <b>Ваша заявка принята!</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Контакт:</b> ${session.name} (${session.phone})
📍 <b>Локация:</b> ${session.address}
📅 <b>Желаемая дата:</b> ${session.preferredDate}

👨‍🍳 Владислав свяжется с вами в ближайшее время, чтобы утвердить точный список блюд, согласовать закупку продуктов и время!

<i>Спасибо за доверие к нашей семейной кулинарной службе в Нячанге!</i>
      `.trim(),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '« В главное меню', callback_data: 'main_menu' }]]
      }
    });

    // Уведомление шефу (администратору)
    if (ADMIN_CHAT_ID) {
      await api('sendMessage', {
        chat_id: ADMIN_CHAT_ID,
        text: `
🔔 <b>НОВАЯ ЗАЯВКА НА ГОТОВКУ В НЯЧАНГЕ!</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Клиент:</b> ${session.name}
📞 <b>Контакт:</b> ${session.phone}
📍 <b>Локация/Кондо:</b> ${session.address}
📅 <b>Дата:</b> ${session.preferredDate}

👨‍👩‍👧‍👦 <b>Семья:</b> ${clientSurvey.familySize || 'Не заполнен'}
⚠️ <b>Аллергии:</b> ${clientSurvey.allergies?.join(', ') || 'Нет'}
🚫 <b>Стоп-продукты:</b> ${clientSurvey.stopFoods?.join(', ') || 'Нет'}
🍽 <b>Стиль:</b> ${clientSurvey.style || 'Не указан'}
🏠 <b>Формат:</b> ${clientSurvey.format || 'Не указан'}
        `.trim(),
        parse_mode: 'HTML'
      });
    }

    session.step = null;
    return;
  }

  return sendMainMenu(chatId);
}

// Защита от запуска нескольких экземпляров бота (Mutex на локальном порту)
const net = require('net');
const LOCK_PORT = 43128;
const lockServer = net.createServer();
lockServer.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('⚠️ ВНИМАНИЕ: Другой процесс telegramBot.js уже запущен! Завершаю дублирующий процесс во избежание спама.');
    process.exit(0);
  }
});
lockServer.listen(LOCK_PORT, '127.0.0.1');

// Запуск фонового опроса (Long Polling) с дедупликацией и защитой от спама
let offset = 0;
const processedUpdates = new Set();
const lastCallbackTaps = new Map();

async function poll() {
  try {
    const res = await api('getUpdates', { offset, timeout: 10 });
    if (res.ok && Array.isArray(res.result)) {
      for (const u of res.result) {
        if (u.update_id >= offset) {
          offset = u.update_id + 1;
        }

        // Защита от повторной обработки одного и того же обновления
        if (processedUpdates.has(u.update_id)) continue;
        processedUpdates.add(u.update_id);
        if (processedUpdates.size > 2000) {
          const firstKey = processedUpdates.values().next().value;
          processedUpdates.delete(firstKey);
        }

        if (u.message) {
          await handleMessage(u.message);
        }

        if (u.callback_query) {
          const cq = u.callback_query;
          // Моментально отвечаем Telegram, чтобы убрать индикатор загрузки на кнопке
          api('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});

          // Дебаунс: защита от повторных нажатий (например, несколько кликов за 1.5 сек)
          const tapKey = `${cq.message?.chat?.id || ''}_${cq.data || ''}`;
          const now = Date.now();
          if (lastCallbackTaps.has(tapKey) && (now - lastCallbackTaps.get(tapKey) < 1500)) {
            continue;
          }
          lastCallbackTaps.set(tapKey, now);

          await handleCallback(cq);
        }
      }
    }
  } catch (err) {
    // Продолжаем опрос
  }
  setTimeout(poll, 1000);
}

if (!TOKEN) {
  console.log('⚠️ TELEGRAM_BOT_TOKEN не задан в .env.local!');
} else {
  console.log('🚀 Бот шеф-повара в Нячанге успешно запущен!');
  
  // Очистка очереди старых накопившихся сообщений при перезапуске
  api('getUpdates', { offset: -1 }).then(res => {
    if (res.ok && Array.isArray(res.result) && res.result.length > 0) {
      offset = res.result[0].update_id + 1;
      console.log(`🧹 Очередь старых сообщений очищена, offset: ${offset}`);
    }
    if (WEBAPP_URL) {
      api('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: '🍽 Меню и калькулятор',
          web_app: { url: WEBAPP_URL }
        }
      }).then(r => console.log('Кнопка меню WebApp установлена:', r?.ok));
    }
    poll();
  }).catch(() => {
    poll();
  });
}

// Healthcheck-сервер для работы на Render / облачных хостингах
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Chef Vladislav Telegram Bot is running 24/7');
}).listen(PORT, () => {
  console.log(`Healthcheck server running on port ${PORT}`);
});
