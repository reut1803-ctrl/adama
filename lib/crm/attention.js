import { PROPOSAL_FROZEN } from "./proposalStatus";

// לוגיקת הזמנים של המערכת: חלון התצוגה של הצעה שירדה מהפרק, וזיהוי עיכובים.
//
// עיקרון מנחה: כל חישוב זמן נעשה בזמן התצוגה מול חותמות שנשמרו,
// ולא נשמר בשדה סטטי במסד הנתונים. שדה סטטי היה יוצא מסנכרון ברגע
// שהשעה עוברת בלי שאיש פותח את המסך, והמצב היה משתנה רק בטעינה הבאה.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// המרה של כל צורת תאריך אפשרית למספר מילישניות.
// חותמת שרת מגיעה כאובייקט Timestamp של Firestore, ותאריכים במערכת
// נשמרים כמחרוזת ISO. שני המקרים נתמכים, וכך גם רשומות ותיקות.
export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// --- חלון התצוגה של הצעה שירדה מהפרק ---
//
// הצעה שירדה מהפרק ממשיכה להופיע במסכי הניהול השוטף במשך 48 שעות בדיוק,
// עם חיווי כמה זמן נותר, ואז נעלמת מהם כדי שהמסך יישאר נקי.
//
// חשוב מאוד: זו הסתרה בתצוגה בלבד. ההצעה עצמה נשמרת במסד הנתונים לתמיד,
// וכך התראת הכפילות ("הצעה בין השניים האלה כבר עלתה וירדה") ממשיכה לעבוד
// גם שנים אחר כך. מי שקורא/ת את הקוד הזה: אין למחוק כאן שום רשומה.
export const DROPPED_VISIBLE_MS = 48 * HOUR_MS;

// מתי בדיוק ירדה ההצעה מהפרק - לפי הרשומה האחרונה ביומן שבה נקבע הסטטוס הזה.
// אם אין רשומה כזו (למשל היסטוריה שהוזנה ידנית), נופלים למועד ההקמה.
export function droppedAtMs(proposal, droppedStatus) {
  let latest = 0;
  (proposal?.journal || []).forEach((entry) => {
    if (entry?.status !== droppedStatus) return;
    const ms = toMillis(entry?.date);
    if (ms > latest) latest = ms;
  });
  return latest || toMillis(proposal?.createdAt);
}

// --- שתי שאלות שונות, ואסור לערבב ביניהן ---
//
// (1) האם ההצעה שייכת ללוח הפעיל של מסך ההתאמות?
//     הצעה שירדה מהפרק יורדת מהלוח *מיד*, באותו רגע, ועוברת לקטע
//     ההיסטוריה שבתחתית המסך. אין כאן שום המתנה.
export function isOnActiveBoard(proposal, droppedStatus) {
  // הצעה מוקפאת יורדת מהלוח הפעיל בדיוק כמו הצעה שירדה מהפרק, אבל
  // מסיבה אחרת: היא לא נסגרה, היא רק ממתינה. מקומה באזור "מוקפאים".
  if (proposal?.status === PROPOSAL_FROZEN) return false;
  return proposal?.status !== droppedStatus;
}

// (2) האם להציג את ההצעה ברשימת ההתקדמות שבתוך כרטיס המועמד/ת?
//     שם, ורק שם, פועל חלון 48 השעות: מי שנכנס/ת לפרופיל בימיים
//     שאחרי הירידה עדיין רואה אותה עם חיווי כמה זמן נותר, ואחר כך
//     היא נעלמת מהפרופיל. זה הדגל הזמני, ולא סינון של הלוח.
export function showsInProfileProgress(proposal, now, droppedStatus) {
  // הצעה מוקפאת מוסתרת מהפרופיל לגמרי, ולא רק לחלון זמן: המועמד/ת
  // צריך/ה להיראות פנוי/ה לשאר הצוות ולקבל הצעות חדשות במקביל.
  if (proposal?.status === PROPOSAL_FROZEN) return false;
  if (proposal?.status !== droppedStatus) return true;
  const ms = droppedAtMs(proposal, droppedStatus);
  if (!ms) return false;
  return now - ms < DROPPED_VISIBLE_MS;
}

// כמה שעות שלמות נותרו עד שהשורה תיעלם - לחיווי עדין למשתמש/ת
export function droppedHoursLeft(proposal, now, droppedStatus) {
  const ms = droppedAtMs(proposal, droppedStatus);
  if (!ms) return 0;
  return Math.max(0, Math.ceil((ms + DROPPED_VISIBLE_MS - now) / HOUR_MS));
}

// טקסט החיווי שמופיע על הצעה שירדה, כל עוד היא בחלון התצוגה
export function droppedNoticeText(proposal, now, droppedStatus) {
  const hours = droppedHoursLeft(proposal, now, droppedStatus);
  if (hours <= 0) return "";
  // תמיד בשעות: החלון כולו 48 שעות, ו"בעוד יומיים" היה מטעה כשנותרו 47 שעות
  if (hours <= 1) return "יורד מהתצוגה בעוד פחות משעה";
  return `יורד מהתצוגה בעוד ${hours} שעות`;
}

// --- התראת כפילות ---
//
// נבדקת מול כל ההיסטוריה במסד הנתונים, כולל הצעות שכבר אינן מוצגות.
// זו בדיוק הסיבה שאסור למחוק הצעות שירדו מהפרק.
//
// שלושה כללים נוקשים, וכולם נועדו למנוע התראת שווא:
//  1. התאמה חד-חד-ערכית בין שני מזהי המועמדים. אין השוואה הפוכה ואין
//     השוואה חלקית: בחור א' מול בחורה ב' אינו אותו זוג כמו ב' מול א'.
//  2. רק רשומה מתועדת נספרת. חייבים שני מזהים שהם מחרוזות לא ריקות
//     וסטטוס מוכר. הצעה שנבנתה סביב כרטיס מקוצר ("מישהו מהמעגל שלי")
//     נושאת maleId או femaleId ריק, ולכן לעולם אינה נספרת כאן.
//  3. סיווג לפי מצב בפועל - פעילה, ירדה מהפרק, או מוקפאת - כדי
//     שההודעה למשתמש תתאר את מה שבאמת קיים ולא תנחש.

const idOf = (value) => (typeof value === "string" ? value.trim() : "");

/** האם זו רשומת הצעה מתועדת, שאפשר להסתמך עליה להתראה. */
export function isRecordedProposal(proposal, droppedStatus, stages = []) {
  if (!proposal || typeof proposal !== "object") return false;
  if (!idOf(proposal.maleId) || !idOf(proposal.femaleId)) return false;
  const status = idOf(proposal.status);
  if (!status) return false;
  const known = [...stages, droppedStatus, PROPOSAL_FROZEN].filter(Boolean);
  // ללא רשימת שלבים מפורשת מסתפקים בכך שקיים סטטוס כלשהו
  return known.length === 0 ? true : known.includes(status);
}

/**
 * כל מה שקיים במסד הנתונים עבור הזוג הזה בדיוק, מסווג לפי מצב.
 * מחזיר תמיד אובייקט עם ארבע רשימות, גם כשאין התאמה.
 */
export function pairHistory(proposals, maleId, femaleId, droppedStatus, stages = []) {
  const a = idOf(maleId);
  const b = idOf(femaleId);
  const empty = { all: [], active: [], dropped: [], frozen: [] };
  if (!a || !b) return empty;

  const all = (proposals || [])
    .filter((p) => isRecordedProposal(p, droppedStatus, stages))
    .filter((p) => idOf(p.maleId) === a && idOf(p.femaleId) === b)
    .sort((x, y) => toMillis(y.createdAt) - toMillis(x.createdAt));

  return {
    all,
    dropped: all.filter((p) => idOf(p.status) === droppedStatus),
    frozen: all.filter((p) => idOf(p.status) === PROPOSAL_FROZEN),
    active: all.filter((p) => idOf(p.status) !== droppedStatus && idOf(p.status) !== PROPOSAL_FROZEN),
  };
}

/** נשמרת לתאימות: אותה בדיקה בדיוק, רק בלי הסיווג. */
export function pastProposalsForPair(proposals, maleId, femaleId, droppedStatus, stages = []) {
  return pairHistory(proposals, maleId, femaleId, droppedStatus, stages).all;
}

// --- "דורש התייחסות" ---
//
// כמה ימים בלי טיפול עד שכרטיס מסומן. הספירה אינה של עריכת הכרטיס בלבד:
// מועמד/ת שנכנס/ה להצעת שידוך או ששלב ההצעה שלו/ה זז - טופל/ה לכל דבר,
// גם אם איש לא נגע בכרטיס עצמו. לכן נאספת גם הפעילות סביבו/ה.
//
// ומעל הכל: מי שיש עליו/ה תהליך שידוך פתוח לעולם אינו/ה "דורש/ת התייחסות".
// יש עליו/ה תהליך חי, וגם אם הוא מתעכב - זה עניין של מסך השידוכים ולא
// של המאגר. שני המסכים לא מתריעים על אותו דבר.
export const ATTENTION_DAYS = 5;

// מועמד/ת שאינו/ה פנוי/ה אינו/ה "דורש/ת התייחסות".
//
// אין טעם להתריע על כרטיס שממילא אינו בחיפוש: התגית האדומה "לא פנוי"
// והתגית "דורש התייחסות" סותרות זו את זו ויוצרות בלבול. הסטטוס גובר.
//
// נבדק לפי הטקסט ולא מול רשימה, כדי שהמודול הזה יישאר בלי תלויות
// ולא ייווצר ייבוא מעגלי מול החנות. "פנוי" ו"פנויה" נחשבים פנויים,
// "לא פנוי" ו"בהפסקה" אינם. כרטיס ותיק בלי סטטוס כלל נחשב פנוי, כדי
// שהתנהגותו לא תשתנה.
export function isSeekingMatches(candidate) {
  const status = String(candidate?.availabilityStatus || "").trim();
  if (!status) return true;
  return status.startsWith("פנוי");
}

// מתי נגעו בכרטיס עצמו. אם אין חותמת עדכון (כרטיס שלא נערך מאז שהשדה נוסף),
// נופלים למועד היצירה - כדי שכרטיס לא ייחשב "טופל עכשיו" רק כי השדה חסר.
export function profileTouchedMs(candidate) {
  const touched = toMillis(candidate?.lastTouchedAt);
  const created = toMillis(candidate?.createdAt);
  return Math.max(touched, created);
}

// המועד האחרון שבו טופל/ה המועמד/ת - בכרטיס או סביבו, ובנוסף האם יש
// עליו/ה תהליך שידוך פתוח. מחושב בזמן התצוגה מהנתונים הקיימים, ולכן
// עובד גם רטרואקטיבית על כל ההיסטוריה שכבר במערכת.
export function candidateActivity(candidate, proposals, droppedStatus) {
  let latest = profileTouchedMs(candidate);
  let hasActiveMatch = false;

  (proposals || []).forEach((p) => {
    if (p.maleId !== candidate?.id && p.femaleId !== candidate?.id) return;

    let proposalMs = toMillis(p.createdAt);
    (p.journal || []).forEach((entry) => {
      const ms = toMillis(entry?.date);
      if (ms > proposalMs) proposalMs = ms;
    });
    if (proposalMs > latest) latest = proposalMs;

    // הצעה מוקפאת אינה תהליך פתוח: היא אינה חוסמת את המועמד/ת ואינה
    // מונעת ממנו/ה להופיע כמי שאפשר להציע לו/ה
    if (p.status !== droppedStatus && p.status !== PROPOSAL_FROZEN) hasActiveMatch = true;
  });

  return { lastActivityMs: latest, hasActiveMatch };
}

// כמה ימים שלמים עברו. כרטיס בלי שום תאריך מחזיר null - לא יודעים, ולכן לא מסמנים.
export function candidateAttention(candidate, proposals, now, droppedStatus) {
  const { lastActivityMs, hasActiveMatch } = candidateActivity(candidate, proposals, droppedStatus);
  // סטטוס שאינו פנוי גובר: אין מה לדרוש התייחסות על מי שאינו בחיפוש
  if (!isSeekingMatches(candidate)) return { days: null, needsAttention: false, hasActiveMatch };
  if (hasActiveMatch || !lastActivityMs) return { days: null, needsAttention: false, hasActiveMatch };
  const diff = now - lastActivityMs;
  const days = diff < 0 ? 0 : Math.floor(diff / DAY_MS);
  return { days, needsAttention: days >= ATTENTION_DAYS, hasActiveMatch };
}

// --- הצעה שחזרה ללוח הפעיל ---
//
// כשהצעה שירדה מהפרק חוזרת ללוח, חשוב שמי שמטפל/ת בה יראה/תראה מיד שזו
// אינה הצעה חדשה אלא כזו שכבר נוסתה. כל המידע נגזר מהיומן הקיים בזמן
// התצוגה - אין שדה סטטוס נוסף שאפשר שייצא מסנכרון, וגם רשומות ותיקות
// שנוצרו לפני התוספת הזו מזוהות נכון.

// כל רשומות היומן שבהן ההצעה ירדה מהפרק, מהחדשה לישנה
export function dropEntries(proposal, droppedStatus) {
  return (proposal?.journal || [])
    .filter((entry) => entry?.status === droppedStatus)
    .sort((a, b) => toMillis(b?.date) - toMillis(a?.date));
}

// האם ההצעה ירדה מהפרק בעבר וכעת היא שוב פעילה.
// שים לב: זה נכון גם אם החזרה נעשתה דרך כפתור "החזרה ללוח" וגם אם מישהו
// פשוט בחר שלב אחר בעדכון הסטטוס - שתי הדרכים משאירות את אותו סימן ביומן.
export function wasDroppedBefore(proposal, droppedStatus) {
  if (!proposal || proposal.status === droppedStatus) return false;
  return dropEntries(proposal, droppedStatus).length > 0;
}

// פרטי הירידה האחרונה מהפרק: מתי, מה נכתב אז, וכמה פעמים זה קרה.
// הרציונל נשמר ברשומת היומן מרגע התוספת הזו. להצעות ותיקות שאין בהן
// רציונל שמור נופלים לרציונל הנוכחי של ההצעה - זה מה שהיה כתוב אז.
export function lastDropInfo(proposal, droppedStatus) {
  const entries = dropEntries(proposal, droppedStatus);
  const latest = entries[0];
  if (!latest) return null;
  return {
    dateMs: toMillis(latest.date),
    note: latest.note || "",
    rationale: latest.rationaleAtDrop || proposal?.rationale || "",
    author: latest.author || "",
    times: entries.length,
  };
}

// השלב שאליו מחזירים הצעה שירדה מהפרק: השלב האחרון שבו היא הייתה
// לפני הירידה. אם אין כזה ביומן, חוזרים לשלב הפתיחה.
export function stageBeforeDrop(proposal, droppedStatus, stages) {
  const drops = dropEntries(proposal, droppedStatus);
  // רק מה שקרה לפני הירידה האחרונה רלוונטי. אם ההצעה כבר ירדה, חזרה ושוב
  // ירדה - חוזרים לשלב שבו היא הייתה ערב הירידה האחרונה, לא הראשונה.
  const dropMs = drops.length ? toMillis(drops[0].date) : Infinity;
  const journal = [...(proposal?.journal || [])].sort((a, b) => toMillis(a?.date) - toMillis(b?.date));
  let stage = "";
  journal.forEach((entry) => {
    if (toMillis(entry?.date) >= dropMs) return;
    if (entry?.status && entry.status !== droppedStatus && stages.includes(entry.status)) stage = entry.status;
  });
  return stage || stages[0];
}
