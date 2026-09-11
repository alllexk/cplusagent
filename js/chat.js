/* ===== C+ Агент — встроенный полноэкранный чат =====
 * Скрипт виджета Timeweb Cloud загружается ровно один раз (без дублей
 * custom element), виджет создаётся только при активной сессии и
 * удаляется при выходе из аккаунта.
 */
(function (window, document) {
  "use strict";

  var A = window.CPlusAuth;
  if (!A) return;

  var embed = document.getElementById("chatEmbed");
  var locked = document.getElementById("chatLocked");
  var fallback = document.getElementById("chatFallback");
  if (!embed || !locked) return;

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

  var widget = null;
  var scriptLoading = false;
  var scriptReady = false;
  var scriptCallbacks = [];

  function loadChatScript(cb) {
    if (scriptReady || (window.customElements && window.customElements.get("agent-chat-widget"))) {
      scriptReady = true;
      cb();
      return;
    }
    scriptCallbacks.push(cb);
    if (scriptLoading) return;
    scriptLoading = true;
    var s = document.createElement("script");
    s.src = CHAT_SCRIPT;
    s.async = true;
    s.onload = function () {
      scriptLoading = false;
      scriptReady = true;
      scriptCallbacks.splice(0).forEach(function (f) { f(); });
    };
    s.onerror = function () {
      scriptLoading = false;
      scriptCallbacks = [];
      if (fallback) fallback.hidden = false;
    };
    document.head.appendChild(s);
  }

  // Виджет по умолчанию плавающий — разворачиваем его внутри карточки страницы
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

  function mountWidget() {
    if (widget) return;
    loadChatScript(function () {
      if (widget) return;
      if (fallback) fallback.hidden = true;
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
      embed.appendChild(w);

      // Ждём создания shadow root, затем встраиваем виджет инлайн в карточку
      var tries = 0;
      var timer = window.setInterval(function () {
        tries++;
        if (w.shadowRoot) {
          window.clearInterval(timer);
          embedChatStyle(w);
          if (typeof w.show === "function") w.show();
        } else if (tries > 80) {
          window.clearInterval(timer);
        }
      }, 100);

      widget = w;
    });
  }

  function unmountWidget() {
    if (!widget) return;
    widget.remove();
    widget = null;
  }

  function applySession(session) {
    if (session) {
      locked.hidden = true;
      embed.hidden = false;
      mountWidget();
    } else {
      embed.hidden = true;
      locked.hidden = false;
      unmountWidget();
    }
  }

  A.onChange(applySession);
})(window, document);
