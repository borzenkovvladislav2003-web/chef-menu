/**
 * Локальный HTTP-сервер для Telegram Mini App (Chef Financial Tracker)
 * Запуск: node scripts/server.js
 * Доступен по адресу: http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Автоматическое определение папки webapp (работает как из корня проекта, так и из webapp/)
const WEBAPP_DIR = fs.existsSync(path.join(__dirname, '..', 'index.html'))
  ? path.join(__dirname, '..')
  : path.join(__dirname, '..', 'webapp');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS заголовки для работы внутри Telegram WebApp
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    decodedPath = req.url.split('?')[0];
  }

  let filePath = path.join(WEBAPP_DIR, decodedPath === '/' ? 'index.html' : decodedPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Если запрошен конкретный статический ассет с расширением (картинка, js, css), отдаем чистый 404
        if (ext && ext !== '.html') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(`404: Файл ${path.basename(filePath)} не найден`);
        }

        // Если запрошен несуществующий раздел/роут, отдаем брендированную страницу 404.html со статусом 404
        const notFoundFile = path.join(WEBAPP_DIR, '404.html');
        fs.readFile(notFoundFile, (err404, notFoundContent) => {
          if (!err404) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(notFoundContent);
          } else {
            // Если 404.html отсутствует, fallback на index.html
            fs.readFile(path.join(WEBAPP_DIR, 'index.html'), (errIndex, indexContent) => {
              if (!errIndex) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(indexContent);
              } else {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404: Страница не найдена');
              }
            });
          }
        });
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Ошибка сервера: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`✨ Telegram Mini App успешно запущен: http://localhost:${PORT}`);
  console.log(`📂 Корневая папка: ${WEBAPP_DIR}`);
});
