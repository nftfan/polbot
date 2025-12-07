const TelegramBot = require('node-telegram-bot-api');

// --- CONFIG ---
const BOT_TOKEN = '8206583869:AAHg-L0Atf_Y5zEI8DNfNdR7KIcJfDoDs94';

// --- INIT BOT ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on('polling_error', (err) => {
  console.error('Polling error:', err);
});

// --- SIMPLE LISTENER JUST TO LOG CHAT ID ---
bot.on('message', (msg) => {
  console.log('New message received');
  console.log('Full msg.chat object:', msg.chat);
  console.log('Chat ID:', msg.chat.id);
});

// Keep process alive
console.log('Bot started. Send a message in your group to see the Chat ID in logs.');
