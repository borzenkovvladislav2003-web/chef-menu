/**
 * Скрипт миграции локальных данных (bot_data.json) в Supabase
 * Запуск: node scripts/syncToSupabase.js
 */

const fs = require('fs');
const path = require('path');
const dbClient = require('./supabaseClient');

async function sync() {
  if (!dbClient.isCloudReady()) {
    console.error('❌ Supabase не настроен в .env.local. Пожалуйста, добавьте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const dbFile = path.join(__dirname, '..', 'bot_data.json');
  if (!fs.existsSync(dbFile)) {
    console.log('Файл bot_data.json не найден, нечего синхронизировать.');
    return;
  }

  const localData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  console.log(`Найдено клиентов в локальной базе: ${Object.keys(localData.clients || {}).length}`);

  for (const [chatId, client] of Object.entries(localData.clients || {})) {
    console.log(`Синхронизация клиента #${client.clientCode || ''} (${client.name || chatId})...`);
    await dbClient.upsertClient({
      chat_id: Number(chatId),
      client_code: client.clientCode,
      name: client.name || '',
      username: client.username || '',
      survey: client.survey || {},
      address: client.address || client.survey?.address || ''
    });
  }

  console.log('✅ Синхронизация клиентов в Supabase завершена успешно!');
}

sync().catch(console.error);
