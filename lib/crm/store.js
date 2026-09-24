"use client";

import { create } from "zustand";
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { crmDb, crmAuth, googleProvider } from "./firebaseClient";
import { DEFAULT_TERMS_TEXT, DEFAULT_DAILY_TIP, occupationsOf, REGIONS } from "./mockData";
import { nameKeys } from "./nameKey";
import { weekKey, weeklyValue } from "./week";
import { stageBeforeDrop } from "./attention";
import { BOOTSTRAP_ADMIN_EMAIL, isFirebaseConfigured } from "../appConfig";

// זיהוי המנהלת הראשית עובר דרך אותו נרמול כמו כל כתובת אחרת במערכת -
// אותיות קטנות, בלי רווחים ובלי תווי כיווניות נסתרים - כדי שהעתקה של
// הכתובת מאיזשהו מקום לא תמנע ממנה להיכנס.
const isBootstrapAdmin = (email) =>
  !!email && normalizeEmail(email) === normalizeEmail(BOOTSTRAP_ADMIN_EMAIL);

export const PROPOSAL_STAGES = ["הוצע", "בבדיקה", "הוחלפו פרטים", "נפגשו", "בהמשך / מתקדמים", "אירוסין"];
export const PROPOSAL_DROPPED = "ירד מהפרק";

export const AVAILABILITY_STATUSES = ["פנוי", "לא פנוי", "בהפסקה"];

// מספר ההצעות המקסימלי שמוצג בו-זמנית תחת הלשונית "הצעות חדשות" (לכל מאגר בנפרד)
export const NEW_TAB_LIMIT = 10;

const DEFAULT_QUIZ_ANSWERS = {
  ageRange: [24, 32],
  heightRange: [160, 180],
  religiousLevel: "הכל",
  regions: [],
  occupations: [],
  smoking: "לא משנה",
  traits: [],
  lifestyle: [],
};

// גבולות מחווני הסינון. טווח שנמצא על הגבולות המלאים נחשב "בלי סינון בכלל",
// ולכן גם כרטיס עם גיל או גובה חריג (או בלי נתון) ממשיך להופיע במאגר.
export const AGE_BOUNDS = [18, 70];
export const HEIGHT_BOUNDS = [140, 210];

// ברירת המחדל אינה מסתירה דבר: כל הטווחים פתוחים לרווחה וכל הרשימות על "הכל".
export const DEFAULT_FILTERS = {
  ageRange: [...AGE_BOUNDS],
  heightRange: [...HEIGHT_BOUNDS],
  religiousLevel: "הכל",
  region: "הכל",
  search: "",
};

const withId = (d) => ({ id: d.id, ...d.data() });

// Firestore מחזיר אוסף לפי מזהה המסמך (מחרוזת אקראית), ולכן כרטיס חדש נחת
// באמצע הרשימה ונראה כאילו לא נוסף. ממיינים תמיד מהחדש לישן לפי מועד היצירה.
// כרטיס ותיק שנשמר לפני שהוספנו את שדה התאריך מקבל 0 ויורד לסוף הרשימה.
const createdAtMs = (c) => {
  const t = Date.parse(c?.createdAt || "");
  return Number.isFinite(t) ? t : 0;
};
const byNewestFirst = (a, b) => createdAtMs(b) - createdAtMs(a);

// Firestore דוחה שמירה שמכילה ערך undefined ומכשיל את כל הפעולה. שדה שאין לו
// ערך (למשל כרטיס שיובא מגיליון בלי נתון עישון) נשמר כ-null במקום להפיל
// את השמירה כולה.
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v === undefined ? null : stripUndefined(v)]));
  }
  return value === undefined ? null : value;
}

// השוואת כתובות מייל תמיד באותה צורה: בלי רווחים נסתרים, בלי תווי כיווניות (RTL/LTR)
// שנדבקים לפעמים בהעתקה מווטסאפ, ובאותיות קטנות.
// ניקוי קפדני של כתובת מייל לפני שמירה והשוואה:
// - הסרת כל התווים הבלתי נראים שנדבקים בהעתקה מוואטסאפ או מקלדת נייד
//   (תווי כיווניות, רוחב אפס, רווח קשיח)
// - הסרת כל רווח, גם באמצע - כתובת מייל לעולם אינה מכילה רווחים
// - אותיות קטנות בלבד
export const normalizeEmail = (value) =>
  String(value || "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

// מזהה הרשומה ברשימת ההרשאות הוא כתובת המייל עצמה, ולכן הוא משמש גיבוי
// אם שדה המייל בתוך הרשומה חסר (למשל רשומה שנוספה ידנית דרך הקונסולה של Firebase).
export const allowlistEmail = (entry) => normalizeEmail(entry?.email || entry?.id);

// רשומה "פגומה" - המזהה שלה אינו זהה לכתובת נקייה, ולכן השרת לא יזהה את הכניסה
export const isBrokenAllowlistEntry = (entry) => !!entry?.id && allowlistEmail(entry) !== entry.id;

export const useCrmStore = create((set, get) => ({
  // --- מאגר פעיל: בנים / בנות ---
  board: "female",
  // מעבר מאגר מאפס את סינון רמת התורניות, כי הערכים שונים בין הרשימה הגברית לנשית (למשל "תורני" מול "תורנית")
  setBoard: (board) => set((state) => ({ board, filters: { ...state.filters, religiousLevel: "הכל" } })),

  // לשונית "הצעות חדשות" מול "הצעות קודמות" במסך המאגר - נשמרת גלובלית כדי שלא תתאפס
  // כשעוזבים את המסך (למשל לכרטיס מועמד/ת) וחוזרים אליו עם כפתור "חזור"
  // ברירת המחדל היא כל המאגר. לשוניות "חדשות"/"קודמות" הן תצוגות משנה
  // שהמשתמשת בוחרת במפורש, ולא חיתוך שמופעל מעצמו ומעלים כרטיסים.
  feedTab: "all",
  setFeedTab: (feedTab) => set({ feedTab }),

  // --- אתחול חיבור Firebase + כל המאזינים בזמן אמת (נקרא פעם אחת מ-AppShell) ---
  //
  // חשוב מאוד: כל האוספים במערכת מוגנים בכללי אבטחה שדורשים משתמש/ת מחובר/ת.
  // לכן אסור לפתוח מאזינים לפני שידוע מי מחובר/ת. מאזין שנפתח מוקדם מדי מקבל
  // "אין הרשאה", ו-Firestore סוגר אותו לצמיתות בלי לנסות שוב - וכך משתמש/ת
  // חדש/ה נשאר/ת עם רשימת הרשאות ריקה ונחסם/ת, גם כשהכתובת שמורה כהלכה.
  // הפתרון: המאזינים נפתחים רק אחרי שמצב ההתחברות ידוע, ונפתחים מחדש בכל
  // החלפת משתמש/ת.
  _initialized: false,
  _dataUnsubs: [],
  _subscribedFor: null,
  authLoading: true,

  unsubscribeData: () => {
    get()._dataUnsubs.forEach((unsub) => {
      try {
        unsub();
      } catch {
        // מאזין שכבר נסגר
      }
    });
    set({ _dataUnsubs: [], _subscribedFor: null });
  },

  subscribeData: (user) => {
    const email = normalizeEmail(user?.email);
    if (!email || get()._subscribedFor === email) return;
    get().unsubscribeData();

    const unsubs = [];

    // רשימת ההרשאות. אם הקריאה נכשלת (למשל הרגע שבו האסימון עדיין לא הגיע
    // לשרת), מנסים שוב כמה פעמים לפני שמכריזים שאין הרשאה - אחרת כניסה
    // ראשונה של איש/אשת צוות חדש/ה הייתה נחסמת בטעות.
    let allowlistAttempt = 0;
    const subscribeAllowlist = () => {
      const unsub = onSnapshot(
        collection(crmDb, "staffAllowlist"),
        (snap) => {
          allowlistAttempt = 0;
          set({ authAllowlist: snap.docs.map(withId), allowlistLoaded: true });
          get().recomputeRole();
        },
        () => {
          allowlistAttempt += 1;
          if (allowlistAttempt <= 3) {
            setTimeout(() => {
              if (get()._subscribedFor === email) subscribeAllowlist();
            }, 800 * allowlistAttempt);
            return;
          }
          set({ allowlistLoaded: true });
          get().recomputeRole();
        }
      );
      unsubs.push(unsub);
    };
    subscribeAllowlist();

    unsubs.push(
      onSnapshot(
        collection(crmDb, "candidates"),
        (snap) => {
          set({
            candidates: snap.docs.map(withId).sort(byNewestFirst),
            candidatesLoaded: true,
            candidatesError: false,
          });
        },
        () => {
          set({ candidatesLoaded: true, candidatesError: true });
        }
      )
    );

    // פניות מהטופס החיצוני. כישלון כאן אינו שקט: הוא נרשם ומוצג בלוח הבקרה,
    // כי המשמעות היא שכללי האבטחה החדשים עדיין לא פורסמו.
    unsubs.push(
      onSnapshot(
        collection(crmDb, "intakeSubmissions"),
        (snap) => set({ intakeSubmissions: snap.docs.map(withId), intakeLoaded: true, intakeError: false }),
        () => set({ intakeSubmissions: [], intakeLoaded: true, intakeError: true })
      )
    );

    unsubs.push(
      onSnapshot(collection(crmDb, "candidateStatus"), (snap) => {
        const map = {};
        snap.docs.forEach((d) => (map[d.id] = d.data().availabilityStatus));
        set({ candidateStatus: map });
      })
    );

    unsubs.push(
      onSnapshot(collection(crmDb, "proposals"), (snap) => {
        // Firestore מחזיר את האוסף לפי מזהה המסמך, שהוא מחרוזת אקראית.
        // בלי מיון מפורש ההצעות מופיעות בסדר שרירותי, והחדשה שנוצרה
        // הרגע נוחתת באמצע הרשימה. מיון קבוע מהחדש לישן, כמו במאגר.
        set({ proposals: snap.docs.map(withId).sort(byNewestFirst) });
      })
    );

    unsubs.push(
      onSnapshot(
        collection(crmDb, "serviceTypes"),
        (snap) => set({ serviceTypes: snap.docs.map(withId) }),
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(crmDb, "charges"),
        (snap) => set({ charges: snap.docs.map(withId) }),
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(crmDb, "emailLog"),
        (snap) => {
          const list = snap.docs.map(withId).sort((a, b) => new Date(b.date) - new Date(a.date));
          set({ emailLog: list });
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(crmDb, "termsAcceptances"),
        (snap) => {
          const map = {};
          snap.docs.forEach((d) => (map[d.id] = true));
          set({ termsAccepted: map });
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(crmDb, "telemetry"),
        (snap) => {
          const map = {};
          snap.docs.forEach((d) => (map[d.id] = d.data()));
          set({ telemetry: map });
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        doc(crmDb, "settings", "app"),
        (d) => {
          const data = d.exists() ? d.data() : {};
          set({
            termsText: data.termsText ?? DEFAULT_TERMS_TEXT,
            tips: data.tips ?? (data.dailyTip ? [data.dailyTip] : [DEFAULT_DAILY_TIP]),
            weeklyGoals: data.weeklyGoals ?? { profileViews: 20, audioPlays: 10 },
            professionals: Array.isArray(data.professionals) ? data.professionals : [],
            sheetImport: data.sheetImport ?? { csvUrl: "", mapping: {} },
          });
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        doc(crmDb, "userPrefs", email),
        (d) => {
          if (d.exists()) set({ favorites: d.data().favorites || {}, personalNotes: d.data().personalNotes || {} });
        },
        () => {}
      )
    );

    set({ _dataUnsubs: unsubs, _subscribedFor: email });
  },

  initCrmFirebase: () => {
    if (get()._initialized) return;
    set({ _initialized: true });

    // עוד לא הוגדר מסד נתונים למערכת: מציגים את מסך הכניסה במקום להמתין
    // לנצח לתשובה משרת שאינו קיים.
    if (!isFirebaseConfigured) {
      set({ authLoading: false, allowlistLoaded: true });
      return;
    }

    onAuthStateChanged(crmAuth, (user) => {
      if (user) {
        set({ googleUser: { email: user.email, name: user.displayName, picture: user.photoURL, uid: user.uid } });
        get().subscribeData(user);
      } else {
        get().unsubscribeData();
        set({
          googleUser: null,
          favorites: {},
          personalNotes: {},
          authAllowlist: [],
          allowlistLoaded: true,
          candidates: [],
          candidatesLoaded: false,
        });
      }
      get().recomputeRole();
      set({ authLoading: false });
    });
  },

  // --- משימות: נטענות בשאילתה שתלויה בהרשאה ---
  // מנהלת רואה את כל המשימות. אשת צוות מקבלת מהשרת אך ורק את המשימות
  // המשויכות אליה, כך שההגבלה אינה תלויה בסינון בצד הדפדפן.
  _tasksUnsub: null,
  _tasksKey: null,
  subscribeTasks: () => {
    const { role, currentStaffEmail, _tasksKey, _tasksUnsub } = get();
    if (role !== "admin" && role !== "staff") {
      if (_tasksUnsub) _tasksUnsub();
      set({ _tasksUnsub: null, _tasksKey: null, tasks: [] });
      return;
    }
    const key = role === "admin" ? "admin" : `staff:${currentStaffEmail || ""}`;
    if (key === _tasksKey) return;
    if (_tasksUnsub) _tasksUnsub();

    const ref =
      role === "admin"
        ? collection(crmDb, "tasks")
        : query(collection(crmDb, "tasks"), where("assigneeId", "==", normalizeEmail(currentStaffEmail) || "__none__"));

    const unsub = onSnapshot(
      ref,
      (snap) => set({ tasks: snap.docs.map(withId) }),
      () => set({ tasks: [] })
    );
    set({ _tasksUnsub: unsub, _tasksKey: key });
  },

  // מחיקת כרטיס היא פעולה בלתי הפיכה, ולכן היא נעולה לחשבון המנהלת הראשית
  // בלבד - ולא לכל מי שהוגדר/ה כמנהלת ברשימת ההרשאות.
  canDeleteCandidates: () => isBootstrapAdmin(get().googleUser?.email),

  // --- הרשאה: נקבעת אך ורק לפי כניסה עם גוגל + רשימת ההרשאות ב-Firestore ---
  googleUser: null,
  role: "viewer", // viewer (לא מחוברת) | unauthorized (מחוברת, לא ברשימה) | staff | admin
  currentStaffEmail: null,
  authAllowlist: [],
  allowlistLoaded: false,
  recomputeRole: () => {
    const { googleUser, authAllowlist } = get();
    if (!googleUser) {
      set({ role: "viewer", currentStaffEmail: null });
      return;
    }
    const myEmail = normalizeEmail(googleUser.email);

    // המנהלת הראשית היא תמיד מנהלת, בלי תלות ברשימת ההרשאות ולפניה.
    //
    // זה בדיוק מה שכללי האבטחה בשרת קובעים - שם isBootstrapAdmin() נבדק
    // ראשון בתוך isStaff() ו-isAdmin(). עד היום הצד הלקוח בדק זאת אחרון,
    // ורק כשלא נמצאה רשומה ברשימה: לכן רשומה שלה ברשימה כשגרירה הורידה
    // אותה ל"צוות" והוציאה אותה ממסכי הניהול, בזמן שהשרת עדיין ראה בה
    // מנהלת. הצד הלקוח והשרת אומרים מעכשיו את אותו דבר.
    //
    // ההגדרה גם מבטיחה שאי אפשר לנעול את המנהלת בטעות מחוץ למערכת דרך
    // עריכה ברשימת ההרשאות, ושתמיד אפשר להיכנס למערכת חדשה ולהקים אותה.
    if (isBootstrapAdmin(googleUser.email)) {
      set({ role: "admin", currentStaffEmail: null });
      get().subscribeTasks();
      // גם תיבת הבקשות - אחרת המנהלת הראשית שאינה רשומה ברשימת ההרשאות
      // רואה לוח בקשות ריק לנצח, כי המנוי אליו כלל לא נפתח
      get().subscribeRequests();
      return;
    }

    // אם קיימות כמה רשומות שמצטמצמות לאותה כתובת (למשל אחת עם אות גדולה
    // ואחת בלי, או רשומה כפולה שנוספה ידנית), רשומת המנהלת גוברת. קודם
    // נבחרה הרשומה הראשונה שהשרת החזיר, וזה נתן תוצאה מקרית.
    const matches = authAllowlist.filter((e) => allowlistEmail(e) === myEmail);
    const match = matches.find((e) => e.role === "admin") || matches[0];
    if (!match) {
      set({ role: "unauthorized", currentStaffEmail: null });
      return;
    }
    // ברירת מחדל "צוות" אם שדה ההרשאה חסר ברשומה (למשל רשומה שנוספה ידנית) -
    // כדי שאיש/אשת צוות לא ייתקע/תיתקע בחוץ, ובלי להעניק בטעות הרשאות מנהלת.
    const entryRole = match.role === "admin" ? "admin" : "staff";
    set({ role: entryRole, currentStaffEmail: entryRole === "staff" ? allowlistEmail(match) : null });
    get().subscribeTasks();
    get().subscribeRequests();
  },
  currentUser: () => {
    const { googleUser, role, authAllowlist } = get();
    if (!googleUser) return { name: "אורחת", email: "", picture: null, role: "viewer" };
    const myEmail = normalizeEmail(googleUser.email);
    const match = authAllowlist.find((e) => allowlistEmail(e) === myEmail);
    return {
      name: googleUser.name || match?.name || googleUser.email,
      email: googleUser.email,
      picture: googleUser.picture,
      role,
    };
  },
  staffList: () => get().authAllowlist.filter((e) => e.role === "staff"),
  signInWithGoogle: async () => {
    await signInWithPopup(crmAuth, googleProvider);
  },
  signOutGoogle: async () => {
    await signOut(crmAuth);
  },
  addAllowlistEntry: async (entry) => {
    // מזהה הרשומה חייב להיות זהה בדיוק לכתובת שאיתה נכנסים לגוגל - אחרת כללי האבטחה
    // בשרת לא יזהו את המשתמש/ת. לכן מנקים כאן רווחים ותווים נסתרים לפני השמירה.
    const email = normalizeEmail(entry.email);
    if (!email || !email.includes("@")) throw new Error("כתובת המייל אינה תקינה");
    await setDoc(doc(crmDb, "staffAllowlist", email), {
      name: String(entry.name || "").trim() || email,
      role: entry.role === "admin" ? "admin" : "staff",
      email,
      phone: entry.phone || null,
    });
    return email;
  },
  removeAllowlistEntry: async (email) => {
    await deleteDoc(doc(crmDb, "staffAllowlist", normalizeEmail(email)));
  },

  // --- נציג מלווה: איש הקשר בצוות לבירורים על מועמד/ת ---
  // כל הצוות רואה את כל המועמדים. הנציג המלווה הוא מי שמכיר את המועמד/ת אישית,
  // ואליו פונים שאר השדכניות כשהן שוקלות הצעה.
  contactStaffFor: (candidate) => {
    const email = normalizeEmail(candidate?.contactStaffEmail);
    if (!email) return null;
    return get().authAllowlist.find((e) => allowlistEmail(e) === email) || { email, name: email };
  },
  setContactStaff: async (candidateId, staffEmail) => {
    await updateDoc(doc(crmDb, "candidates", candidateId), {
      contactStaffEmail: staffEmail ? normalizeEmail(staffEmail) : null,
    });
  },
  // עריכת כרטיס והוספת הערות רגישות: מנהלת, או הנציג המלווה של אותו/ה מועמד/ת
  canEditCandidate: (candidate) => {
    const { role, currentStaffEmail } = get();
    if (role === "admin") return true;
    if (role !== "staff" || !candidate) return false;
    const assigned = normalizeEmail(candidate.contactStaffEmail);
    return !!assigned && assigned === normalizeEmail(currentStaffEmail);
  },
  // תיקון רשומה שנשמרה בעבר עם רווח/תו נסתר בכתובת: יוצר רשומה נקייה ומוחק את הפגומה.
  repairAllowlistEntry: async (entry) => {
    const clean = allowlistEmail(entry);
    if (!clean || clean === entry.id) return;
    await setDoc(doc(crmDb, "staffAllowlist", clean), {
      name: entry.name || clean,
      role: entry.role === "admin" ? "admin" : "staff",
      email: clean,
    });
    await deleteDoc(doc(crmDb, "staffAllowlist", entry.id));
  },

  // --- מועדפים (פר-משתמש, מסונכרן ל-Firestore כשמחוברים) ---
  favorites: {},
  toggleFavorite: (id) => {
    set((state) => ({ favorites: { ...state.favorites, [id]: !state.favorites[id] } }));
    const user = get().currentUser();
    if (user.email) {
      setDoc(doc(crmDb, "userPrefs", user.email.toLowerCase()), { favorites: get().favorites }, { merge: true }).catch(
        () => {}
      );
    }
  },
  isFavorite: (id) => !!get().favorites[id],

  // --- הערה אישית על מועמד/ת ---
  // נשמרת באותו מסמך פרטי של המשתמש/ת שבו נשמרים המועדפים, ולכן היא
  // גלויה אך ורק למי שכתב/ה אותה, ואינה דורשת כלל אבטחה חדש.
  personalNotes: {},
  personalNoteFor: (candidateId) => get().personalNotes[candidateId] || "",
  setPersonalNote: async (candidateId, text) => {
    const value = String(text || "").trim();
    const next = { ...get().personalNotes };
    if (value) next[candidateId] = value;
    else delete next[candidateId];
    set({ personalNotes: next });
    const user = get().currentUser();
    if (!user.email) return;
    await setDoc(
      doc(crmDb, "userPrefs", user.email.toLowerCase()),
      { personalNotes: next },
      { merge: true }
    ).catch(() => {});
  },
  favoritesCount: () => Object.values(get().favorites).filter(Boolean).length,

  // --- התראות (מקומי בלבד בשלב זה) ---
  notifications: [],
  markAllNotificationsRead: () =>
    set((state) => ({ notifications: state.notifications.map((n) => ({ ...n, read: true })) })),
  unreadCount: () => get().notifications.filter((n) => !n.read).length,
  notificationsEnabled: true,
  toggleNotificationsEnabled: () => set((state) => ({ notificationsEnabled: !state.notificationsEnabled })),

  // --- הודעת "נשמר בהצלחה" קופצת (Toast) ---
  toast: null,
  showToast: (message) => set({ toast: { id: Date.now(), message } }),
  clearToast: () => set({ toast: null }),

  // --- סיור ההדרכה: כפתור העזרה יושב בסרגל הכפתורים הצפים ומופיע בכל המסכים,
  // ואילו הסיור עצמו רץ ממקום אחד. המונה מסמן לסיור שהתבקשה הפעלה מחדש.
  tourTick: 0,
  requestTour: () => set((state) => ({ tourTick: state.tourTick + 1 })),

  // --- שאלון התאמות (מקומי, פר-מכשיר) ---
  quizAnswers: DEFAULT_QUIZ_ANSWERS,
  quizCompleted: false,
  setQuizAnswers: (partial) => set((state) => ({ quizAnswers: { ...state.quizAnswers, ...partial } })),
  completeQuiz: () => set({ quizCompleted: true }),
  resetQuiz: () => set({ quizCompleted: false }),

  // --- סינון בפיד ---
  filters: { ...DEFAULT_FILTERS },
  setFilters: (partial) => set((state) => ({ filters: { ...state.filters, ...partial } })),
  // סימון שתיבת החיפוש מולאה אוטומטית בעקבות כניסה לכרטיס מסוים ממסך אחר.
  // בלעדיו החיפוש נשאר "תקוע" על אותו שם וכל שאר המאגר נראה כאילו נעלם.
  searchFromLink: false,
  setSearchFromLink: (value) => set({ searchFromLink: value }),
  resetFilters: () =>
    set((state) => ({
      filters: { ...DEFAULT_FILTERS },
    })),

  // --- כרטיסיה פתוחה עם אזור פנימי ---
  expandedStaffAreaId: null,
  toggleStaffArea: (id) => set((state) => ({ expandedStaffAreaId: state.expandedStaffAreaId === id ? null : id })),

  // --- בחירת שני פרופילים להצעת התאמה ---
  proposalSelection: { male: null, female: null },
  clearProposalSelection: () => set({ proposalSelection: { male: null, female: null } }),
  setProposalSelection: (key, id) => set((state) => ({ proposalSelection: { ...state.proposalSelection, [key]: id || null } })),

  // --- הצעות שידוך ---
  proposals: [],
  // externals: { male, female } - מועמד/ת שאינו/ה במאגר ("מישהו מהמעגל שלי").
  // הפרטים נשמרים בתוך מסמך ההצעה בלבד, ובשום שלב לא נוצר מהם כרטיס במאגר.
  createProposal: async (maleId, femaleId, rationale = "", externals = {}) => {
    const author = get().currentUser().name;
    const now = new Date().toISOString();
    const clean = (e) =>
      e && e.name?.trim()
        ? {
            name: e.name.trim(),
            notes: (e.notes || "").trim(),
            audioUrl: e.audioUrl || null,
            // תמונה וטלפון לבירורים. חייבים להופיע כאן במפורש: הפונקציה
            // הזו בוררת שדות, וכל שדה שאינו מופיע בה נשמט בשקט.
            photoUrl: e.photoUrl || null,
            phone: (e.phone || "").trim(),
          }
        : null;
    const externalMale = clean(externals.male);
    const externalFemale = clean(externals.female);
    const proposal = {
      maleId: externalMale ? null : maleId,
      femaleId: externalFemale ? null : femaleId,
      externalMale,
      externalFemale,
      status: PROPOSAL_STAGES[0],
      createdAt: now,
      rationale,
      assignee: null,
      journal: [{ id: `j-${Date.now()}`, date: now, status: PROPOSAL_STAGES[0], note: "ההצעה נוצרה", author }],
    };
    const ref = await addDoc(collection(crmDb, "proposals"), proposal);
    await Promise.all([get().touchCandidate(proposal.maleId), get().touchCandidate(proposal.femaleId)]);
    get().clearProposalSelection();
    return { id: ref.id, ...proposal };
  },
  updateProposalStatus: async (proposalId, status, note) => {
    const author = get().currentUser().name;
    const now = new Date().toISOString();
    const proposal = get().proposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    const entry = { id: `j-${Date.now()}`, date: now, status, note: note || "", author };
    // ברגע שהצעה יורדת מהפרק שומרים ביומן גם את הרציונל כפי שהיה באותו רגע.
    // כך, אם ההצעה תחזור בעתיד ללוח, אפשר יהיה להראות בדיוק מה נכתב אז -
    // גם אם בינתיים מישהו/י ערכ/ה את הרציונל.
    if (status === PROPOSAL_DROPPED) entry.rationaleAtDrop = proposal.rationale || "";
    const journal = [...proposal.journal, entry];
    await updateDoc(doc(crmDb, "proposals", proposalId), { status, journal });
    await Promise.all([get().touchCandidate(proposal.maleId), get().touchCandidate(proposal.femaleId)]);
    if (status === PROPOSAL_STAGES[PROPOSAL_STAGES.length - 1]) {
      const male = get().findCandidateById(proposal.maleId);
      const female = get().findCandidateById(proposal.femaleId);
      get().sendMockEmailToAdmin(
        "הצעת שידוך הגיעה לאירוסין! 🎉",
        `${author} עדכנ/ה שההצעה בין ${male?.name || "?"} ל-${female?.name || "?"} הגיעה לשלב אירוסין.`
      );
    }
  },
  // החזרת הצעה שירדה מהפרק ללוח הפעיל.
  // חוזרים לשלב שבו ההצעה הייתה לפני הירידה, ומוסיפים רשומה ליומן - כדי
  // שההיסטוריה תישאר שלמה ושהכרטיס יציג את שלט האזהרה הצהוב.
  restoreProposal: async (proposalId) => {
    const proposal = get().proposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    const stage = stageBeforeDrop(proposal, PROPOSAL_DROPPED, PROPOSAL_STAGES);
    await get().updateProposalStatus(proposalId, stage, "ההצעה הוחזרה ללוח הפעיל מתוך ההיסטוריה");
  },
  // עריכת כרטיס מקוצר ("מהמעגל האישי") אחרי שההצעה כבר הוקמה.
  //
  // פתוחה לכל אנשי הצוות ובכל זמן, כדי שאפשר יהיה להעביר טיפול בין
  // שדכנים בלי שמי שמקבל/ת את התיק ייתקע/תיתקע בלי הרשאת עריכה.
  // side הוא "male" או "female" - הצד שבו יושב הכרטיס המקוצר.
  updateProposalExternal: async (proposalId, side, data) => {
    const field = side === "male" ? "externalMale" : "externalFemale";
    const name = String(data?.name || "").trim();
    if (!name) throw new Error("לכרטיס המקוצר חייב להיות שם");
    await updateDoc(doc(crmDb, "proposals", proposalId), {
      [field]: {
        name,
        notes: String(data.notes || "").trim(),
        audioUrl: data.audioUrl || null,
        photoUrl: data.photoUrl || null,
        phone: String(data.phone || "").trim(),
      },
    });
  },
  updateProposalRationale: async (proposalId, rationale) => {
    await updateDoc(doc(crmDb, "proposals", proposalId), { rationale });
  },
  // שומרים גם את כתובת המייל של המשויך/ת, ולא רק את השם. השם הוא שם
  // החשבון בגוגל, ושתי אנשי צוות יכולות להיקרא אותו דבר - בלי המייל אי
  // אפשר לדעת בוודאות של מי התיק, וזו בדיוק השאלה שקובעת מי רשאי/ת
  // לשחרר אותו. הצעות ותיקות שנשמרו בלי מייל ממשיכות להיבדק לפי השם.
  assignProposal: async (proposalId, assignee, assigneeEmail = null) => {
    await updateDoc(doc(crmDb, "proposals", proposalId), { assignee, assigneeEmail });
  },
  assignProposalToSelf: async (proposalId) => {
    const me = get().currentUser();
    await get().assignProposal(proposalId, me.name, (me.email || "").trim().toLowerCase() || null);
  },
  deleteProposal: async (proposalId) => {
    await deleteDoc(doc(crmDb, "proposals", proposalId));
  },
  // סימון "טופל עכשיו" בלי לשנות שום שדה אחר. נקרא מפעולות שמתבצעות מחוץ
  // לכרטיס (פתיחת הצעה, עדכון שלב). כישלון כאן לעולם לא יפיל את הפעולה עצמה.
  touchCandidate: async (id) => {
    if (!id) return;
    try {
      await updateDoc(doc(crmDb, "candidates", id), { lastTouchedAt: serverTimestamp() });
    } catch {
      // לא קריטי - הפעילות ממילא נגזרת גם מהיומן של ההצעה
    }
  },
  proposalsForCandidate: (candidateId) =>
    get().proposals.filter((p) => p.maleId === candidateId || p.femaleId === candidateId),

  // --- מועמדים (Firestore, כולל תעודת זהות ורשימת חסימת נציגות) ---
  // סטטוס פניות נשמר באוסף נפרד וציבורי (candidateStatus) כדי שקישור העדכון האישי של המועמד/ת
  // (ללא התחברות) לא ייתן גישה לשאר פרטי הכרטיס החסויים - ראו כללי האבטחה ב-Firestore.
  candidates: [],
  candidatesLoaded: false,
  candidateStatus: {},
  setCandidateAvailability: async (id, status) => {
    await setDoc(doc(crmDb, "candidateStatus", id), { availabilityStatus: status }, { merge: true });
  },
  addCandidate: async (candidate) => {
    const data = {
      traits: [],
      occupations: [],
      currentOccupation: "",
      isNew: true,
      isPrevious: false,
      matchScore: 70,
      gradient: Math.floor(Math.random() * 8),
      staffNote: "",
      adminNote: "",
      voiceNotes: [],
      availabilityStatus: "פנוי",
      complexityNotes: "",
      pdfUrl: null,
      introAudioUrl: null,
      photoUrl: null,
      photoUrls: [],
      city: "",
      referenceContacts: "",
      confidential: false,
      blockedStaffEmails: [],
      createdAt: new Date().toISOString(),
      ...candidate,
    };
    const ref = await addDoc(collection(crmDb, "candidates"), stripUndefined(data));
    await setDoc(doc(crmDb, "candidateStatus", ref.id), {
      name: data.name,
      availabilityStatus: data.availabilityStatus,
    });
    // מפתח החיפוש לטופס החיצוני. עוטף בשקט: כישלון כאן לא יפיל הוספת מועמד/ת.
    await get().indexCandidateName(ref.id, data.name);

    // מכסת "הצעות חדשות": עד 10 בו-זמנית לכל מאגר (בנים/בנות בנפרד). כל מי שמעבר
    // ל-10 העדכניים נדחף אוטומטית ל"הצעות קודמות" - כך גם כרטיסים ותיקים שנוצרו
    // לפני שהמכסה הונהגה מתיישרים לבד עם ההוספה הבאה.
    const newest = get()
      .candidates.filter((c) => c.gender === data.gender && c.isNew && c.id !== ref.id)
      .concat([{ id: ref.id, ...data }])
      .sort(byNewestFirst);

    await Promise.all(
      newest
        .slice(NEW_TAB_LIMIT)
        .map((c) => updateDoc(doc(crmDb, "candidates", c.id), { isNew: false, isPrevious: true }))
    );

    return { id: ref.id, ...data };
  },
  updateCandidate: async (id, partial) => {
    // חותמת "טופל" נכתבת על ידי השרת עצמו, כדי ששעון שגוי במכשיר לא יוכל
    // "להזקין" או "להצעיר" כרטיס. היא מתווספת אחרי הניקוי ולא לפניו:
    // serverTimestamp הוא אובייקט מיוחד של Firestore, והניקוי היה הורס אותו.
    await updateDoc(doc(crmDb, "candidates", id), {
      ...stripUndefined(partial),
      lastTouchedAt: serverTimestamp(),
    });
    // שינוי שם מחייב עדכון גם של מפתח החיפוש הציבורי, אחרת מועמד/ת ששמו/ה
    // תוקן לא יימצא/תימצא בטופס החיצוני. כישלון כאן לעולם אינו מפיל את השמירה.
    if (partial && typeof partial.name === "string") {
      await get().indexCandidateName(id, partial.name);
    }
  },

  // --- פניות מהטופס החיצוני (/register) ---
  // הטופס פתוח לכל אחד ואינו כותב למאגר המועמדים: הוא מפקיד את הפנייה
  // באוסף נפרד. המנהלת היא שמאשרת ויוצרת ממנה כרטיס, וכך המאגר נשאר
  // סגור לכתיבה מבחוץ.
  intakeSubmissions: [],
  intakeLoaded: false,
  intakeError: false,
  pendingIntake: () =>
    get()
      .intakeSubmissions.filter((x) => (x.status || "pending") === "pending")
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),

  // אישור פנייה: יוצר כרטיס מלא במאגר ומסמן את הפנייה כטופלה.
  approveIntake: async (item) => {
    // התמונה מגיעה מהטופס כמחרוזת בתוך מסמך הפנייה, כי הטופס הציבורי אינו
    // מורשה לכתוב לאוסף המדיה. כאן, בהרשאות של הצוות, היא נשמרת כמדיה
    // רגילה בדיוק כמו תמונה שהועלתה מתוך המערכת - וכך כרטיס המועמד/ת
    // אינו נושא איתו מחרוזת ענקית. כישלון בשמירת התמונה לא יבטל את
    // יצירת הכרטיס: עדיף כרטיס בלי תמונה על פנייה שנתקעת.
    let photoRef = null;
    if (typeof item.photo === "string" && item.photo.startsWith("data:")) {
      try {
        const { dataUrlToFile } = await import("./imageCompress");
        const { saveMedia } = await import("./mediaStore");
        photoRef = await saveMedia(dataUrlToFile(item.photo, `${item.name || "photo"}.jpg`));
      } catch {
        photoRef = null;
      }
    }

    const candidate = await get().addCandidate({
      gender: item.gender === "male" ? "male" : "female",
      name: String(item.name || "").trim(),
      age: item.age ?? null,
      height: item.height ?? null,
      eda: item.eda || "",
      region: item.region || REGIONS[0],
      city: item.city || "",
      religiousLevel: item.religiousLevel || null,
      currentOccupation: item.currentOccupation || "",
      occupations: Array.isArray(item.occupations) ? item.occupations : [],
      phone: item.phone || "",
      bio: item.bio || "",
      referenceContacts: item.referenceContacts || "",
      photoUrl: photoRef,
      photoUrls: photoRef ? [photoRef] : [],
      // מקור הכרטיס נשמר, כדי שיהיה ברור שהוא הגיע מהטופס החיצוני
      source: "register-form",
    });
    await updateDoc(doc(crmDb, "intakeSubmissions", item.id), {
      status: "converted",
      candidateId: candidate.id,
      convertedAt: new Date().toISOString(),
    });
    return candidate;
  },

  rejectIntake: async (id) => {
    await updateDoc(doc(crmDb, "intakeSubmissions", id), {
      status: "rejected",
      rejectedAt: new Date().toISOString(),
    });
  },

  // --- מפתח חיפוש לפי שם, עבור הטופס החיצוני ---
  // מסמך אחד לכל שם, שהמזהה שלו נגזר מהשם. כך העמוד הציבורי בודק שם מדויק
  // אחד בלבד ואינו יכול לסרוק את המאגר. ראו lib/crm/nameKey.js.
  indexCandidateName: async (candidateId, name) => {
    const keys = nameKeys(name);
    if (keys.length === 0 || !candidateId) return;
    await Promise.all(
      keys.map((key) =>
        setDoc(doc(crmDb, "nameIndex", key), { candidateId, name: String(name).trim() }, { merge: true }).catch(
          () => {}
        )
      )
    );
  },

  // בנייה חד-פעמית של המפתח לכל הכרטיסים הוותיקים, כדי שגם מי שנרשם לפני
  // שהטופס היה קיים יימצא בו. כתיבת בדיקה אחת קודמת לכל השאר: אם היא נחסמת,
  // סימן שכללי האבטחה טרם פורסמו - ואז מדווחים על כך במפורש ולא נכשלים בשקט.
  _nameIndexDone: false,
  nameIndexState: "idle", // idle | running | done | denied
  backfillNameIndex: async () => {
    if (get().role !== "admin" || get()._nameIndexDone) return 0;
    const list = get().candidates.filter((c) => nameKeys(c.name).length > 0);
    if (list.length === 0) return 0;
    set({ _nameIndexDone: true, nameIndexState: "running" });
    try {
      const first = list[0];
      await setDoc(doc(crmDb, "nameIndex", nameKeys(first.name)[0]), {
        candidateId: first.id,
        name: String(first.name).trim(),
      });
    } catch {
      set({ nameIndexState: "denied", _nameIndexDone: false });
      return 0;
    }
    await Promise.all(list.map((c) => get().indexCandidateName(c.id, c.name)));
    set({ nameIndexState: "done" });
    return list.length;
  },
  // מחיקת כרטיס מועמד/ת. מותרת למנהלת בלבד, וכך גם נאכף בכללי האבטחה בשרת.
  // נמחקת גם רשומת הסטטוס הציבורית, שאם לא כן שם המועמד/ת היה נשאר נגיש
  // דרך הקישור האישי גם אחרי המחיקה.
  deleteCandidate: async (id) => {
    await deleteDoc(doc(crmDb, "candidates", id));
    try {
      await deleteDoc(doc(crmDb, "candidateStatus", id));
    } catch {
      // רשומת הסטטוס אינה קיימת לכל כרטיס, ולכן כישלון כאן אינו שגיאה
    }
  },
  // מאזין ציבורי חד-פעמי לכרטיס סטטוס יחיד - לשימוש בעמוד הקישור האישי (ללא התחברות),
  // ולכן לא נוגע כלל באוסף candidates החסוי אלא רק בשם ובסטטוס הפניות שנשמרים בנפרד.
  subscribeCandidateStatus: (id, callback) =>
    onSnapshot(doc(crmDb, "candidateStatus", id), (d) => {
      callback(d.exists() ? { id, ...d.data() } : null);
    }),
  allCandidates: (board) => {
    const { candidates, role, currentStaffEmail, candidateStatus } = get();
    return candidates
      .filter((c) => c.gender === board)
      .filter((c) => role !== "staff" || !(c.blockedStaffEmails || []).includes(currentStaffEmail))
      .filter((c) => role !== "staff" || !c.confidential)
      .map((c) => ({ ...c, availabilityStatus: candidateStatus[c.id] || c.availabilityStatus }))
      // הכרטיס החדש ביותר תמיד ראשון בלוח - כדי שמי שהרגע הוסיפה תראה אותו מיד
      .sort(byNewestFirst);
  },
  // --- תיבת בקשות חסויה ---
  // אשת צוות יכולה להגיש בקשה עבור מועמד/ת, אך אינה רואה את הלוח הכללי.
  // רק המנהלת רואה את כל הבקשות במרוכז ומחליטה למי לשייך כל אחת.
  requests: [],
  _requestsUnsub: null,
  _requestsKey: null,
  subscribeRequests: () => {
    const { role, _requestsKey, _requestsUnsub } = get();
    // לצוות אין כלל מנוי - הן אינן רואות את הלוח, רק מגישות אליו
    if (role !== "admin") {
      if (_requestsUnsub) _requestsUnsub();
      set({ _requestsUnsub: null, _requestsKey: null, requests: [] });
      return;
    }
    if (_requestsKey === "admin") return;
    if (_requestsUnsub) _requestsUnsub();
    const unsub = onSnapshot(
      collection(crmDb, "staffRequests"),
      (snap) => {
        const list = snap.docs.map(withId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        set({ requests: list });
      },
      () => set({ requests: [] })
    );
    set({ _requestsUnsub: unsub, _requestsKey: "admin" });
  },
  addRequest: async ({ candidateId, kind, note }) => {
    const user = get().currentUser();
    const candidate = candidateId ? get().findCandidateById(candidateId) : null;
    await addDoc(collection(crmDb, "staffRequests"), {
      candidateId: candidateId || null,
      candidateName: candidate?.name || null,
      kind: kind || "",
      note: (note || "").trim(),
      status: "חדש",
      createdBy: normalizeEmail(user.email),
      createdByName: user.name,
      createdAt: new Date().toISOString(),
    });
  },
  updateRequest: async (id, patch) => {
    await updateDoc(doc(crmDb, "staffRequests", id), patch);
  },
  deleteRequest: async (id) => {
    await deleteDoc(doc(crmDb, "staffRequests", id));
  },

  // --- מבחן ההתאמות: דירוג מועמדים לפי התשובות בשאלון ---
  // הציון הוא אחוז הקריטריונים שנענו, מתוך אלה שהוגדרו בפועל בשאלון.
  // קריטריון שנבחר בו "הכל" או "לא משנה" אינו נספר כלל.
  quizMatches: (board) => {
    const a = get().quizAnswers;
    const list = get().allCandidates(board);

    return list
      .map((c) => {
        const checks = [];

        if (a.ageRange) checks.push(c.age >= a.ageRange[0] && c.age <= a.ageRange[1]);
        if (a.heightRange) checks.push(c.height >= a.heightRange[0] && c.height <= a.heightRange[1]);
        if (a.religiousLevel && a.religiousLevel !== "הכל") checks.push(c.religiousLevel === a.religiousLevel);

        const regions = (a.regions || []).filter((r) => r !== "לא משנה");
        if (regions.length) checks.push(regions.includes(c.region));

        // עיסוק ורקע: בחירה מרובה. כל תגית שנבחרה בשאלון נבדקת בנפרד מול כל
        // התגיות שסומנו בכרטיס - כך "מחפשת מישהו עם תואר ראשון או צבא" מוצאת
        // גם את מי שסימן את שניהם, וגם את מי שסימן רק אחד מהם (התאמה חלקית).
        const wantedOccupations = (a.occupations || []).filter((t) => t !== "לא משנה");
        if (wantedOccupations.length) {
          const has = occupationsOf(c);
          wantedOccupations.forEach((t) => checks.push(has.includes(t)));
        }
        if (a.smoking && a.smoking !== "לא משנה") checks.push(c.smoking === a.smoking);

        // סגנון חיים והשקפה: כל תגית שנבחרה נספרת בנפרד, כך שהתאמה חלקית
        // עדיין מקדמת את המועמד/ת ברשימה במקום לפסול אותו/ה לגמרי.
        // "לא משנה" מבטל את הסינון לפי סגנון חיים ואינו נבדק כתגית
        const wantedTags = (a.lifestyle || []).filter((t) => t !== "לא משנה");
        const candidateTags = c.lifestyle || [];
        wantedTags.forEach((t) => checks.push(candidateTags.includes(t)));

        (a.traits || []).forEach((t) => checks.push((c.traits || []).includes(t)));

        const score = checks.length
          ? Math.round((checks.filter(Boolean).length / checks.length) * 100)
          : 100;
        return { ...c, matchScore: score };
      })
      .sort((x, y) => y.matchScore - x.matchScore);
  },

  findCandidateById: (id) => {
    const { candidates, role, currentStaffEmail, candidateStatus } = get();
    const c = candidates.find((c) => c.id === id);
    if (!c) return undefined;
    if (role === "staff" && (c.blockedStaffEmails || []).includes(currentStaffEmail)) return undefined;
    if (role === "staff" && c.confidential) return undefined;
    return { ...c, availabilityStatus: candidateStatus[c.id] || c.availabilityStatus };
  },

  // --- משימות ---
  tasks: [],
  toggleTaskDone: async (id) => {
    const t = get().tasks.find((t) => t.id === id);
    if (!t) return;
    await updateDoc(doc(crmDb, "tasks", id), { done: !t.done });
  },
  addTask: async (task) => {
    // משימה שאשת צוות פותחת לעצמה משויכת אליה, אחרת היא לא תופיע אצלה כלל
    // (השרת מחזיר לצוות רק משימות שמשויכות אליהן).
    const { role, currentStaffEmail } = get();
    const assigneeId = normalizeEmail(task.assigneeId ?? (role === "staff" ? currentStaffEmail : null)) || null;
    await addDoc(collection(crmDb, "tasks"), {
      done: false,
      createdAt: new Date().toISOString(),
      assigneeId,
      ...task,
    });
  },
  pushTaskToStaff: async (title, dueDate, assigneeEmail, candidateId = null, details = null) => {
    // כתובת השיוך נשמרת תמיד בצורה מנוקה, כי כללי האבטחה משווים אותה מול
    // כתובת הכניסה לגוגל. רווח נסתר או תו כיווניות היה גורם לאשת הצוות
    // לא לראות את המשימה כלל, בלי שום הודעת שגיאה.
    const assigneeId = normalizeEmail(assigneeEmail);
    const assignee = get().authAllowlist.find((e) => allowlistEmail(e) === assigneeId);
    const candidate = candidateId ? get().findCandidateById(candidateId) : null;
    await addDoc(collection(crmDb, "tasks"), {
      title,
      details: details || null,
      dueDate: dueDate || null,
      done: false,
      owner: assignee?.name || "לא משויך",
      assigneeId,
      candidateId,
      candidateName: candidate?.name || null,
      pushedByAdmin: true,
      seenByAssignee: false,
      createdAt: new Date().toISOString(),
    });
  },
  markTasksSeenByStaff: async (staffEmail) => {
    const unseen = get().tasks.filter((t) => t.assigneeId === staffEmail && !t.seenByAssignee);
    await Promise.all(unseen.map((t) => updateDoc(doc(crmDb, "tasks", t.id), { seenByAssignee: true })));
  },
  pendingPushedTasksCount: (staffEmail) =>
    get().tasks.filter((t) => t.assigneeId === staffEmail && t.pushedByAdmin && !t.seenByAssignee && !t.done).length,

  // --- מעקב שקט (טלמטריה) - רק כשמחוברים כ-staff ---
  telemetry: {},
  weeklyGoals: { profileViews: 20, audioPlays: 10 },
  setWeeklyGoals: async (goals) => {
    await setDoc(doc(crmDb, "settings", "app"), { weeklyGoals: { ...get().weeklyGoals, ...goals } }, { merge: true });
  },
  // המונים נשמרים יחד עם מזהה השבוע שאליו הם שייכים. ספירה בשבוע חדש
  // מתחילה מאחת ולא מתווספת לישן, ולכן אין צורך בשום משימת איפוס.
  _bumpWeekly: async (field) => {
    const { role, currentStaffEmail, telemetry } = get();
    if (role !== "staff" || !currentStaffEmail) return;
    const week = weekKey();
    const entry = telemetry[currentStaffEmail];
    const current = entry?.week === week ? entry[field] || 0 : 0;
    await setDoc(
      doc(crmDb, "telemetry", currentStaffEmail),
      { week, [field]: current + 1 },
      { merge: true }
    );
  },
  trackProfileView: async () => get()._bumpWeekly("profileViews"),
  trackAudioPlay: async () => get()._bumpWeekly("audioPlays"),

  // קריאת המדדים של איש/אשת צוות לשבוע הנוכחי בלבד. רשומה משבוע קודם
  // נקראת כאפס - וזה האיפוס עצמו, שמתבצע בזמן התצוגה.
  weeklyTelemetryFor: (email) => {
    const entry = get().telemetry[email];
    return {
      profileViews: weeklyValue(entry, "profileViews"),
      audioPlays: weeklyValue(entry, "audioPlays"),
    };
  },

  // --- שער תקנון סודיות ---
  termsText: DEFAULT_TERMS_TEXT,
  setTermsText: async (text) => {
    await setDoc(doc(crmDb, "settings", "app"), { termsText: text }, { merge: true });
  },
  termsAccepted: {},
  acceptTerms: async (staffEmail) => {
    await setDoc(doc(crmDb, "termsAcceptances", staffEmail), { acceptedAt: new Date().toISOString() });
    const staff = get().authAllowlist.find((e) => e.email === staffEmail);
    get().sendMockEmailToAdmin("אישור תקנון סודיות", `${staff?.name || staffEmail} אישר/ה את תקנון הסודיות.`);
  },

  // --- טיפים לצוות (אפשר כמה, גלילה בין הכרטיסים) ---
  tips: [DEFAULT_DAILY_TIP],
  addTip: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await setDoc(doc(crmDb, "settings", "app"), { tips: [...get().tips, trimmed] }, { merge: true });
  },
  removeTip: async (index) => {
    const next = get().tips.filter((_, i) => i !== index);
    await setDoc(doc(crmDb, "settings", "app"), { tips: next }, { merge: true });
  },

  // --- סנכרון מגיליון Google Sheets ---
  // הכתובת והמיפוי נשמרים במסמך ההגדרות הקיים, ולכן אין צורך בכלל אבטחה חדש.
  sheetImport: { csvUrl: "", mapping: {} },
  setSheetImportConfig: async (config) => {
    await setDoc(
      doc(crmDb, "settings", "app"),
      { sheetImport: { ...get().sheetImport, ...config } },
      { merge: true }
    );
  },
  // --- מאגר אנשי מקצוע חיצוניים (מאמנים ומלווים) ---
  // נשמר כרשימה בתוך מסמך ההגדרות הקיים, ולכן אינו דורש כלל אבטחה חדש:
  // המנהלת כותבת, והצוות יכול לקרוא.
  professionals: [],
  addProfessional: async (entry) => {
    const clean = {
      id: `pro-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: String(entry.name || "").trim(),
      role: String(entry.role || "").trim(),
      location: String(entry.location || "").trim(),
      phone: String(entry.phone || "").trim(),
    };
    if (!clean.name) return;
    await setDoc(doc(crmDb, "settings", "app"), { professionals: [...get().professionals, clean] }, { merge: true });
  },
  updateProfessional: async (id, patch) => {
    const next = get().professionals.map((p) =>
      p.id === id
        ? {
            ...p,
            ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v || "").trim()])),
            id: p.id,
          }
        : p
    );
    await setDoc(doc(crmDb, "settings", "app"), { professionals: next }, { merge: true });
  },
  removeProfessional: async (id) => {
    const next = get().professionals.filter((p) => p.id !== id);
    await setDoc(doc(crmDb, "settings", "app"), { professionals: next }, { merge: true });
  },

  // --- יומן מיילים (הדגמה - עדיין לא חיבור אמיתי לשליחת מייל) ---
  emailLog: [],
  sendMockEmailToAdmin: async (subject, body) => {
    const adminEntry = get().authAllowlist.find((e) => e.role === "admin");
    await addDoc(collection(crmDb, "emailLog"), {
      to: adminEntry?.email || "",
      subject,
      body,
      date: new Date().toISOString(),
    });
  },

  // --- ניהול כספים ותשלומים - admin בלבד ---
  serviceTypes: [],
  addServiceType: async (service) => {
    await addDoc(collection(crmDb, "serviceTypes"), service);
  },
  removeServiceType: async (id) => {
    await deleteDoc(doc(crmDb, "serviceTypes", id));
  },
  charges: [],
  createCharge: async (candidateId, serviceTypeId, staffEmail) => {
    const service = get().serviceTypes.find((s) => s.id === serviceTypeId);
    if (!service) return null;
    const charge = {
      candidateId,
      serviceTypeId,
      serviceName: service.name,
      staffId: staffEmail,
      price: service.price,
      commission: service.commission,
      candidatePaymentStatus: "ממתין לתשלום",
      candidatePaymentProofUrl: null,
      staffPayoutStatus: "ממתין לתשלום",
      staffPayoutProofUrl: null,
      createdAt: new Date().toISOString(),
      candidatePaidAt: null,
      staffPaidAt: null,
    };
    const ref = await addDoc(collection(crmDb, "charges"), charge);
    return { id: ref.id, ...charge };
  },
  updateChargeCandidatePayment: async (chargeId, status, proofUrl) => {
    const patch = { candidatePaymentStatus: status };
    if (status === "שולם") patch.candidatePaidAt = new Date().toISOString();
    if (proofUrl !== undefined) patch.candidatePaymentProofUrl = proofUrl;
    await updateDoc(doc(crmDb, "charges", chargeId), patch);
  },
  updateChargeStaffPayout: async (chargeId, status, proofUrl) => {
    const patch = { staffPayoutStatus: status };
    if (status === "שולם") patch.staffPaidAt = new Date().toISOString();
    if (proofUrl !== undefined) patch.staffPayoutProofUrl = proofUrl;
    await updateDoc(doc(crmDb, "charges", chargeId), patch);
  },
  openCandidateDebt: () =>
    get()
      .charges.filter((c) => c.candidatePaymentStatus !== "שולם")
      .reduce((sum, c) => sum + c.price, 0),
  pendingStaffCommission: () =>
    get()
      .charges.filter((c) => c.staffPayoutStatus !== "שולם")
      .reduce((sum, c) => sum + c.commission, 0),
}));
