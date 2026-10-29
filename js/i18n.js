// Vertalingen. De Nederlandse tekst is de sleutel; ontbreekt een vertaling, dan blijft het Nederlands staan.
// {naam} in een tekst wordt vervangen door de waarde die je meegeeft: t("ouders van {name}", { name: "Bram" }).
(function () {
  const LANGS = { nl: "Nederlands", en: "English", de: "Deutsch", fr: "Français", ar: "العربية" };
  const LOCALE = { nl: "nl-NL", en: "en-GB", de: "de-DE", fr: "fr-FR", ar: "ar-u-nu-latn" };
  const T = {
    // tabs
    "Planning": { en: "Schedule", de: "Plan", fr: "Planning", ar: "الجدول" },
    "Wedstrijden": { en: "Matches", de: "Spiele", fr: "Matchs", ar: "المباريات" },
    "Spelers": { en: "Players", de: "Spieler", fr: "Joueurs", ar: "اللاعبون" },
    "Wissels": { en: "Substitutions", de: "Wechsel", fr: "Remplacements", ar: "التبديلات" },
    "Seizoen": { en: "Season", de: "Saison", fr: "Saison", ar: "الموسم" },
    "Instellingen": { en: "Settings", de: "Einstellungen", fr: "Réglages", ar: "الإعدادات" },
    // planning
    "Komende wedstrijden": { en: "Upcoming matches", de: "Nächste Spiele", fr: "Prochains matchs", ar: "المباريات القادمة" },
    "Aanwezig {n} min voor de aftrap. Bij uitwedstrijden rekent de planner de vertrektijd vanaf de thuisclub uit.": {
      en: "Be there {n} min before kick-off. For away matches the departure time from our own club is calculated.",
      de: "Bitte {n} Min. vor Anpfiff da sein. Bei Auswärtsspielen wird die Abfahrtszeit ab unserem Verein berechnet.",
      fr: "Soyez là {n} min avant le coup d'envoi. Pour les matchs à l'extérieur, l'heure de départ depuis notre club est calculée.",
      ar: "كن حاضرًا قبل بداية المباراة بـ {n} دقيقة. في المباريات خارج الأرض يُحسب وقت الانطلاق من نادينا." },
    "Nog geen komende wedstrijden.": { en: "No upcoming matches yet.", de: "Noch keine anstehenden Spiele.", fr: "Pas encore de matchs à venir.", ar: "لا توجد مباريات قادمة بعد." },
    "De coach heeft nog geen wedstrijden ingepland.": { en: "The coach hasn't scheduled any matches yet.", de: "Der Trainer hat noch keine Spiele eingeplant.", fr: "L'entraîneur n'a pas encore planifié de matchs.", ar: "لم يضع المدرب أي مباريات بعد." },
    "Kopieer hele schema": { en: "Copy full schedule", de: "Ganzen Plan kopieren", fr: "Copier tout le planning", ar: "نسخ الجدول كاملًا" },
    // wedstrijdkaart
    "eerstvolgende": { en: "next", de: "als Nächstes", fr: "prochain", ar: "التالية" },
    "THUIS": { en: "HOME", de: "HEIM", fr: "DOMICILE", ar: "على أرضنا" },
    "UIT": { en: "AWAY", de: "AUSWÄRTS", fr: "EXTÉRIEUR", ar: "خارج الأرض" },
    "vastgezet": { en: "fixed", de: "fest", fr: "fixé", ar: "مثبّت" },
    "Tegenstander?": { en: "Opponent?", de: "Gegner?", fr: "Adversaire ?", ar: "الخصم؟" },
    "Vertrek": { en: "Departure", de: "Abfahrt", fr: "Départ", ar: "الانطلاق" },
    "Aanwezig": { en: "Be there", de: "Treffpunkt", fr: "Rendez-vous", ar: "الحضور" },
    "Aftrap": { en: "Kick-off", de: "Anpfiff", fr: "Coup d'envoi", ar: "البداية" },
    "Reistijd": { en: "Travel", de: "Fahrzeit", fr: "Trajet", ar: "مدة السفر" },
    "Rijden": { en: "Drivers", de: "Fahren", fr: "Chauffeurs", ar: "السائقون" },
    "Grensrechter": { en: "Linesman", de: "Linienrichter", fr: "Juge de touche", ar: "مراقب الخط" },
    "Wassen": { en: "Laundry", de: "Wäsche", fr: "Lessive", ar: "الغسيل" },
    "Afwezig": { en: "Absent", de: "Abwesend", fr: "Absents", ar: "غائبون" },
    "niemand": { en: "nobody", de: "niemand", fr: "personne", ar: "لا أحد" },
    "Kopieer bericht": { en: "Copy message", de: "Nachricht kopieren", fr: "Copier le message", ar: "نسخ الرسالة" },
    "Route": { en: "Route", de: "Route", fr: "Itinéraire", ar: "الطريق" },
    "Meer ▾": { en: "More ▾", de: "Mehr ▾", fr: "Plus ▾", ar: "المزيد ▾" },
    "Minder ▴": { en: "Less ▴", de: "Weniger ▴", fr: "Moins ▴", ar: "أقل ▴" },
    "ouders van {name}": { en: "parents of {name}", de: "Eltern von {name}", fr: "parents de {name}", ar: "أهل {name}" },
    "en": { en: "and", de: "und", fr: "et", ar: "و" },
    // ouders: afwezigheid doorgeven
    "Het schema staat vast. Kun je niet op je beurt? Ruil zelf met een andere ouder en laat het de coach weten.": {
      en: "The schedule is final. Can't make your turn? Swap with another parent and let the coach know.",
      de: "Der Plan steht fest. Kannst du deinen Dienst nicht übernehmen? Tausche mit anderen Eltern und sag dem Trainer Bescheid.",
      fr: "Le planning est fixé. Vous ne pouvez pas assurer votre tour ? Échangez avec un autre parent et prévenez l'entraîneur.",
      ar: "الجدول نهائي. إذا لم تستطع القيام بدورك، بدّل مع أحد الأهالي الآخرين وأخبر المدرب." },
    "Geef door wie er niet is": { en: "Let us know who can't come", de: "Melde, wer nicht kann", fr: "Indiquez qui est absent", ar: "أخبرنا من لن يحضر" },
    "De coach maakt het schema voor de komende wedstrijden. Vink per wedstrijd aan of je kind er niet is, of dat jij als ouder er niet bent (dan krijg je die dag geen taak). Je kunt het aanpassen tot de coach het schema maakt.": {
      en: "The coach is making the schedule for the coming matches. For each match, tick whether your child can't come, or whether you as a parent aren't available (then you get no task that day). You can change it until the coach makes the schedule.",
      de: "Der Trainer erstellt den Plan für die nächsten Spiele. Kreuze pro Spiel an, ob dein Kind nicht kann oder ob du als Elternteil nicht da bist (dann bekommst du an dem Tag keine Aufgabe). Du kannst es ändern, bis der Trainer den Plan erstellt.",
      fr: "L'entraîneur prépare le planning des prochains matchs. Cochez pour chaque match si votre enfant est absent, ou si vous-même n'êtes pas disponible (vous n'aurez alors pas de tâche ce jour-là). Vous pouvez modifier jusqu'à ce que l'entraîneur fasse le planning.",
      ar: "يُعدّ المدرب جدول المباريات القادمة. ضع علامة لكل مباراة إذا كان طفلك لن يحضر، أو إذا كنت أنت غير متاح (فلن تُكلَّف بمهمة في ذلك اليوم). يمكنك التعديل حتى يُعدّ المدرب الجدول." },
    "Mijn kind": { en: "My child", de: "Mein Kind", fr: "Mon enfant", ar: "طفلي" },
    "Kies…": { en: "Choose…", de: "Auswählen…", fr: "Choisir…", ar: "اختر…" },
    "{name} is er niet": { en: "{name} can't come", de: "{name} kann nicht", fr: "{name} est absent(e)", ar: "{name} لن يحضر" },
    "Ouder is er niet (geen taak)": { en: "Parent not available (no task)", de: "Elternteil nicht da (keine Aufgabe)", fr: "Parent indisponible (pas de tâche)", ar: "ولي الأمر غير متاح (بدون مهمة)" },
    "thuis tegen": { en: "home vs", de: "Heimspiel gegen", fr: "à domicile contre", ar: "على أرضنا ضد" },
    "uit bij": { en: "away at", de: "auswärts bei", fr: "à l'extérieur chez", ar: "خارج الأرض عند" },
    "Doorgeven": { en: "Send", de: "Absenden", fr: "Envoyer", ar: "إرسال" },
    "Doorgeven lukte niet. Misschien heeft de coach het schema al gemaakt.": { en: "Sending failed. The coach may already have made the schedule.", de: "Senden fehlgeschlagen. Vielleicht hat der Trainer den Plan schon erstellt.", fr: "L'envoi a échoué. L'entraîneur a peut-être déjà fait le planning.", ar: "تعذّر الإرسال. ربما أعدّ المدرب الجدول بالفعل." },
    "Doorgegeven, dank je wel!": { en: "Sent, thank you!", de: "Gesendet, danke!", fr: "Envoyé, merci !", ar: "تم الإرسال، شكرًا لك!" },
    "Gekopieerd. Plak het in de groepsapp.": { en: "Copied. Paste it into the group chat.", de: "Kopiert. Füge es in den Gruppenchat ein.", fr: "Copié. Collez-le dans le groupe.", ar: "تم النسخ. الصقه في مجموعة الدردشة." },
    "Gekopieerd.": { en: "Copied.", de: "Kopiert.", fr: "Copié.", ar: "تم النسخ." },
    "Laden…": { en: "Loading…", de: "Laden…", fr: "Chargement…", ar: "جارٍ التحميل…" },
    // wedstrijdbericht
    "Wedstrijd {day}": { en: "Match {day}", de: "Spiel {day}", fr: "Match {day}", ar: "مباراة {day}" },
    "(thuis)": { en: "(home)", de: "(Heimspiel)", fr: "(domicile)", ar: "(على أرضنا)" },
    "(uit)": { en: "(away)", de: "(auswärts)", fr: "(extérieur)", ar: "(خارج الأرض)" },
    "Vertrek vanaf ons sportcomplex:": { en: "Departure from our club:", de: "Abfahrt an unserem Sportplatz:", fr: "Départ de notre club :", ar: "الانطلاق من نادينا:" },
    "volgt nog": { en: "to follow", de: "folgt noch", fr: "à suivre", ar: "سيُعلن لاحقًا" },
    "Rijders:": { en: "Drivers:", de: "Fahrer:", fr: "Chauffeurs :", ar: "السائقون:" },
    "Aanwezig:": { en: "Be there:", de: "Treffpunkt:", fr: "Rendez-vous :", ar: "الحضور:" },
    "in de kleedkamer": { en: "in the changing room", de: "in der Kabine", fr: "au vestiaire", ar: "في غرفة الملابس" },
    "bij {club}": { en: "at {club}", de: "bei {club}", fr: "à {club}", ar: "في {club}" },
    "de uitclub": { en: "the away club", de: "dem Gastverein", fr: "le club adverse", ar: "نادي الخصم" },
    "Aftrap:": { en: "Kick-off:", de: "Anpfiff:", fr: "Coup d'envoi :", ar: "البداية:" },
    "Grensrechter:": { en: "Linesman:", de: "Linienrichter:", fr: "Juge de touche :", ar: "مراقب الخط:" },
    "Wastas mee naar de wedstrijd:": { en: "Brings the laundry bag to the match:", de: "Bringt die Wäschetasche zum Spiel:", fr: "Apporte le sac de linge au match :", ar: "يُحضر حقيبة الملابس إلى المباراة:" },
    "Wastas mee naar huis (wassen):": { en: "Takes the laundry bag home (washing):", de: "Nimmt die Wäschetasche mit nach Hause (waschen):", fr: "Ramène le sac de linge (lessive) :", ar: "يأخذ حقيبة الملابس إلى البيت (للغسيل):" },
    "Afwezig:": { en: "Absent:", de: "Abwesend:", fr: "Absents :", ar: "غائبون:" },
    "Kun je niet op je beurt? Ruil even met een andere ouder. Zet 'm op, {team}! 💪": {
      en: "Can't make your turn? Swap with another parent. Go for it, {team}! 💪",
      de: "Kannst du deinen Dienst nicht übernehmen? Tausche mit anderen Eltern. Auf geht's, {team}! 💪",
      fr: "Vous ne pouvez pas assurer votre tour ? Échangez avec un autre parent. Allez {team} ! 💪",
      ar: "لا تستطيع القيام بدورك؟ بدّل مع أحد الأهالي. بالتوفيق يا {team}! 💪" },
    "Wij": { en: "Us", de: "Wir", fr: "Nous", ar: "نحن" },
    "team": { en: "team", de: "Team", fr: "l'équipe", ar: "الفريق" },
  };
  let lang = "nl";
  try { const q = new URLSearchParams(location.search).get("taal"); lang = (q && LANGS[q]) ? q : (localStorage.getItem("teamplanner.lang") || ""); } catch (e) {}
  if (!LANGS[lang]) { const nav = (navigator.language || "nl").slice(0, 2); lang = LANGS[nav] ? nav : "nl"; }
  function t(s, vars) {
    let out = (lang !== "nl" && T[s] && T[s][lang]) || s;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? vars[k] : m);
    return out;
  }
  function apply() { document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"; }
  apply();
  window.I18N = {
    t, LANGS,
    get lang() { return lang; },
    get locale() { return LOCALE[lang]; },
    set(l) { if (!LANGS[l]) return; lang = l; try { localStorage.setItem("teamplanner.lang", l); } catch (e) {} apply(); },
  };
})();
