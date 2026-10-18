(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "taallamAlhaitham.v1";
  const initialState = { profile: null, lessonsDone: 0, correctCount: 0, completed: false };
  let state = loadState();
  let selectedAvatar = state.profile?.avatar || "🧒";
  let recognition = null;
  let listening = false;
  let speaking = false;
  let currentSubject = "math";
  let toastTimer = null;

  const lessons = {
    math: {
      tag: "مغامرة الرياضيات", title: "نجمع التفاحات 🍎",
      intro: "خلّينا نشوف كم تفاحة عندنا إذا جمعنا المجموعتين.",
      caption: "عدّ التفاحات واحدة واحدة، وبعدها قل لنا الناتج.",
      question: "تفاحتان + تفاحة واحدة = كم تفاحة؟",
      explanation: "أهلًا يا بطل! عندنا تفاحتان هنا، وتفاحة واحدة هناك. نعدّهم مع بعض: واحد، اثنان، ثلاثة. إذن اثنان زائد واحد يساوي ثلاثة. شاطر! جرّب تختار الإجابة الصحيحة.",
      answers: ["٢", "٣", "٤"], correct: "3", visuals: ["🍎","🍎","🍎"]
    },
    reading: {
      tag: "مغامرة الحروف", title: "نتعرّف على حرف الألف أ",
      intro: "كل حرف له صوت، واليوم سنتعرّف على حرف الألف.",
      caption: "شوف الحرف، واسمع صوته، ثم اختَر الحرف الصحيح.",
      question: "أيّ واحد هو حرف الألف؟",
      explanation: "يا بطل، هذا حرف الألف: أ. نقول أَ مثل أسد، وأُ مثل أُم، وإِ مثل إبرة. الحروف تساعدنا نقرأ الكلمات. شوف الخيارات واختَر حرف الألف.",
      answers: ["ب", "أ", "ت"], correct: "أ", visuals: ["أ","🦁","📖"]
    },
    science: {
      tag: "مغامرة العلوم", title: "ماذا يحتاج النبات؟ 🌱",
      intro: "النبات كائن حي، ويساعده الماء وضوء الشمس على النمو.",
      caption: "فكّر: ما الشيء الذي يحتاجه النبات ليكبر؟",
      question: "أيّ شيء يساعد النبات على النمو؟",
      explanation: "تخيّل نبتة صغيرة. تحتاج إلى الماء، وضوء الشمس، والهواء، وتربة مناسبة. إذا نسينا نسقيها، قد تذبل. الآن اختَر الشيء الذي تحتاجه النبتة.",
      answers: ["ماء 💧", "حذاء 👟", "كرة ⚽"], correct: "ماء 💧", visuals: ["🌱","☀️","💧"]
    }
  };

  function loadState() {
    try { return { ...initialState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
    catch { return { ...initialState }; }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { showToast("تعذّر الحفظ على هذا الجهاز، لكن يمكنك مواصلة الدرس."); }
    renderProgress();
  }
  function normalizeDigits(text) {
    return String(text).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  }
  function showToast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }
  function renderProfile() {
    const p = state.profile;
    $("avatarPreview").textContent = p?.avatar || "🧒";
    $("profileButtonText").textContent = p?.name ? p.name : "ملفي";
    $("welcomeName").textContent = p?.name ? `يا ${p.name}` : "";
    $("childName").value = p?.name || "";
    $("childAge").value = p?.age || "";
    selectedAvatar = p?.avatar || "🧒";
    document.querySelectorAll(".avatar-choice").forEach(b => b.classList.toggle("chosen", b.dataset.avatar === selectedAvatar));
  }
  function renderProgress() {
    $("lessonsDone").textContent = toArabicDigits(state.lessonsDone || 0);
    $("correctCount").textContent = toArabicDigits(state.correctCount || 0);
    $("progressFill").style.width = state.completed ? "100%" : (state.correctCount ? "35%" : "0%");
    $("progressMessage").textContent = state.completed ? "رائع! أنهيت الدرس. أنت بطل التعلّم ⭐" : state.correctCount ? "أحسنت! استمر، أنت تتقدّم 🌟" : "ابدأ أول درس واجمع نجومك ⭐";
  }
  function toArabicDigits(n) { return String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]); }
  function renderLesson() {
    const l = lessons[currentSubject];
    $("lessonTag").textContent = l.tag; $("lessonTitle").textContent = l.title;
    $("lessonIntro").textContent = l.intro; $("visualCaption").textContent = l.caption;
    $("questionText").textContent = l.question;
    const stage = $("visualStage");
    if (currentSubject === "math") {
      stage.innerHTML = '<div class="apple-group"><span>🍎</span><span>🍎</span></div><span class="math-symbol">+</span><div class="apple-group"><span>🍎</span></div><span class="math-symbol equals">=</span><div class="apple-group answer-apples" id="answerApples"><span class="question-mark">؟</span></div>';
    } else if (currentSubject === "reading") {
      stage.innerHTML = '<div class="apple-group"><span style="font-size:46px;color:#176b52">أ</span></div><span class="math-symbol">←</span><div class="apple-group"><span style="font-size:43px">🦁</span></div><span class="math-symbol">←</span><div class="apple-group"><span style="font-size:43px">📖</span></div>';
    } else {
      stage.innerHTML = '<div class="apple-group"><span style="font-size:43px">🌱</span></div><span class="math-symbol">+</span><div class="apple-group"><span style="font-size:43px">☀️</span></div><span class="math-symbol">+</span><div class="apple-group"><span style="font-size:43px">💧</span></div>';
    }
    const options = $("answerOptions"); options.innerHTML = "";
    l.answers.forEach(answer => {
      const b = document.createElement("button"); b.type = "button"; b.className = "answer-button"; b.dataset.answer = answer; b.textContent = answer; b.addEventListener("click", () => checkAnswer(answer, b)); options.appendChild(b);
    });
    $("feedback").className = "feedback"; $("feedback").textContent = "اختَر الإجابة اللي تشوفها صحيحة.";
    $("lessonStep").textContent = state.completed ? "تم إنجاز الدرس" : "الدرس ١ من ١";
  }
  function checkAnswer(answer, button) {
    const l = lessons[currentSubject];
    document.querySelectorAll(".answer-button").forEach(b => { b.disabled = true; if (b.dataset.answer === l.correct) b.classList.add("correct"); });
    const feedback = $("feedback");
    if (answer === l.correct) {
      feedback.textContent = "ممتاز! إجابة صحيحة، أحسنت يا بطل! ⭐"; feedback.className = "feedback good";
      state.correctCount = (state.correctCount || 0) + 1;
      if (!state.completed) { state.completed = true; state.lessonsDone = (state.lessonsDone || 0) + 1; }
      if (currentSubject === "math") {
        const apples = $("answerApples"); if (apples) apples.innerHTML = "<span>🍎</span><span>🍎</span><span>🍎</span>";
      }
      saveState(); $("lessonStep").textContent = "تم إنجاز الدرس";
      speak("ممتاز! إجابة صحيحة، أحسنت يا بطل!");
    } else {
      button.classList.add("incorrect"); feedback.textContent = "قريب! ما عليك، جرّب مرة ثانية بعد ما نعدّ أو نفكّر مع بعض."; feedback.className = "feedback try-again";
      document.querySelectorAll(".answer-button").forEach(b => { b.disabled = false; if (b.dataset.answer === answer) b.disabled = true; });
      speak("قريب! لا بأس. خلّينا نفكّر مع بعض، وبعدها جرّب مرة ثانية.");
    }
  }
  function speak(text, onEnd) {
    if (!("speechSynthesis" in window)) { showToast("ميزة الصوت غير متاحة في هذا المتصفح."); if (onEnd) onEnd(); return; }
    window.speechSynthesis.cancel(); speaking = true;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ar"; utterance.rate = 0.88; utterance.pitch = 1.05;
    utterance.onend = () => { speaking = false; if (onEnd) onEnd(); };
    utterance.onerror = () => { speaking = false; if (onEnd) onEnd(); };
    window.speechSynthesis.speak(utterance);
  }
  function explainLesson() { speak(lessons[currentSubject].explanation); }
  function openVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    $("voicePanel").hidden = false;
    $("heardText").textContent = "ما سمعت كلامك بعد.";
    if (!SR) {
      $("voiceStatus").textContent = "المحادثة الصوتية غير مدعومة هنا";
      $("voiceHelp").textContent = "جرّب متصفح Chrome حديثًا، أو استخدم زر «اسمع الشرح».";
      showToast("المتصفح لا يدعم الاستماع الصوتي؛ يمكنك سماع الشرح.");
      return;
    }
    try {
      if (recognition) { try { recognition.abort(); } catch {} }
      recognition = new SR(); recognition.lang = "ar"; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
      listening = true;
      $("voiceStatus").textContent = "المعلّم يسمعك"; $("voiceHelp").textContent = "تكلم براحتك، واضغط إنهاء عندما تخلص.";
      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript + " ";
        $("heardText").textContent = transcript.trim() || "أسمعك…";
        if (event.results[event.results.length - 1].isFinal) respondToChild(transcript.trim());
      };
      recognition.onerror = (event) => {
        if (!listening) return;
        $("voiceStatus").textContent = event.error === "not-allowed" ? "نحتاج إذن الميكروفون" : "واجهنا مشكلة في الصوت";
        $("voiceHelp").textContent = event.error === "not-allowed" ? "اسمح للمتصفح باستخدام الميكروفون ثم جرّب من جديد." : "يمكنك إنهاء المحادثة وتجربة زر الاستماع للشرح.";
      };
      recognition.onend = () => {
        if (listening && recognition) { try { recognition.start(); } catch {} }
      };
      recognition.start();
    } catch {
      listening = false; $("voiceStatus").textContent = "تعذّر تشغيل الميكروفون"; $("voiceHelp").textContent = "تحقق من إذن الميكروفون واتصال آمن HTTPS.";
    }
  }
  function respondToChild(text) {
    if (!text) return;
    const t = normalizeDigits(text.toLowerCase());
    const l = lessons[currentSubject];
    if (/عيد|كرر|مرة ثانية|ما فهم|مش فاهم|مش فاهمة|مش فاهمش|ما فهمتش|اشرح|وضح/.test(t)) {
      speak("ولا يهمك يا بطل، نعيدها بهدوء. " + l.explanation);
    } else if (/السلام عليكم|مرحبا|مرحبا|أهلًا|اهلا|هاي|هلا/.test(t)) {
      speak("وعليكم السلام يا بطل! سعيد إنك تتعلّم معي. " + l.intro);
    } else if (/كم|الناتج|الإجابة|الجواب|صح|حل/.test(t)) {
      speak(l.explanation);
    } else if (/وقف|انتهينا|خلاص|باي|مع السلامة/.test(t)) {
      speak("أحسنت يا بطل! تقدر تنهي المحادثة من الزر الأحمر.");
    } else {
      speak("سمعتك يا بطل. خلّينا نمشي خطوة خطوة. " + l.intro);
    }
  }
  function stopVoice() {
    listening = false;
    if (recognition) { try { recognition.onend = null; recognition.stop(); } catch {} recognition = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    speaking = false; $("voicePanel").hidden = true;
    showToast("انتهت المحادثة الصوتية.");
  }
  function selectSubject(subject) {
    if (!lessons[subject]) return;
    currentSubject = subject; state.completed = false;
    document.querySelectorAll(".subject-card").forEach(b => b.classList.toggle("selected", b.dataset.subject === subject));
    renderLesson();
  }

  $("profileButton").addEventListener("click", () => { renderProfile(); $("profileDialog").showModal(); });
  document.querySelectorAll(".avatar-choice").forEach(b => b.addEventListener("click", () => { selectedAvatar = b.dataset.avatar; document.querySelectorAll(".avatar-choice").forEach(x => x.classList.toggle("chosen", x === b)); }));
  $("profileForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    if (event.submitter?.id === "saveProfile" || event.submitter?.value === "save") {
      event.preventDefault();
      const name = $("childName").value.trim().slice(0, 24);
      state.profile = name || $("childAge").value ? { name, age: $("childAge").value, avatar: selectedAvatar } : null;
      saveState(); renderProfile(); $("profileDialog").close(); showToast(name ? `أهلًا يا ${name}! جاهز نتعلّم؟` : "أهلًا يا بطل!"); return;
    }
  });
  $("clearProfile").addEventListener("click", () => { state.profile = null; saveState(); renderProfile(); $("profileDialog").close(); showToast("تقدر تستخدم التطبيق بدون ملف."); });
  $("startLesson").addEventListener("click", () => $("lessonSection").scrollIntoView({ behavior: "smooth", block: "start" }));
  document.querySelectorAll(".subject-card").forEach(b => b.addEventListener("click", () => selectSubject(b.dataset.subject)));
  $("listenButton").addEventListener("click", explainLesson);
  $("voiceButton").addEventListener("click", openVoice);
  $("stopVoiceButton").addEventListener("click", stopVoice);
  $("resetProgress").addEventListener("click", () => {
    if (confirm("هل تريد إعادة تقدّم التعلّم المحفوظ على هذا الجهاز؟")) { state.lessonsDone = 0; state.correctCount = 0; state.completed = false; saveState(); renderLesson(); showToast("تمت إعادة التقدّم على هذا الجهاز."); }
  });
  window.addEventListener("beforeunload", () => { listening = false; if (recognition) { try { recognition.abort(); } catch {} } if ("speechSynthesis" in window) window.speechSynthesis.cancel(); });
  renderProfile(); renderProgress(); renderLesson();
})();