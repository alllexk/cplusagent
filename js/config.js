/* ===== Конфигурация Supabase =====
 * Заполните эти поля перед публикацией, чтобы заработала регистрация по e-mail.
 *
 * 1. Создайте проект на https://supabase.com (бесплатный план подойдёт).
 * 2. В панели проекта откройте Settings → API.
 * 3. Скопируйте:
 *      - Project URL  -> url
 *      - anon public  -> anonKey
 * 4. В разделе Authentication → Providers убедитесь, что включён Email.
 * 5. В Authentication → URL Configuration обязательно укажите:
 *      - Site URL:      https://<user>.github.io/<repo>/
 *      - Redirect URLs: https://<user>.github.io/<repo>/**
 *    Без этого ссылки подтверждения e-mail и восстановления пароля будут
 *    вести на Site URL, а страницы login.html/chat.html не откроются.
 *
 * Скрипты подключения (js/auth.js) сами загружают клиент Supabase с CDN,
 * поэтому дополнительных библиотек в репозиторий класть не нужно.
 *
 * Если оставить поля пустыми, приложение запустится в «демо-режиме»:
 * на странице входа появится кнопка демо-входа, а регистрация покажет
 * подсказку о настройке ключей.
 */
window.SUPABASE_CONFIG = {
  url: "https://ueciixgejilrtdhruyej.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlY2lpeGdlamlscnRkaHJ1eWVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMDU2MzcsImV4cCI6MjEwMzY4MTYzN30.OfBB771R5fX-O-kb8e87NRjXY5imxmPnXtalfJ4KKKk"
};
