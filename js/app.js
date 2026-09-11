/* ===== C+ Агент — логика страниц =====
 * Файл один на весь сайт: нужный обработчик выбирается по атрибуту
 * data-page у <body>. Общая часть (сессия, шапка, вход/выход) — в js/auth.js.
 */
(function (window, document) {
  "use strict";

  var A = window.CPlusAuth;
  if (!A) return;

  var PAGE = document.body.getAttribute("data-page") || "";

  function $(id) { return document.getElementById(id); }

  function go(url) { window.location.replace(url); }

  // Куда вернуть пользователя после входа: только внутренние страницы сайта
  function nextTarget() {
    var next = new URLSearchParams(window.location.search).get("next") || "";
    return /^[a-z0-9-]+\.html$/i.test(next) ? next : "chat.html";
  }

  // Блокировка кнопки отправки на время запроса
  function setBusy(form, busy) {
    var btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    if (busy) {
      btn.setAttribute("data-label-cache", btn.textContent);
      btn.textContent = "Подождите…";
    } else if (btn.getAttribute("data-label-cache")) {
      btn.textContent = btn.getAttribute("data-label-cache");
    }
    btn.disabled = busy;
  }

  function warnNotConfigured(action) {
    A.showNotice("Демо-режим: заполните js/config.js данными Supabase, чтобы включить " + action + ".", "error");
  }

  /* ---------- Главная ---------- */
  function initHome() {
    A.onChange(function (session) {
      var user = session && session.user;
      var welcome = $("welcomeCard");
      var heroPrimary = $("heroPrimary");
      var heroSecondary = $("heroSecondary");
      var guestCta = $("guestCta");

      if (welcome) {
        welcome.hidden = !user;
        if (user) {
          var meta = user.user_metadata || {};
          var name = meta.full_name || meta.name || "";
          $("welcomeName").textContent = name || "Пользователь";
          $("welcomeEmail").textContent = user.email || "—";
          $("welcomeAvatar").textContent = (name || user.email || "?").charAt(0).toUpperCase();
        }
      }

      if (heroPrimary) {
        heroPrimary.textContent = user ? "Перейти к консультации" : "Создать аккаунт";
        heroPrimary.setAttribute("href", user ? "chat.html" : "register.html");
      }
      if (heroSecondary) heroSecondary.hidden = !!user;
      // Призыв «Зарегистрироваться / Войти» не нужен тому, кто уже вошёл
      if (guestCta) guestCta.hidden = !!user;
    });

    A.init().then(A.reveal);
  }

  /* ---------- Вход ---------- */
  function initLogin() {
    var form = $("formLogin");
    var demoBlock = $("demoLogin");
    if (demoBlock) demoBlock.hidden = !A.demo.available;

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        A.hideNotice();
        if (!A.configured) { warnNotConfigured("вход по e-mail"); return; }
        if (!A.validateForm(form)) return;

        var email = $("loginEmail").value.trim();
        var password = $("loginPassword").value;
        setBusy(form, true);
        A.signIn(email, password).then(function (res) {
          if (res && res.error) throw res.error;
          A.showNotice("Вы вошли в систему. Открываем консультацию…", "success");
          window.setTimeout(function () { go(nextTarget()); }, 600);
        }).catch(function (err) {
          A.showNotice(A.friendlyError(err), "error");
          setBusy(form, false);
        });
      });
    }

    var demoBtn = $("btnDemoLogin");
    if (demoBtn) {
      demoBtn.addEventListener("click", function () {
        A.demo.signIn();
        A.showNotice("Демо-режим: вход без реальной регистрации. Чат открыт.", "success");
        window.setTimeout(function () { go(nextTarget()); }, 600);
      });
    }

    // Уже авторизован — формы входа на странице быть не должно
    A.init().then(function (session) {
      if (session) { go(nextTarget()); return; }
      A.reveal();
    });
  }

  /* ---------- Регистрация ---------- */
  function initRegister() {
    var form = $("formRegister");

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        A.hideNotice();
        if (!A.configured) { warnNotConfigured("регистрацию по e-mail"); return; }
        if (!A.validateForm(form)) return;

        var name = $("regName").value.trim();
        var email = $("regEmail").value.trim();
        var password = $("regPassword").value;
        setBusy(form, true);

        A.signUp(email, password, name).then(function (res) {
          if (res && res.error) throw res.error;

          // Если подтверждение e-mail отключено, сессия выдаётся сразу
          if (res.data && res.data.session) {
            A.showNotice("Аккаунт создан. Добро пожаловать!", "success");
            window.setTimeout(function () { go("chat.html"); }, 600);
            return;
          }

          form.hidden = true;
          var done = $("registerDone");
          if (done) done.hidden = false;
          var echo = $("registerEmailEcho");
          if (echo) echo.textContent = email;
          A.showNotice("Аккаунт создан! Проверьте почту и подтвердите e-mail.", "success");
        }).catch(function (err) {
          A.showNotice(A.friendlyError(err), "error");
        }).then(function () {
          setBusy(form, false);
        });
      });
    }

    A.init().then(function (session) {
      if (session) { go("chat.html"); return; }
      A.reveal();
    });
  }

  /* ---------- Восстановление пароля: запрос письма ---------- */
  function initForgot() {
    var form = $("formForgot");

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        A.hideNotice();
        if (!A.configured) { warnNotConfigured("восстановление пароля"); return; }
        if (!A.validateForm(form)) return;

        var email = $("forgotEmail").value.trim();
        setBusy(form, true);

        A.sendPasswordReset(email).then(function (res) {
          if (res && res.error) throw res.error;
          form.hidden = true;
          var done = $("forgotDone");
          if (done) done.hidden = false;
          var echo = $("forgotEmailEcho");
          if (echo) echo.textContent = email;
          A.showNotice("Письмо для восстановления пароля отправлено на " + email + ".", "success");
        }).catch(function (err) {
          A.showNotice(A.friendlyError(err), "error");
        }).then(function () {
          setBusy(form, false);
        });
      });
    }

    A.init().then(A.reveal);
  }

  /* ---------- Восстановление пароля: новый пароль ---------- */
  function readUrlError() {
    var raw = (window.location.hash || "").replace(/^#/, "") + "&" +
              (window.location.search || "").replace(/^\?/, "");
    var params = new URLSearchParams(raw);
    var desc = params.get("error_description") || params.get("error") || "";
    if (!desc) return "";
    if (/expired|invalid/i.test(desc)) {
      return "Ссылка для восстановления недействительна или устарела. Запросите новую.";
    }
    return desc;
  }

  function clearUrlTokens() {
    if (window.location.hash || window.location.search.indexOf("code=") !== -1) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  function initReset() {
    var form = $("formReset");
    var checking = $("resetChecking");
    var invalid = $("resetInvalid");

    function showForm() {
      if (checking) checking.hidden = true;
      if (invalid) invalid.hidden = true;
      if (form) form.hidden = false;
      clearUrlTokens();
      A.reveal();
    }

    function showInvalid(reason) {
      if (checking) checking.hidden = true;
      if (form) form.hidden = true;
      if (invalid) invalid.hidden = false;
      var text = $("resetInvalidText");
      if (text && reason) text.textContent = reason;
      clearUrlTokens();
      A.reveal();
    }

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        A.hideNotice();

        var pass = $("resetPassword");
        var pass2 = $("resetPassword2");
        var confirmError = $("resetPassword2Error");
        if (confirmError) confirmError.classList.remove("is-visible");

        if (!A.validateForm(form)) return;
        if (pass.value !== pass2.value) {
          pass2.classList.add("is-invalid");
          if (confirmError) confirmError.classList.add("is-visible");
          A.showNotice("Пароли не совпадают.", "error");
          return;
        }
        pass2.classList.remove("is-invalid");

        setBusy(form, true);
        A.updatePassword(pass.value).then(function (res) {
          if (res && res.error) throw res.error;
          A.showNotice("Пароль обновлён. Открываем консультацию…", "success");
          window.setTimeout(function () { go("chat.html"); }, 900);
        }).catch(function (err) {
          A.showNotice(A.friendlyError(err), "error");
          setBusy(form, false);
        });
      });
    }

    if (!A.configured) {
      showInvalid("Демо-режим: восстановление пароля работает после настройки Supabase в js/config.js.");
      return;
    }

    // Ссылка из письма авторизует пользователя: ждём появления сессии
    var settled = false;
    A.onChange(function (session) {
      if (session && !settled) { settled = true; showForm(); }
    });

    var urlError = readUrlError();

    A.init().then(function (session) {
      if (session) { settled = true; showForm(); return; }
      if (urlError) { showInvalid(urlError); return; }
      // supabase-js разбирает токены из адреса асинхронно — даём ему время
      window.setTimeout(function () {
        if (settled) return;
        A.client().then(function (c) {
          return c ? c.auth.getSession() : null;
        }).then(function (res) {
          if (settled) return;
          var found = res && res.data ? res.data.session : null;
          if (found) { settled = true; showForm(); }
          else showInvalid("Ссылка для восстановления недействительна или устарела. Запросите новую.");
        }).catch(function () {
          showInvalid("Не удалось проверить ссылку. Откройте её ещё раз или запросите новую.");
        });
      }, 1500);
    });
  }

  /* ---------- Консультация ---------- */
  function initChat() {
    // Виджет чата монтируется в js/chat.js по тому же событию изменения сессии
    A.init().then(A.reveal);
  }

  var PAGES = {
    home: initHome,
    login: initLogin,
    register: initRegister,
    forgot: initForgot,
    reset: initReset,
    chat: initChat
  };

  function start() {
    var initPage = PAGES[PAGE];
    if (initPage) initPage();
    else A.init().then(A.reveal);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(window, document);
