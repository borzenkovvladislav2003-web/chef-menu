/**
 * Supabase Client & Database Services
 * Автоматически использует Supabase, если заданы ключи в .env.local,
 * либо плавно откатывается на локальный bot_data.json, пока ключи не добавлены.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Чтение .env.local
function getEnvConfig() {
  const envPaths = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env')
  ];
  const env = {};
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
          env[key] = val;
        }
      });
    }
  }
  return env;
}

const env = getEnvConfig();
const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
  console.log('⚡️ [Supabase] Успешно подключено к облачной базе данных:', SUPABASE_URL);
} else {
  console.log('ℹ️ [Supabase] Переменные SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы. Работаем в локальном режиме.');
}

const DB_FILE = path.join(__dirname, '..', 'bot_data.json');

module.exports = {
  isCloudReady: () => Boolean(supabase),

  // Клиенты
  async getClient(chatId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('chat_id', chatId)
        .maybeSingle();
      if (!error && data) return data;
    }
    return null;
  },

  async upsertClient(clientData) {
    if (supabase) {
      const { data, error } = await supabase
        .from('clients')
        .upsert(clientData, { onConflict: 'chat_id' })
        .select()
        .single();
      if (error) console.error('Ошибка сохранения клиента в Supabase:', error.message);
      return data;
    }
    return null;
  },

  // Заказы
  async createOrder(orderData) {
    if (supabase) {
      const { data, error } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single();
      if (error) console.error('Ошибка создания заказа в Supabase:', error.message);
      return data;
    }
    return null;
  },

  async updateOrderStatus(orderId, status) {
    if (supabase) {
      const { data, error } = await supabase
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .select()
        .single();
      return data;
    }
    return null;
  },

  // Меню
  async getDishes() {
    if (supabase) {
      const { data, error } = await supabase
        .from('dishes')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (!error && data) return data;
    }
    return null;
  },

  // Чеки закупки
  async addExpense(expenseData) {
    if (supabase) {
      const { data, error } = await supabase
        .from('expenses')
        .insert(expenseData)
        .select()
        .single();
      return data;
    }
    return null;
  },

  // Отзывы
  async getApprovedReviews() {
    if (supabase) {
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('is_approved', true)
        .order('created_at', { ascending: false });
      if (!error && data) return data;
    }
    return null;
  }
};
