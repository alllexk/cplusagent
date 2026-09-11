/* ===== C+ Агент — общий модуль авторизации =====
 * Подключается на каждой странице: создаёт клиент Supabase, следит за сессией,
 * рисует блок авторизации в шапке (справа вверху — кнопка «Выйти») и отдаёт
 * страницам готовые хелперы: уведомления, валидацию, вход/регистрацию/сброс пароля.
 */
(function (window, document) {
  "use strict";

  var CFG = window.SUPABASE_CONFIG || {};
  var SUPABASE_URL = CFG.url || "";
  var SUPABASE_KEY = CFG.anonKey || "";
  var CONFIGURED = !!(SUPABASE_URL && SUPABASE_KEY);

  var DEMO_STORAGE_KEY = "cplusagent_demo_user";
  var LOGIN_PAGE = "login.html";
  var CHAT_PAGE = "chat.html";
  var RESET_PAGE = "reset-password.html";
  var REVEAL_TIMEOUT = 8000;
  var RECONCILE_DELAY = 1500;

  var client = null;
  var clientPromise = null;
  var session = null;
  var initialized = false;
  var initPromise = null;
  var listeners = [];

  function $(id) { return document.getElementById(id); }

  // Абсолютный адрес страницы сайта — нужен для redirectTo в письмах Supabase
  function pageUrl(name) {
    try { return new URL(name, document.baseURI).href; }
    catch (e) { return name; }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ---------- Уведомления ---------- */
  function showNotice(text, type) {
    var el = $("notice");
    if (!el) return;
    el.textContent = text;
    el.className = "notice notice--" + (type || "info");
    el.hidden = false;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideNotice() {
    var el = $("notice");
    if (!el) return;
    el.textContent = "";
    el.hidden = true;
    el.className = "notice";
  }

  /* ---------- Валидация полей ---------- */
  function validateInput(input) {
    var err = input.parentElement.querySelector(".field__error");
    var valid = true;
    if (input.required && !input.value.trim()) valid = false;
    if (input.type === "email" && input.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) valid = false;
    if (input.type === "password" && input.getAttribute("minlength") &&
        input.value.length < parseInt(input.getAttribute("minlength"), 10)) valid = false;
    input.classList.toggle("is-invalid", !valid);
    if (err) err.classList.toggle("is-visible", !valid);
    return valid;
  }

  function validateForm(form) {
    var ok = true;
    form.querySelectorAll("input").forEach(function (input) {
      if (!validateInput(input)) ok = false;
    });
    return ok;
  }

  document.addEventListener("input", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("field__input")) {
      validateInput(e.target);
    }
  });

  /* ---------- Демо-режим (когда Supabase не настроен) ---------- */
  function demoUser() {
    return {
      id: "demo",
      email: "demo@cplusagent.local",
      user_metadata: { full_name: "Демо-пользователь" }
    };
  }

  function getDemoSession() {
    try {
      if (window.sessionStorage.getItem(DEMO_STORAGE_KEY) !== "1") return null;
    } catch (e) { return null; }
    return { user: demoUser() };
  }

  function clearDemoSession() {
    try { window.sessionStorage.removeItem(DEMO_STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  /* ---------- Клиент Supabase ---------- */
  function getClient() {
    if (!CONFIGURED) return Promise.resolve(null);
    if (client) return Promise.resolve(client);
    if (clientPromise) return clientPromise;
    clientPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.async = true;
      script.onload = function () {
        if (!window.supabase) { reject(new Error("supabase-js не загрузился")); return; }
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        resolve(client);
      };
      script.onerror = function () { reject(new Error("Не удалось загрузить supabase-js")); };
      document.head.appendChild(script);
    });
    return clientPromise;
  }

  function withClient(fn) {
    return getClient().then(function (c) {
      if (!c) throw new Error("Supabase не настроен: заполните js/config.js.");
      return fn(c);
    });
  }

  /* ---------- Состояние сессии ---------- */
  function applySession(next) {
    session = next;
    renderHeader(next);
    listeners.slice().forEach(function (cb) {
      try { cb(next); } catch (e) { console.error(e); }
    });
  }

  // Подписка на изменения сессии. Если инициализация уже прошла,
  // колбек сразу получает текущее состояние.
  function onChange(cb) {
    listeners.push(cb);
    if (initialized) cb(session);
  }

  function signOut() {
    hideNotice();
    clearDemoSession();
    if (!client) {
      applySession(getDemoSession());
      showNotice("Вы вышли из системы.", "info");
      return Promise.resolve();
    }
    function finish() {
      applySession(null);
      showNotice("Вы вышли из системы.", "info");
    }
    return client.auth.signOut().then(finish, function (err) {
      // Если серверный signOut не прошёл (нет сети, устаревший токен) —
      // очищаем сессию локально, чтобы пользователь вышел в любом случае
      console.warn("signOut:", err && err.message);
      return client.auth.signOut({ scope: "local" }).then(finish, finish);
    });
  }

  // Отрисовка правого верхнего блока шапки
  function renderHeader(s) {
    var area = $("authArea");
    if (!area) return;
    var user = s && s.user;

    if (!user) {
      area.innerHTML =
        '<a class="btn btn--ghost" href="' + LOGIN_PAGE + '">Вход</a>' +
        '<a class="btn btn--primary" href="register.html">Регистрация</a>';
      return;
    }

    var meta = user.user_metadata || {};
    var name = meta.full_name || meta.name || "";
    var email = user.email || "";
    var initial = (name || email || "?").charAt(0).toUpperCase();

    area.innerHTML =
      '<div class="user-chip" title="' + escapeHtml(email) + '">' +
        '<span class="user-chip__avatar">' + escapeHtml(initial) + "</span>" +
        '<span class="user-chip__text">' +
          '<span class="user-chip__name">' + escapeHtml(name || "Пользователь") + "</span>" +
          '<span class="user-chip__email">' + escapeHtml(email || "—") + "</span>" +
        "</span>" +
      "</div>" +
      '<button class="btn btn--outline" id="btnLogout" type="button">Выйти</button>';

    var btn = $("btnLogout");
    if (btn) btn.addEventListener("click", function () { signOut(); });
  }

  function reveal() {
    document.body.classList.remove("auth-pending");
  }

  /* ---------- Инициализация ---------- */
  // supabase-js разбирает токены из адреса (подтверждение e-mail, ссылка сброса
  // пароля) асинхронно, поэтому после инициализации ещё раз сверяемся с хранилищем.
  function reconcileSession() {
    if (!client || session) return;
    client.auth.getSession().then(function (res) {
      var found = res && res.data ? res.data.session : null;
      if (found && !session) applySession(found);
    }).catch(function () { /* ignore */ });
  }

  function init() {
    if (initPromise) return initPromise;

    if (!CONFIGURED) {
      initialized = true;
      applySession(getDemoSession());
      initPromise = Promise.resolve(session);
      return initPromise;
    }

    initPromise = getClient().then(function (c) {
      c.auth.onAuthStateChange(function (_event, nextSession) {
        applySession(nextSession);
      });
      return c.auth.getSession();
    }).then(function (res) {
      initialized = true;
      applySession(res && res.data ? res.data.session : null);
      window.setTimeout(reconcileSession, RECONCILE_DELAY);
      return session;
    }).catch(function (err) {
      console.warn("Supabase недоступен:", err && err.message);
      initialized = true;
      applySession(null);
      return null;
    });
    return initPromise;
  }

  /* ---------- Методы авторизации ---------- */
  function signIn(email, password) {
    return withClient(function (c) {
      return c.auth.signInWithPassword({ email: email, password: password });
    });
  }

  function signUp(email, password, name) {
    return withClient(function (c) {
      return c.auth.signUp({
        email: email,
        password: password,
        options: {
          data: name ? { full_name: name } : {},
          emailRedirectTo: pageUrl(CHAT_PAGE)
        }
      });
    });
  }

  function sendPasswordReset(email) {
    return withClient(function (c) {
      return c.auth.resetPasswordForEmail(email, { redirectTo: pageUrl(RESET_PAGE) });
    });
  }

  function updatePassword(password) {
    return withClient(function (c) {
      return c.auth.updateUser({ password: password });
    });
  }

  /* ---------- Понятные сообщения об ошибках ---------- */
  function friendlyError(err) {
    var msg = (err && (err.message || err.error_description)) ? (err.message || err.error_description) : String(err);
    var map = {
      "Invalid login credentials": "Неверный e-mail или пароль.",
      "Email not confirmed": "E-mail не подтверждён. Проверьте почту и перейдите по ссылке из письма.",
      "User already registered": "Пользователь с таким e-mail уже зарегистрирован.",
      "Password should be at least 6 characters": "Пароль должен содержать минимум 6 символов.",
      "New password should be different from the old password": "Новый пароль должен отличаться от старого.",
      "Email rate limit exceeded": "Слишком много писем за короткое время. Попробуйте позже.",
      "For security purposes, you can only request this after": "Письмо уже отправлено. Повторите попытку через минуту.",
      "Auth session missing": "Ссылка недействительна или устарела. Запросите новую.",
      "Token has expired or is invalid": "Ссылка недействительна или устарела. Запросите новую.",
      "Failed to fetch": "Нет связи с сервером. Проверьте интернет и попробуйте снова."
    };
    for (var key in map) {
      if (msg.indexOf(key) !== -1) return map[key];
    }
    return msg;
  }

  /* ---------- Ссылка из письма для сброса пароля ---------- */
  // Supabase приводит пользователя на Site URL с токенами в хэше.
  // Если это не страница сброса — сразу переносим ссылку туда.
  function redirectRecoveryLink() {
    var hash = window.location.hash || "";
    if (hash.indexOf("type=recovery") === -1) return;
    if (/reset-password\.html$/.test(window.location.pathname)) return;
    window.location.replace(pageUrl(RESET_PAGE) + hash);
  }
  redirectRecoveryLink();

  // Подстраховка: если CDN Supabase недоступен, страница всё равно не «зависает» скрытой
  window.setTimeout(reveal, REVEAL_TIMEOUT);

  window.CPlusAuth = {
    configured: CONFIGURED,

    init: init,
    reveal: reveal,
    onChange: onChange,
    session: function () { return session; },
    client: getClient,

    pageUrl: pageUrl,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    sendPasswordReset: sendPasswordReset,
    updatePassword: updatePassword,

    showNotice: showNotice,
    hideNotice: hideNotice,
    validateInput: validateInput,
    validateForm: validateForm,
    friendlyError: friendlyError,

    demo: {
      available: !CONFIGURED,
      signIn: function () {
        try { window.sessionStorage.setItem(DEMO_STORAGE_KEY, "1"); } catch (e) { /* ignore */ }
        applySession(getDemoSession());
      }
    }
  };
})(window, document);
