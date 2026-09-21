/* ===== C+ Агент — голосовой чат с ИИ-агентом Timeweb Cloud =====
 * Вопрос задаётся голосом (Web Speech API) или текстом, ответ агента
 * озвучивается через speechSynthesis, а его текст открывается в чате
 * только после того, как соответствующая фраза прочитана вслух.
 * Запросы уходят напрямую в OpenAI-совместимый API агента
 * (https://agent.timeweb.cloud/api/v1/cloud-ai/agents/<id>/v1).
 */
(function (window, document) {
  "use strict";

  var A = window.CPlusAuth;
  if (!A) return;

  var embed = document.getElementById("chatEmbed");
  var locked = document.getElementById("chatLocked");
  if (!embed || !locked) return;

  /* ---------- Константы ---------- */
  var AGENT_ID = "895689ca-80d3-46ec-b694-36c75a60b00f";
  var API_URL =
    "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/" +
    encodeURIComponent(AGENT_ID) +
    "/v1/chat/completions";

  var TOKEN_KEY = "cplusagent_agent_token";
  var DIALOG_KEY = "cplusagent_voice_dialog";
  var SPEECH_LANG = "ru-RU";
  var HISTORY_LIMIT = 20; // сколько последних сообщений диалога отправляем агенту
  var MAX_PHRASE = 300; // предел длины одной озвучиваемой фразы
  var TTS_START_TIMEOUT = 3000; // сколько ждать старта озвучки, прежде чем счесть её недоступной

  var SR_MESSAGES = {
    "not-allowed": "Нет доступа к микрофону. Разрешите его в настройках браузера и попробуйте снова.",
    "service-not-allowed": "Браузер запретил распознавание речи. Разрешите доступ к микрофону для этого сайта.",
    "audio-capture": "Микрофон не найден. Проверьте, что он подключён и доступен системе.",
    "no-speech": "Речь не распознана — попробуйте сказать ещё раз.",
    network: "Сервис распознавания речи недоступен. Проверьте подключение к интернету.",
    aborted: ""
  };

  /* ---------- Элементы ---------- */
  var root = document.getElementById("vchat");
  var log = document.getElementById("vchatLog");
  var hint = document.getElementById("vchatHint");
  var form = document.getElementById("vchatComposer");
  var input = document.getElementById("vchatInput");
  var sendBtn = document.getElementById("vchatSend");
  var micBtn = document.getElementById("vchatMic");
  var stopBtn = document.getElementById("vchatStop");
  var newBtn = document.getElementById("vchatNew");
  var tokenBtn = document.getElementById("vchatTokenBtn");
  var tokenForm = document.getElementById("vchatTokenForm");
  var tokenInput = document.getElementById("vchatTokenInput");
  var tokenClear = document.getElementById("vchatTokenClear");
  var tokenMsg = document.getElementById("vchatTokenMsg");
  var statusText = document.getElementById("vchatStatusText");
  var note = document.getElementById("vchatNote");

  if (!root || !log || !form || !input) return;

  /* ---------- Состояние ---------- */
  var token = "";
  var dialog = []; // [{ role: "user" | "assistant", content: string }]
  var mounted = false;

  var streaming = false;
  var controller = null;
  var activeBubble = null;

  var queue = []; // фразы, ожидающие озвучки: [{ bubble, text, revealed }]
  var currentItem = null;
  var speaking = false;
  var cancelCount = 0;

  var listening = false;
  var ttsWarned = false;

  /* ---------- Утилиты ---------- */
  function storageArea() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function lsGet(key) {
    var area = storageArea();
    try {
      return area ? area.getItem(key) || "" : "";
    } catch (e) {
      return "";
    }
  }

  function lsSet(key, value) {
    var area = storageArea();
    try {
      if (!area) return;
      if (value) area.setItem(key, value);
      else area.removeItem(key);
    } catch (e) {
      /* приватный режим — просто не сохраняем */
    }
  }

  function normalizeToken(value) {
    return (value || "").trim().replace(/^Bearer\s+/i, "");
  }

  function setNote(text) {
    if (!note) return;
    note.textContent = text || "";
    note.hidden = !text;
  }

  function scrollLog() {
    log.scrollTop = log.scrollHeight;
  }

  function showHint() {
    if (hint) hint.hidden = false;
  }

  function hideHint() {
    if (hint) hint.hidden = true;
  }

  /* ---------- Озвучка (TTS) ---------- */
  var ttsSupported =
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined";
  var ruVoice = null;

  function pickVoice() {
    if (!ttsSupported) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    var fallback = null;
    for (var i = 0; i < voices.length; i++) {
      var voice = voices[i];
      if ((voice.lang || "").toLowerCase().indexOf("ru") !== 0) continue;
      if (!fallback) fallback = voice;
      if (/google|natural|premium|enhanced|online/i.test(voice.name || "")) return voice;
    }
    return fallback;
  }

  if (ttsSupported) {
    ruVoice = pickVoice();
    // Список голосов в Chrome подгружается асинхронно
    window.speechSynthesis.onvoiceschanged = function () {
      ruVoice = pickVoice();
    };
  }

  // Убирает markdown-разметку: голос не должен читать «звёздочки» и «решётки»
  function speakable(text) {
    return text
      .replace(/```([\s\S]*?)```/g, " $1 ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s*/gm, "")
      .replace(/^\s*[-–—•*]\s+/gm, "")
      .replace(/[*_>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Читает фразу вслух и завершается, когда фраза действительно прочитана.
   * Результат: "spoken" — прочитано, "unavailable" — браузер не смог озвучить.
   */
  function speak(text) {
    return new Promise(function (resolve) {
      var phrase = speakable(text);
      if (!ttsSupported || !phrase) {
        resolve("unavailable");
        return;
      }

      var utterance = new window.SpeechSynthesisUtterance(phrase);
      utterance.lang = SPEECH_LANG;
      if (ruVoice) utterance.voice = ruVoice;

      var started = false;
      var settled = false;
      var guard = null;

      function finish(result) {
        if (settled) return;
        settled = true;
        if (guard) window.clearTimeout(guard);
        resolve(result);
      }

      guard = window.setTimeout(function () {
        // Синтез так и не начался — считаем, что озвучка в браузере недоступна,
        // иначе текст ответа остался бы скрытым навсегда.
        if (!started) finish("unavailable");
      }, TTS_START_TIMEOUT);

      utterance.onstart = function () {
        started = true;
        if (guard) window.clearTimeout(guard);
      };
      utterance.onend = function () {
        finish("spoken");
      };
      utterance.onerror = function () {
        finish(started ? "spoken" : "unavailable");
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  /* ---------- Разбиение потока на фразы ---------- */
  /**
   * Выделяет из накопленного текста законченные фразы.
   * Возвращает { phrases: [...], rest: "незаконченный хвост" }.
   */
  function takeSentences(buffer, isFinal) {
    var phrases = [];
    var start = 0;
    var i = 0;

    while (i < buffer.length) {
      var ch = buffer.charAt(i);
      var isBreak =
        ch === "." || ch === "!" || ch === "?" || ch === "\u2026" || ch === "\n";
      if (!isBreak) {
        i++;
        continue;
      }

      var end = i + 1;
      while (end < buffer.length && ".!?\u2026".indexOf(buffer.charAt(end)) !== -1) end++;

      if (ch !== "\n") {
        // Последний символ буфера: продолжение потока может уточнить предложение
        if (end >= buffer.length && !isFinal) break;
        var next = buffer.charAt(end);
        // "3.5", "example.com" — точка внутри слова, а не конец предложения
        if (next && !/\s/.test(next)) {
          i = end;
          continue;
        }
      }

      var phrase = buffer.slice(start, end).trim();
      if (!phrase) {
        start = end;
        i = end;
        continue;
      }
      // Короткий обрывок («т.», «др.») — ждём продолжения потока
      if (!isFinal && phrase.length < 3) break;

      // Перевод строки — граница блока (строка списка, строка таблицы, абзац):
      // помечаем фразу, чтобы в чате сохранилась разметка строк
      var blockEnd = ch === "\n" ? 1 : 0;
      while (end < buffer.length && /\s/.test(buffer.charAt(end))) {
        if (buffer.charAt(end) === "\n" && blockEnd < 2) blockEnd++;
        end++;
      }
      phrases.push(blockEnd ? phrase + (blockEnd > 1 ? "\n\n" : "\n") : phrase);
      start = end;
      i = end;
    }

    var rest = buffer.slice(start);
    if (isFinal) {
      var tail = rest.trim();
      if (tail) phrases.push(tail);
      rest = "";
    }
    return { phrases: phrases, rest: rest };
  }

  // Длинную фразу без точек делим на части, чтобы озвучка начиналась раньше
  function splitLong(text) {
    if (text.length <= MAX_PHRASE) return [text];
    var tail = /\n+$/.exec(text);
    var blockEnd = tail ? Math.min(2, tail[0].length) : 0;
    var parts = [];
    var rest = blockEnd ? text.slice(0, -blockEnd) : text;
    while (rest.length > MAX_PHRASE) {
      var cut = -1;
      for (var i = MAX_PHRASE; i > MAX_PHRASE / 2; i--) {
        var ch = rest.charAt(i);
        if (ch === " " || ch === "," || ch === ";" || ch === ":" || ch === "\u2014" || ch === "-") {
          cut = i;
          break;
        }
      }
      if (cut < 0) cut = MAX_PHRASE;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    parts = parts.filter(function (part) {
      return !!part;
    });
    if (blockEnd && parts.length) parts[parts.length - 1] += blockEnd > 1 ? "\n\n" : "\n";
    return parts;
  }

  function expandPhrases(phrases) {
    var out = [];
    for (var i = 0; i < phrases.length; i++) {
      out = out.concat(splitLong(phrases[i]));
    }
    return out.filter(function (part) {
      return !!part;
    });
  }

  // Markdown-разметка агента — в читаемый текст: маркеры не должны попадать в чат
  function toPlain(text, isFinal) {
    var tail = /\n+$/.exec(text || "");
    var blockEnd = tail ? Math.min(2, tail[0].length) : 0;
    var out = (text || "").replace(/\n+$/, "");
    out = out
      .replace(/```[a-zA-Z0-9+-]*[ \t]*/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__/g, "")
      .replace(/^\s{0,3}#{1,6}[ \t]*/gm, "")
      .replace(/^\s*>[ \t]*/gm, "")
      .replace(/^\s*[-+*]\s+/gm, "\u2022 ");
    // Таблицы: строки-разделители убираем, столбцы разделяем тире
    out = out.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, "");
    out = out.replace(/[ \t]*\|[ \t]*/g, " \u2014 ");
    out = out.replace(/(\s*\u2014\s*)+/g, " \u2014 ");
    out = out.replace(/^[ \t]*\u2014[ \t]*/gm, "").replace(/[ \t]*\u2014[ \t]*$/gm, "");
    out = out.replace(/(^|[\s(])[*_](\S(?:[^*_]*?\S)?)[*_](?=[\s).,!?;:]|$)/g, "$1$2");
    out = out.replace(/[ \t\u00a0]{2,}/g, " ").trim();
    if (isFinal) out = out.trim();
    if (!out || !blockEnd) return out;
    return out + (blockEnd > 1 ? "\n\n" : "\n");
  }

  // Дельты приходят с произвольными пробелами — приводим текст к читаемому виду
  function normalizeAnswer(text) {
    return (text || "")
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
  }

  /* ---------- Сообщения в чате ---------- */
  function addUserBubble(text) {
    var wrap = document.createElement("div");
    wrap.className = "msg msg--user";

    var avatar = document.createElement("span");
    avatar.className = "msg__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "Вы";

    var body = document.createElement("div");
    body.className = "msg__body";
    var textEl = document.createElement("div");
    textEl.className = "msg__text";
    textEl.textContent = text;

    body.appendChild(textEl);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    log.appendChild(wrap);
    scrollLog();
  }

  // Пузырь ответа появляется сразу, но текст в нём раскрывается по мере озвучки
  function addAgentBubble() {
    var wrap = document.createElement("div");
    wrap.className = "msg msg--agent";

    var avatar = document.createElement("span");
    avatar.className = "msg__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "C+";

    var body = document.createElement("div");
    body.className = "msg__body";
    var textEl = document.createElement("div");
    textEl.className = "msg__text";
    var gate = document.createElement("div");
    gate.className = "msg__gate";
    gate.textContent = "Агент печатает ответ\u2026";

    body.appendChild(textEl);
    body.appendChild(gate);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    log.appendChild(wrap);
    scrollLog();

    return { wrap: wrap, text: textEl, gate: gate, shown: "", pending: 0, done: false };
  }

  function addSystemBubble(text) {
    var wrap = document.createElement("div");
    wrap.className = "msg msg--system";
    var body = document.createElement("div");
    body.className = "msg__body";
    body.textContent = text;
    wrap.appendChild(body);
    log.appendChild(wrap);
    scrollLog();
  }

  function removeBubble(bubble) {
    if (bubble && bubble.wrap.parentNode) bubble.wrap.parentNode.removeChild(bubble.wrap);
  }

  function updateGate(bubble) {
    if (!bubble || !bubble.gate) return;
    if (!bubble.done) {
      bubble.gate.hidden = false;
      bubble.gate.textContent =
        bubble.pending > 0
          ? "\uD83D\uDD0A Читаю вслух — текст появляется после прочтения"
          : "Агент печатает ответ\u2026";
      return;
    }
    if (bubble.pending > 0) {
      bubble.gate.hidden = false;
      bubble.gate.textContent = "\uD83D\uDD0A Читаю вслух — текст появляется после прочтения";
      return;
    }
    bubble.gate.hidden = true;
  }

  /* ---------- Очередь озвучки ---------- */
  function busy() {
    return streaming || speaking || queue.length > 0;
  }

  function refreshStatus() {
    var text = "Готов к диалогу";
    if (!token) text = "Нужен API-токен агента";
    else if (listening) text = "Слушаю вопрос\u2026";
    else if (speaking || queue.length) text = "Читаю ответ вслух\u2026";
    else if (streaming) text = "Агент печатает ответ\u2026";

    if (statusText) statusText.textContent = text;
    var isBusy = busy();
    root.classList.toggle("is-busy", isBusy);
    if (stopBtn) stopBtn.hidden = !isBusy;
    if (sendBtn) sendBtn.disabled = isBusy;
    if (micBtn) micBtn.disabled = isBusy || !micSupported;
  }

  function enqueue(bubble, phrases) {
    var expanded = expandPhrases(phrases);
    for (var i = 0; i < expanded.length; i++) {
      // Разметку убираем сразу: и озвучка, и раскрытый текст — уже plain text
      var text = toPlain(expanded[i], false);
      if (!text) continue;
      bubble.pending++;
      queue.push({ bubble: bubble, text: text, revealed: false });
    }
    updateGate(bubble);
    pump();
  }

  function revealPhrase(item) {
    if (!item || item.revealed) return;
    item.revealed = true;
    var bubble = item.bubble;
    if (bubble) {
      var sep = !bubble.shown || /\n$/.test(bubble.shown) ? "" : " ";
      bubble.shown = (bubble.shown || "") + sep + item.text;
      bubble.text.textContent = bubble.shown;
      bubble.pending = Math.max(0, bubble.pending - 1);
      updateGate(bubble);
    }
    scrollLog();
  }

  function pump() {
    if (speaking || !queue.length) {
      refreshStatus();
      return;
    }

    var item = queue.shift();
    var generation = cancelCount;
    var bubble = item.bubble;

    currentItem = item;
    speaking = true;
    if (bubble) bubble.wrap.classList.add("is-speaking");
    refreshStatus();

    speak(item.text)
      .then(function (result) {
        if (generation !== cancelCount) return; // озвучку остановили вручную
        if (result === "unavailable" && !ttsWarned) {
          ttsWarned = true;
          addSystemBubble(
            "Браузер не может озвучить ответ — текст раскрыт без прочтения вслух. " +
              "Проверьте голосовые движки в настройках системы."
          );
        }
        revealPhrase(item);
      })
      .then(function () {
        if (generation === cancelCount) {
          speaking = false;
          currentItem = null;
          if (bubble) bubble.wrap.classList.remove("is-speaking");
        }
        pump();
      });
  }

  // Немедленно раскрывает всё, что уже получено, но ещё не прочитано
  function stopSpeech() {
    cancelCount++;
    var pending = [];
    if (currentItem) pending.push(currentItem);
    pending = pending.concat(queue);
    queue = [];
    currentItem = null;
    speaking = false;

    if (ttsSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        /* ignore */
      }
    }

    if (activeBubble) activeBubble.wrap.classList.remove("is-speaking");
    for (var i = 0; i < pending.length; i++) revealPhrase(pending[i]);
    return pending.length;
  }

  /* ---------- Обращение к агенту ---------- */
  function errorText(status, data, raw) {
    var detail = null;
    if (data && data.error) detail = data.error.message || data.error;
    else if (data && data.message) detail = data.message;
    else if (typeof data === "string") detail = data;
    else if (raw) detail = raw.slice(0, 200);
    if (detail && typeof detail === "object") detail = JSON.stringify(detail);

    if (status === 401 || status === 403) {
      return "Агент отклонил запрос: неверный или просроченный API-токен.";
    }
    return detail ? "Ошибка API агента: " + detail : "Ошибка API агента (HTTP " + status + ").";
  }

  // Ошибка внутри потока приходит в 200-ответе кадром {"error":{...}}
  function apiError(info) {
    var status = 0;
    var type = (info && info.type) || "";
    var message = (info && (info.message || info)) || "";
    if (type === "authentication_error" || /unauthor/i.test(String(message))) status = 401;
    var err = new Error(errorText(status, { error: info }, null));
    err.status = status;
    return err;
  }

  function agentErrorText(err) {
    if (!err) return "Не удалось получить ответ агента.";
    if (!err.status && err.message && !/^Ошибка API агента/.test(err.message)) {
      return "Не удалось связаться с API агента: " + err.message + ". Проверьте подключение к интернету.";
    }
    return err.message || "Не удалось получить ответ агента.";
  }

  function readStream(body, onDelta) {
    var reader = body.getReader();
    var decoder = new window.TextDecoder();
    var buffer = "";
    var full = "";

    function handleLine(line) {
      var trimmed = line.trim();
      if (!trimmed || trimmed.indexOf("data:") !== 0) return null;
      var payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return "done";
      var json = null;
      try {
        json = JSON.parse(payload);
      } catch (e) {
        return null; // неполная строка — разберём на следующей итерации
      }
      if (json && json.error) throw apiError(json.error);
      var choice = json && json.choices && json.choices[0];
      var delta = choice && choice.delta && choice.delta.content;
      if (delta) {
        full += delta;
        onDelta(delta);
      }
      return null;
    }

    function step() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          handleLine(buffer);
          return full;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (handleLine(lines[i]) === "done") return full;
        }
        return step();
      });
    }

    return step();
  }

  function requestStream(messages, onDelta, signal) {
    var headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;

    return window
      .fetch(API_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ messages: messages, stream: true }),
        signal: signal
      })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (raw) {
            var data = null;
            try {
              data = raw ? JSON.parse(raw) : null;
            } catch (e) {
              data = null;
            }
            var err = new Error(errorText(res.status, data, raw));
            err.status = res.status;
            throw err;
          });
        }
        if (!res.body || !res.body.getReader) {
          throw new Error("Браузер не поддерживает потоковый ответ от API.");
        }
        return readStream(res.body, onDelta);
      });
  }

  function startRequest() {
    var bubble = addAgentBubble();
    activeBubble = bubble;
    streaming = true;
    controller = typeof window.AbortController !== "undefined" ? new window.AbortController() : null;
    refreshStatus();

    var buffered = "";

    requestStream(
      dialog.slice(-HISTORY_LIMIT),
      function (delta) {
        buffered += delta;
        var parsed = takeSentences(buffered, false);
        buffered = parsed.rest;
        if (parsed.phrases.length) enqueue(bubble, parsed.phrases);
      },
      controller ? controller.signal : undefined
    )
      .then(function (full) {
        streaming = false;
        if (activeBubble === bubble) activeBubble = null;
        var parsed = takeSentences(buffered, true);
        if (parsed.phrases.length) enqueue(bubble, parsed.phrases);
        bubble.done = true;
        updateGate(bubble);

        var answer = normalizeAnswer(full && full.trim() ? full : bubble.shown);
        if (!answer) {
          removeBubble(bubble);
          addSystemBubble("Агент вернул пустой ответ. Попробуйте переформулировать вопрос.");
        } else {
          dialog.push({ role: "assistant", content: answer });
          saveDialog();
        }
        refreshStatus();
      })
      .catch(function (err) {
        var aborted = err && err.name === "AbortError";
        streaming = false;
        if (activeBubble === bubble) activeBubble = null;
        bubble.done = true;

        if (aborted) {
          // Запрос прервали: озвученный фрагмент уже мог быть раскрыт — сохраняем его в историю
          updateGate(bubble);
          if (bubble.shown) dialog.push({ role: "assistant", content: normalizeAnswer(bubble.shown) });
          saveDialog();
          refreshStatus();
          return;
        }

        if (!bubble.shown) {
          removeBubble(bubble);
        } else {
          updateGate(bubble);
        }
        addSystemBubble(agentErrorText(err));
        if (err && (err.status === 401 || err.status === 403)) {
          openTokenForm(true);
          setTokenMessage("Проверьте API-токен: агент отклонил запрос.", true);
        }
        refreshStatus();
      });
  }

  function send(rawText) {
    var text = (rawText || "").trim();
    if (!text) return false;
    if (busy()) {
      setNote("Дождитесь окончания ответа или нажмите «Остановить и показать текст».");
      return false;
    }
    if (!token) {
      openTokenForm(true);
      setTokenMessage("Введите API-токен агента, чтобы задать вопрос.", true);
      setNote("Без API-токена агент не сможет ответить.");
      refreshStatus();
      return false;
    }

    hideHint();
    addUserBubble(text);
    dialog.push({ role: "user", content: text });
    saveDialog();
    input.value = "";
    setNote("");
    startRequest();
    return true;
  }

  // Полная остановка: запрос, озвучка и раскрытие всего полученного текста
  function stopAll(notice) {
    if (controller) {
      try {
        controller.abort();
      } catch (e) {
        /* ignore */
      }
      controller = null;
    }
    streaming = false;
    stopSpeech();

    if (activeBubble) {
      activeBubble.done = true;
      updateGate(activeBubble);
      activeBubble = null;
    }
    if (notice) addSystemBubble(notice);
    refreshStatus();
  }

  /* ---------- Диалог ---------- */
  function saveDialog() {
    var area = null;
    try {
      area = window.sessionStorage;
    } catch (e) {
      area = null;
    }
    if (!area) return;
    try {
      area.setItem(DIALOG_KEY, JSON.stringify(dialog));
    } catch (e) {
      /* ignore */
    }
  }

  function clearLog() {
    log.innerHTML = "";
    if (hint) log.appendChild(hint);
  }

  function restoreDialog() {
    var raw = "";
    try {
      raw = window.sessionStorage.getItem(DIALOG_KEY) || "";
    } catch (e) {
      raw = "";
    }
    if (!raw) return;

    var stored = null;
    try {
      stored = JSON.parse(raw);
    } catch (e) {
      stored = null;
    }
    if (!stored || !stored.length) return;

    dialog = stored;
    for (var i = 0; i < dialog.length; i++) {
      var item = dialog[i];
      if (!item || !item.content) continue;
      if (item.role === "user") {
        addUserBubble(item.content);
      } else {
        // Прочитанный ранее ответ показываем целиком, без markdown-разметки
        var shown = toPlain(item.content, true) || item.content;
        var bubble = addAgentBubble();
        bubble.shown = shown;
        bubble.text.textContent = shown;
        bubble.done = true;
        bubble.pending = 0;
        updateGate(bubble);
      }
    }
    hideHint();
  }

  function resetDialog() {
    stopAll(null);
    dialog = [];
    saveDialog();
    activeBubble = null;
    clearLog();
    showHint();
    setNote("");
    refreshStatus();
  }

  /* ---------- API-токен ---------- */
  function setTokenMessage(text, isError) {
    if (!tokenMsg) return;
    tokenMsg.textContent = text || "";
    tokenMsg.hidden = !text;
    tokenMsg.classList.toggle("is-error", !!isError);
  }

  function openTokenForm(focus) {
    if (!tokenForm) return;
    tokenForm.hidden = false;
    if (tokenBtn) tokenBtn.setAttribute("aria-expanded", "true");
    if (focus && tokenInput) tokenInput.focus();
  }

  function closeTokenForm() {
    if (!tokenForm) return;
    tokenForm.hidden = true;
    if (tokenBtn) tokenBtn.setAttribute("aria-expanded", "false");
    setTokenMessage("");
  }

  function initToken() {
    token = normalizeToken(lsGet(TOKEN_KEY));
    if (!token) {
      // Необязательный локальный файл js/config.local.js (в .gitignore)
      var configured = window.AGENT_CONFIG && window.AGENT_CONFIG.token;
      if (configured) {
        token = normalizeToken(configured);
        lsSet(TOKEN_KEY, token);
      }
    }
    if (token) {
      closeTokenForm();
    } else {
      openTokenForm(false);
      setTokenMessage(
        "Укажите API-токен агента: панель Timeweb Cloud → Агенты → Управление → Доступ по API.",
        false
      );
    }
  }

  if (tokenBtn && tokenForm) {
    tokenBtn.addEventListener("click", function () {
      if (tokenForm.hidden) openTokenForm(true);
      else closeTokenForm();
    });
  }

  if (tokenForm) {
    tokenForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = normalizeToken(tokenInput ? tokenInput.value : "");
      if (!value) {
        setTokenMessage("Введите токен — без него агент не ответит.", true);
        return;
      }
      token = value;
      lsSet(TOKEN_KEY, value);
      if (tokenInput) tokenInput.value = "";
      closeTokenForm();
      setNote("API-токен сохранён в этом браузере.");
      refreshStatus();
    });
  }

  if (tokenClear) {
    tokenClear.addEventListener("click", function () {
      token = "";
      lsSet(TOKEN_KEY, "");
      if (tokenInput) tokenInput.value = "";
      openTokenForm(true);
      setTokenMessage("API-токен удалён из этого браузера.", false);
      refreshStatus();
    });
  }

  /* ---------- Голосовой ввод (STT) ---------- */
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var micSupported = !!SpeechRecognition;
  var recognition = null;

  if (micSupported) {
    recognition = new SpeechRecognition();
    recognition.lang = SPEECH_LANG;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      listening = true;
      if (micBtn) micBtn.setAttribute("aria-pressed", "true");
      setNote("Говорите — распознаю вопрос и отправлю его агенту.");
      refreshStatus();
    };

    recognition.onresult = function (event) {
      var text = "";
      var isFinal = false;
      for (var i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      input.value = text.trim();
      if (isFinal && send(text)) setNote("");
    };

    recognition.onerror = function (event) {
      listening = false;
      if (micBtn) micBtn.setAttribute("aria-pressed", "false");
      var known = SR_MESSAGES[event.error];
      setNote(known !== undefined ? known : "Не удалось распознать речь: " + event.error);
      refreshStatus();
    };

    recognition.onend = function () {
      listening = false;
      if (micBtn) micBtn.setAttribute("aria-pressed", "false");
      refreshStatus();
    };
  }

  if (micBtn) {
    if (!micSupported) {
      micBtn.hidden = true;
      setNote(
        "Голосовой ввод поддерживают Chrome, Edge и Яндекс Браузер — здесь доступен только текст."
      );
    } else {
      micBtn.addEventListener("click", function () {
        if (busy()) {
          setNote("Дождитесь окончания ответа или нажмите «Остановить и показать текст».");
          return;
        }
        if (listening) {
          try {
            recognition.stop();
          } catch (e) {
            /* ignore */
          }
          return;
        }
        if (!token) {
          openTokenForm(true);
          setTokenMessage("Введите API-токен агента, чтобы задать вопрос.", true);
          setNote("Без API-токена агент не сможет ответить.");
          return;
        }
        setNote("Разрешите доступ к микрофону, если браузер спросит.");
        try {
          recognition.start();
        } catch (e) {
          setNote("Не удалось включить микрофон: " + ((e && e.message) || e));
        }
      });
    }
  }

  /* ---------- Обработчики композера и панели ---------- */
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    send(input.value);
  });

  if (stopBtn) {
    stopBtn.addEventListener("click", function () {
      var wasSpeaking = speaking || queue.length > 0;
      stopAll(
        wasSpeaking
          ? "Озвучка остановлена — текст ответа раскрыт полностью."
          : "Запрос к агенту прерван."
      );
    });
  }

  if (newBtn) {
    newBtn.addEventListener("click", function () {
      resetDialog();
      setNote("Начат новый диалог.");
    });
  }

  /* ---------- Монтирование по состоянию сессии ---------- */
  function mount() {
    if (mounted) return;
    mounted = true;
    clearLog();
    initToken();
    restoreDialog();
    refreshStatus();
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    stopAll(null);
    if (listening) {
      try {
        recognition.stop();
      } catch (e) {
        /* ignore */
      }
    }
    dialog = [];
    saveDialog();
    activeBubble = null;
    clearLog();
    showHint();
    setNote("");
    closeTokenForm();
  }

  function applySession(session) {
    if (session) {
      locked.hidden = true;
      embed.hidden = false;
      mount();
    } else {
      embed.hidden = true;
      locked.hidden = false;
      unmount();
    }
  }

  A.onChange(applySession);
})(window, document);
