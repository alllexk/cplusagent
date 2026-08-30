/* ===== C+ Агент — логика приложения =====
 * Регистрация и вход по e-mail через Supabase Auth.
 * В демо-режиме (без настроенного Supabase) работает чат, а формы
 * показывают подсказку о необходимости заполнить js/config.js.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "";
  var SUPABASE_KEY = "";
  try {
    if (window.SUPABASE_CONFIG) {
      SUPABASE_URL = window.SUPABASE_CONFIG.url || "";
      SUPABASE_KEY = window.SUPABASE_CONFIG.anonKey || "";
    }
  } catch (e) { /* конфиг отсутствует — демо-режим */ }

  var CONFIGURED = !!(SUPABASE_URL && SUPABASE_KEY);

  var supabase = null;

  // Промис загрузки Supabase-клиента с CDN (только если есть конфигурация)
  var supabasePromise = null;
  function loadSupabase() {
    if (!CONFIGURED) return Promise.resolve(null);
    if (supabase) return Promise.resolve(supabase);
    if (supabasePromise) return supabasePromise;
    supabasePromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = function () {
        if (!window.supabase) { reject(new Error("supabase-js не загрузился")); return; }
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        resolve(supabase);
      };
      script.onerror = function () { reject(new Error("Не удалось загрузить supabase-js")); };
      document.head.appendChild(script);
    });
    return supabasePromise;
  }

  // ---- Ссылки на элементы ----
  var $ = function (id) { return document.getElementById(id); };
  var noticeEl = $("notice");
  var formLogin = $("formLogin");
  var formRegister = $("formRegister");
  var tabLogin = $("tabLogin");
  var tabRegister = $("tabRegister");
  var authSection = $("auth");
  var profileSection = $("profile");
  var profileName = $("profileName");
  var profileEmail = $("profileEmail");
  var profileAvatar = $("profileAvatar");
  var chatSection = $("chat");
  var chatEmbed = $("chatEmbed");
  var chatFallback = $("chatFallback");
  var chatLocked = $("chatLocked");
  var chatUnlockBtn = $("btnChatUnlock");
  var demoLogin = $("demoLogin");
  var btnDemoLogin = $("btnDemoLogin");

  // ---- Демо-сессия (имитация входа, пока не настроен Supabase) ----
  var DEMO_STORAGE_KEY = "cplusagent_demo_user";
  function demoUser() {
    return { id: "demo", email: "demo@cplusagent.local", user_metadata: { full_name: "Демо-пользователь" } };
  }
  function getDemoSession() {
    try {
      if (sessionStorage.getItem(DEMO_STORAGE_KEY) !== "1") return null;
    } catch (e) { return null; }
    return { user: demoUser() };
  }
  function setDemoSession() {
    try { sessionStorage.setItem(DEMO_STORAGE_KEY, "1"); } catch (e) {}
  }
  function clearDemoSession() {
    try { sessionStorage.removeItem(DEMO_STORAGE_KEY); } catch (e) {}
  }

  // ---- Уведомления ----
  function showNotice(text, type) {
    noticeEl.textContent = text;
    noticeEl.className = "notice notice--" + (type || "info");
    noticeEl.hidden = false;
    noticeEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function hideNotice() {
    noticeEl.hidden = true;
    noticeEl.className = "notice";
  }

  // ---- Валидация поля ----
  function validateInput(input) {
    var err = input.parentElement.querySelector(".field__error");
    var valid = true;
    if (input.required && !input.value.trim()) valid = false;
    if (input.type === "email" && input.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) valid = false;
    if (input.type === "password" && input.getAttribute("minlength") && input.value.length < parseInt(input.getAttribute("minlength"), 10)) valid = false;
    input.classList.toggle("is-invalid", !valid);
    if (err) err.classList.toggle("is-visible", !valid);
    return valid;
  }

  function validateForm(form) {
    var inputs = form.querySelectorAll("input");
    var ok = true;
    inputs.forEach(function (input) { if (!validateInput(input)) ok = false; });
    return ok;
  }

  document.addEventListener("input", function (e) {
    if (e.target.matches(".field__input")) validateInput(e.target);
  });

  // ---- Переключение вкладок ----
  function switchTab(which) {
    var isLogin = which === "login";
    tabLogin.classList.toggle("is-active", isLogin);
    tabRegister.classList.toggle("is-active", !isLogin);
    formLogin.hidden = !isLogin;
    formRegister.hidden = isLogin;
    hideNotice();
  }
  tabLogin.addEventListener("click", function () { switchTab("login"); });
  tabRegister.addEventListener("click", function () { switchTab("register"); });

  // Переключение по ссылкам «Войти/Зарегистрироваться»
  document.querySelectorAll("[data-switch]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      switchTab(a.getAttribute("data-switch") === "register" ? "register" : "login");
    });
  });

  // Кнопки в шапке и hero
  $("btnLoginTop").addEventListener("click", function () {
    switchTab("login");
    $("auth").scrollIntoView({ behavior: "smooth" });
  });
  $("btnRegisterTop").addEventListener("click", function () {
    switchTab("register");
    $("auth").scrollIntoView({ behavior: "smooth" });
  });
  document.querySelectorAll("[data-goto]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-goto");
      var el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    });
  });

  // ---- Логин ----
  formLogin.addEventListener("submit", function (e) {
    e.preventDefault();
    hideNotice();
    if (!CONFIGURED) {
      showNotice("Демо-режим: заполните js/config.js данными Supabase, чтобы включить вход по e-mail.", "error");
      return;
    }
    if (!validateForm(formLogin)) return;
    var email = $("loginEmail").value.trim();
    var password = $("loginPassword").value;
    loadSupabase().then(function (client) {
      return client.auth.signInWithPassword({ email: email, password: password });
    }).then(function (res) {
      if (res.error) throw res.error;
      showNotice("Вы вошли в систему. Добро пожаловать!", "success");
    }).catch(function (err) {
      showNotice(friendlyError(err), "error");
    });
  });

  // ---- Регистрация ----
  formRegister.addEventListener("submit", function (e) {
    e.preventDefault();
    hideNotice();
    if (!CONFIGURED) {
      showNotice("Демо-режим: заполните js/config.js данными Supabase, чтобы включить регистрацию по e-mail.", "error");
      return;
    }
    if (!validateForm(formRegister)) return;
    var email = $("regEmail").value.trim();
    var password = $("regPassword").value;
    var name = $("regName").value.trim();
    loadSupabase().then(function (client) {
      return client.auth.signUp({
        email: email,
        password: password,
        options: { data: name ? { full_name: name } : {} }
      });
    }).then(function (res) {
      if (res.error) throw res.error;
      if (res.data.session) {
        showNotice("Аккаунт создан. Добро пожаловать!", "success");
      } else {
        showNotice("Аккаунт создан! Проверьте почту и подтвердите e-mail, затем войдите.", "success");
        switchTab("login");
      }
    }).catch(function (err) {
      showNotice(friendlyError(err), "error");
    });
  });

  // ---- Выход ----
  $("btnLogout").addEventListener("click", function () {
    hideNotice();
    clearDemoSession();
    loadSupabase().then(function (client) {
      return client ? client.auth.signOut() : null;
    }).then(function () {
      applySession(null);
      showNotice("Вы вышли из системы.", "info");
    }).catch(function (err) {
      showNotice(friendlyError(err), "error");
    });
  });

  // ---- Демо-вход (без настроенного Supabase) ----
  function doDemoLogin() {
    setDemoSession();
    applySession(getDemoSession());
    showNotice("Демо-режим: вы вошли без реальной регистрации. Чат открыт.", "success");
    chatSection.scrollIntoView({ behavior: "smooth" });
  }
  if (btnDemoLogin) {
    btnDemoLogin.addEventListener("click", doDemoLogin);
  }

  // Кнопка разблокировки чата: в демо-режиме сразу входим, иначе ведём к форме входа
  if (chatUnlockBtn) {
    chatUnlockBtn.addEventListener("click", function () {
      if (!CONFIGURED) {
        doDemoLogin();
        return;
      }
      switchTab("login");
      authSection.scrollIntoView({ behavior: "smooth" });
    });
  }

  // ---- Управление UI по состоянию авторизации ----
  function applySession(session) {
    var user = session && session.user;
    if (user) {
      authSection.hidden = true;
      profileSection.hidden = false;
      var name = (user.user_metadata && user.user_metadata.full_name) || "";
      profileName.textContent = name || "Пользователь";
      profileEmail.textContent = user.email || "—";
      profileAvatar.textContent = (name ? name.charAt(0) : (user.email ? user.email.charAt(0) : "?")).toUpperCase();
      unlockChat();
    } else {
      profileSection.hidden = true;
      authSection.hidden = false;
      lockChat();
    }
  }

  // ---- Инициализация ----
  function init() {
    if (!CONFIGURED) {
      if (demoLogin) demoLogin.hidden = false;
      showNotice("Демо-режим: чтобы включить регистрацию по e-mail, заполните js/config.js данными Supabase.", "info");
      applySession(getDemoSession());
    }
    loadSupabase().then(function (client) {
      if (!client) return;
      // Восстановление сессии при загрузке
      return client.auth.getSession();
    }).then(function (res) {
      if (res && res.data) applySession(res.data.session);
      if (supabase) {
        supabase.auth.onAuthStateChange(function (_event, session) {
          applySession(session);
        });
      }
    }).catch(function (err) {
      // Клиент не загрузился — оставляем демо-режим
      if (err && err.message) console.warn(err.message);
    });
  }

  // ---- Человеко-понятные ошибки ----
  function friendlyError(err) {
    var msg = (err && err.message) ? err.message : String(err);
    var map = {
      "Invalid login credentials": "Неверный e-mail или пароль.",
      "Email not confirmed": "E-mail не подтверждён. Проверьте почту.",
      "User already registered": "Пользователь с таким e-mail уже зарегистрирован.",
      "Password should be at least 6 characters": "Пароль должен содержать минимум 6 символов."
    };
    for (var key in map) {
      if (msg.indexOf(key) !== -1) return map[key];
    }
    return msg;
  }

  // ---- Встроенный чат (полноэкранный, встраиваемый в страницу) ----
  var CHAT_SCRIPT = "https://s3.twcstorage.ru/8f3135d2-f31a39da-bf84-440b-b768-c0589e415f20/agent-chat-widget.js";
  var CHAT_CONFIG = {
    agentAccessId: "895689ca-80d3-46ec-b694-36c75a60b00f",
    wsUrl: "https://chat.timeweb.cloud",
    name: "C+ Консультант",
    signature: "ИИ Ассистент",
    welcomeMessage: "Добрый день! Задайте мне свой вопрос.",
    primaryColor: "#391e70",
    backgroundColor: "#f8f7f9",
    headerFooterColor: "#ffffff",
    textColor: "#2e2e2e"
  };

  var chatScriptLoading = false;
  var chatScriptReady = false;
  var chatScriptCallbacks = [];

  function loadChatScript(cb) {
    if (chatScriptReady || (window.customElements && window.customElements.get("agent-chat-widget"))) {
      chatScriptReady = true;
      cb();
      return;
    }
    chatScriptCallbacks.push(cb);
    if (chatScriptLoading) return;
    chatScriptLoading = true;
    var s = document.createElement("script");
    s.src = CHAT_SCRIPT;
    s.async = true;
    s.onload = function () {
      chatScriptLoading = false;
      chatScriptReady = true;
      var cbs = chatScriptCallbacks.splice(0);
      cbs.forEach(function (f) { f(); });
    };
    s.onerror = function () {
      chatScriptLoading = false;
      chatScriptCallbacks = [];
      var fb = $("chatFallback");
      if (fb) fb.hidden = false;
    };
    document.head.appendChild(s);
  }

  function embedChatStyle(w) {
    var style = document.createElement("style");
    style.textContent = [
      ".agent-chat-widget,",
      ".agent-chat-widget.is-open {",
      "  display: block !important;",
      "  position: relative !important;",
      "  top: auto !important; left: auto !important; right: auto !important; bottom: auto !important;",
      "  width: 100% !important;",
      "  height: 560px !important;",
      "  max-width: none !important;",
      "  border-radius: 10px !important;",
      "  box-shadow: 0 2px 12px rgba(57, 30, 112, 0.10) !important;",
      "  z-index: auto !important;",
      "  --widget-border-color: #e2e0ea;",
      "}",
      ".agent-chat-widget .chat-container { height: 100% !important; }",
      "@media (max-width: 560px) {",
      "  .agent-chat-widget,",
      "  .agent-chat-widget.is-open { height: 480px !important; }",
      "}",
      ".agent-chat-widget .resizer,",
      ".agent-chat-widget .resize-handle,",
      ".agent-chat-widget .fullscreen-btn,",
      ".agent-chat-widget .close-btn { display: none !important; }"
    ].join("\n");
    w.shadowRoot.appendChild(style);
  }

  // ---- Встроенный чат (создаётся только после входа) ----
  var widget = null;

  function createChatWidget() {
    if (widget) return;
    loadChatScript(function () {
      // Убираем placeholder, если он был показан при ошибке ранее
      if (chatFallback) chatFallback.hidden = true;
      if (widget) return;
      var w = document.createElement("agent-chat-widget");
      w.setAttribute("data-agent-access-id", CHAT_CONFIG.agentAccessId);
      w.setAttribute("data-wsurl", CHAT_CONFIG.wsUrl);
      w.setAttribute("data-open", "true");
      w.setAttribute("data-show-button", "false");
      w.setAttribute("data-name", CHAT_CONFIG.name);
      w.setAttribute("data-signature", CHAT_CONFIG.signature);
      w.setAttribute("data-welcome-message", CHAT_CONFIG.welcomeMessage);
      w.setAttribute("data-primary-color", CHAT_CONFIG.primaryColor);
      w.setAttribute("data-background-color", CHAT_CONFIG.backgroundColor);
      w.setAttribute("data-header-footer-color", CHAT_CONFIG.headerFooterColor);
      w.setAttribute("data-text-color", CHAT_CONFIG.textColor);
      w.setAttribute("data-chat-position", "bottom_right");
      chatEmbed.appendChild(w);

      // Ждём создания shadow root, затем встраиваем виджет инлайн в карточку
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        if (w.shadowRoot) {
          clearInterval(timer);
          embedChatStyle(w);
          if (typeof w.show === "function") w.show();
        } else if (tries > 80) {
          clearInterval(timer);
        }
      }, 100);
      widget = w;
    });
  }

  function unlockChat() {
    chatLocked.hidden = true;
    chatEmbed.hidden = false;
    if (!widget) createChatWidget();
  }

  function lockChat() {
    chatEmbed.hidden = true;
    chatLocked.hidden = false;
    if (widget) {
      widget.remove();
      widget = null;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
