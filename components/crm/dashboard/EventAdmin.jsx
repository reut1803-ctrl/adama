"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays, Users, Sparkles, Phone, MessageCircle, AlertTriangle, Link2, Check,
  Settings2, ChevronDown, Video, MapPin, ImagePlus, Trash2, Loader2, Navigation,
} from "lucide-react";
import { useCrmStore } from "@/lib/crm/store";
import {
  EVENT, subscribeEvent, loadEventSettings, resolveEvent,
  saveEventSettings, saveEventPhoto, removeEventPhoto,
} from "@/lib/crm/eventStore";
import { compressToDataUrl } from "@/lib/crm/imageCompress";
import { waDigits } from "@/components/crm/profiles/ProfileCard";
import { prettyPhone } from "@/components/crm/ui/CopyStaffButton";

// אזור המפגש בלוח הבקרה: מי נרשם, ואילו לידים נאספו מהדף.
// רכיב עצמאי שקורא אך ורק משני האוספים החדשים.

export default function EventAdmin() {
  const role = useCrmStore((s) => s.role);
  const showToast = useCrmStore((s) => s.showToast);
  const [tab, setTab] = useState("rsvps");
  const [rsvps, setRsvps] = useState([]);
  const [leads, setLeads] = useState([]);
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ev, setEv] = useState(EVENT);
  const [reload, setReload] = useState(0);
  const [onlyCurrent, setOnlyCurrent] = useState(true);

  // פרטי האירוע הנוכחיים, כפי שהם מוצגים בדף הנחיתה
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { settings, photos } = await loadEventSettings();
        if (alive) setEv(resolveEvent(settings, photos));
      } catch {
        // נשארים עם ברירת המחדל
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(() => {
    if (role !== "admin" && role !== "staff") return undefined;
    return subscribeEvent((key, rows) => {
      if (rows === null) return setBlocked(true);
      if (key === "rsvps") setRsvps(rows);
      else setLeads(rows);
    });
  }, [role]);

  if (role !== "admin" && role !== "staff") return null;

  const link = typeof window !== "undefined" ? `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/adama-event` : "";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      showToast("הקישור הועתק");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("ההעתקה נכשלה");
    }
  };

  // רשומות מאירועים קודמים נשמרות במאגר ואינן נמחקות לעולם,
  // אבל כברירת מחדל מוצג רק האירוע הפעיל כדי שהמסך יישאר נקי.
  const ofCurrent = (r) => (r.eventId || EVENT.id) === ev.id;
  const shownRsvps = onlyCurrent ? rsvps.filter(ofCurrent) : rsvps;
  const shownLeads = onlyCurrent ? leads.filter(ofCurrent) : leads;
  const hidden = rsvps.length - shownRsvps.length + (leads.length - shownLeads.length);

  const fmt = (iso) => {
    try { return new Date(iso).toLocaleDateString("he-IL"); } catch { return ""; }
  };

  return (
    <section className="mt-4 rounded-3xl border border-[#CCBDAB] bg-white p-4 shadow-[0_4px_18px_rgba(58,51,53,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-[#3A2E26]">
            <CalendarDays size={17} className="text-[#844442]" /> {ev.title}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#7C6E60]">
            {ev.dateLabel} · {ev.dateShort} · {ev.time} · {ev.place}
          </p>
          {ev.mode === "place" && ev.navUrl && (
            <a
              href={ev.navUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-bold text-[#62826B]"
            >
              <Navigation size={12} /> ניווט ב-Waze
            </a>
          )}
        </div>
        <button
          onClick={copyLink}
          className="flex shrink-0 items-center gap-1 rounded-xl border border-[#CCBDAB] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#844442] transition active:scale-95"
        >
          {copied ? <Check size={12} /> : <Link2 size={12} />} {copied ? "הועתק" : "קישור לשיתוף"}
        </button>
      </div>

      {blocked && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-[#FDF6E7] px-3 py-2.5 text-[12px] leading-relaxed text-[#7A5A18]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          הקריאה לאוספי האירוע נחסמה. צריך להדביק את כללי האבטחה של
          <span className="font-bold"> event_rsvps </span> ו
          <span className="font-bold"> event_leads </span>
          בקונסולת Firebase. עד אז הדף לא ישמור ולא יוצג כאן מידע.
        </p>
      )}

      {role === "admin" && <EventSettings onSaved={() => setReload((n) => n + 1)} />}

      <div className="mt-3 flex rounded-2xl border border-[#CCBDAB] bg-[#F5EFE6] p-1">
        {[
          ["rsvps", "נרשמו למפגש", shownRsvps.length, Users],
          ["leads", "לידים חדשים", shownLeads.length, Sparkles],
        ].map(([id, label, n, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[12.5px] font-bold transition ${
              tab === id ? "bg-white text-[#844442] shadow-sm" : "text-[#7C6E60]"
            }`}
          >
            <Icon size={14} /> {label}
            <span className={`rounded-full px-1.5 text-[11px] ${tab === id ? "bg-[#F0E2DE]" : "bg-white"}`}>{n}</span>
          </button>
        ))}
      </div>

      {hidden > 0 && (
        <button
          onClick={() => setOnlyCurrent(false)}
          className="mt-2 w-full rounded-xl bg-[#F5EFE6] px-3 py-2 text-[11.5px] font-semibold text-[#7C6E60] transition active:scale-[0.99]"
        >
          {hidden} רשומות מאירועים קודמים מוסתרות · להצגת הכול
        </button>
      )}
      {!onlyCurrent && (
        <button
          onClick={() => setOnlyCurrent(true)}
          className="mt-2 w-full rounded-xl bg-[#F5EFE6] px-3 py-2 text-[11.5px] font-semibold text-[#7C6E60] transition active:scale-[0.99]"
        >
          מוצגים כל האירועים · חזרה לאירוע הנוכחי בלבד
        </button>
      )}

      <div className="mt-3 space-y-2">
        {tab === "rsvps" &&
          (shownRsvps.length === 0 ? (
            <Empty>עדיין אין נרשמים. שתפי את הקישור כדי להתחיל.</Empty>
          ) : (
            shownRsvps.map((r) => (
              <Row key={r.id} title={r.name} meta={fmt(r.createdAt)} phone={r.phone} />
            ))
          ))}

        {tab === "leads" &&
          (shownLeads.length === 0 ? (
            <Empty>עדיין לא נאספו לידים מהדף.</Empty>
          ) : (
            shownLeads.map((l) => (
              <Row
                key={l.id}
                title={l.name}
                meta={`${fmt(l.createdAt)}${l.ownerName ? ` · הביא/ה: ${l.ownerName}` : ""}`}
                phone={l.phone}
                note={l.note}
              />
            ))
          ))}
      </div>
    </section>
  );
}


/* ───────────────────── הגדרות האירוע (למנהלת בלבד) ───────────────────── */

const EMPTY_SETTINGS = {
  title: "",
  tagline: "",
  bring: "",
  dateLabel: "",
  dateShort: "",
  time: "",
  mode: "zoom",
  zoomUrl: "",
  placeName: "",
  address: "",
  wazeUrl: "",
};

function EventSettings({ onSaved }) {
  const showToast = useCrmStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_SETTINGS);
  const [photos, setPhotos] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    (async () => {
      const { settings, photos: ph } = await loadEventSettings();
      if (!alive) return;
      const base = resolveEvent(settings, ph);
      setForm({
        title: base.title,
        tagline: base.tagline,
        bring: base.bring,
        dateLabel: base.dateLabel,
        dateShort: base.dateShort,
        time: base.time,
        mode: base.mode,
        zoomUrl: base.zoomUrl,
        placeName: base.placeName,
        address: base.address,
        wazeUrl: base.wazeUrl,
      });
      setPhotos(ph || {});
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [open, loaded]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setErr("");
    if (form.dateShort.trim().length < 3) return setErr("צריך למלא תאריך, למשל 21.11");
    if (form.time.trim().length < 3) return setErr("צריך למלא שעה, למשל 20:45");
    if (form.mode === "place" && !form.placeName.trim() && !form.address.trim())
      return setErr("במפגש פיזי צריך שם מקום או כתובת");
    setBusy(true);
    try {
      await saveEventSettings(form);
      showToast("הגדרות האירוע נשמרו");
      if (onSaved) onSaved();
    } catch {
      setErr("השמירה נכשלה. אם זה חוזר, צריך לרענן ולנסות שוב.");
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (slot, file) => {
    if (!file) return;
    setErr("");
    setBusy(true);
    try {
      const dataUrl = await compressToDataUrl(file);
      await saveEventPhoto(slot, dataUrl);
      setPhotos((p) => ({ ...p, [slot]: dataUrl }));
      showToast("התמונה נשמרה");
    } catch (e) {
      setErr(e?.message || "התמונה לא נשמרה");
    } finally {
      setBusy(false);
    }
  };

  const dropPhoto = async (slot) => {
    setBusy(true);
    try {
      await removeEventPhoto(slot);
      setPhotos((p) => ({ ...p, [slot]: "" }));
      showToast("התמונה הוסרה");
    } catch {
      setErr("ההסרה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-[#CCBDAB] bg-[#FBF7F1]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-right"
      >
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#3A2E26]">
          <Settings2 size={15} className="text-[#844442]" /> הגדרות האירוע
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-[#A2937F] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-[#E8DCCB] px-3.5 pb-4 pt-3">
          {!loaded ? (
            <p className="py-6 text-center text-[12.5px] text-[#7C6E60]">טוען…</p>
          ) : (
            <>
              <SField label="שם האירוע" value={form.title} onChange={(v) => set({ title: v })} placeholder="נפגשים לשדך" />

              <SField
                label="משפט הפתיחה"
                value={form.tagline}
                onChange={(v) => set({ tagline: v })}
                placeholder="המשפט שמופיע מתחת לשם האירוע"
                area
              />

              <SField
                label="מה להביא"
                value={form.bring}
                onChange={(v) => set({ bring: v })}
                placeholder="חיוך, אמונה בלב ודף ההכנה מודפס"
              />

              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <SField label="תאריך קצר" value={form.dateShort} onChange={(v) => set({ dateShort: v })} placeholder="21.11" />
                <SField label="שעה" value={form.time} onChange={(v) => set({ time: v })} placeholder="20:45" />
              </div>

              <SField
                label="יום ותאריך עברי"
                value={form.dateLabel}
                onChange={(v) => set({ dateLabel: v })}
                placeholder="מוצאי שבת · י״א כסלו"
              />

              <p className="mb-1.5 mt-3.5 text-[12px] font-bold text-[#5E5048]">איפה מתקיים?</p>
              <div className="flex rounded-2xl border border-[#CCBDAB] bg-white p-1">
                {[
                  ["zoom", "בזום", Video],
                  ["place", "מפגש פיזי", MapPin],
                ].map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => set({ mode: id })}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[12.5px] font-bold transition ${
                      form.mode === id ? "bg-[#844442] text-white" : "text-[#7C6E60]"
                    }`}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>

              {form.mode === "zoom" ? (
                <SField
                  label="קישור הזום"
                  value={form.zoomUrl}
                  onChange={(v) => set({ zoomUrl: v })}
                  placeholder="https://zoom.us/j/..."
                  dir="ltr"
                />
              ) : (
                <>
                  <SField label="שם המקום" value={form.placeName} onChange={(v) => set({ placeName: v })} placeholder="מועדון חוות גבעות" />
                  <SField label="כתובת מלאה" value={form.address} onChange={(v) => set({ address: v })} placeholder="רחוב, מספר, יישוב" />
                  <SField
                    label="קישור Waze (לא חובה)"
                    value={form.wazeUrl}
                    onChange={(v) => set({ wazeUrl: v })}
                    placeholder="אם ריק, נבנה אוטומטית מהכתובת"
                    dir="ltr"
                  />
                </>
              )}

              <p className="mb-1.5 mt-3.5 text-[12px] font-bold text-[#5E5048]">תמונות</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["hero", "תמונה ראשית"],
                  ["photo1", "תמונה 2"],
                  ["photo2", "תמונה 3"],
                  ["photo3", "תמונה 4"],
                ].map(([slot, label]) => (
                  <PhotoSlot
                    key={slot}
                    label={label}
                    src={photos[slot]}
                    busy={busy}
                    onPick={(file) => pickPhoto(slot, file)}
                    onDrop={() => dropPhoto(slot)}
                  />
                ))}
              </div>

              {err && (
                <p className="mt-3 rounded-xl bg-[#FBEDEC] px-3 py-2 text-[12px] font-semibold text-[#C24545]">{err}</p>
              )}

              <button
                onClick={save}
                disabled={busy}
                className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#844442] py-3 text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-45"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <>שמירת ההגדרות</>}
              </button>
              <p className="mt-2 text-center text-[11px] leading-relaxed text-[#A2937F]">
                שינוי התאריך או השעה פותח אירוע חדש: הנרשמים הקודמים נשמרים, וכל מי שנכנס
                לדף מתחיל מהתחלה.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SField({ label, value, onChange, placeholder, dir, area }) {
  const cls =
    "w-full rounded-xl border border-[#CCBDAB] bg-white px-3 py-2 text-[13px] text-[#3A2E26] outline-none transition placeholder:text-[#BCAC97] focus:border-[#844442]";
  return (
    <label className="mt-2.5 block">
      <span className="mb-1 block text-[11.5px] font-bold text-[#5E5048]">{label}</span>
      {area ? (
        <textarea
          rows={3}
          dir={dir}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${cls} resize-none leading-relaxed`}
        />
      ) : (
        <input
          dir={dir}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      )}
    </label>
  );
}

function PhotoSlot({ label, src, busy, onPick, onDrop }) {
  return (
    <div className="rounded-2xl border border-[#CCBDAB] bg-white p-2">
      <p className="mb-1.5 text-[11px] font-bold text-[#7C6E60]">{label}</p>
      {src ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="h-20 w-full rounded-xl object-cover" />
          <button
            onClick={onDrop}
            disabled={busy}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-xl border border-[#E8DCCB] py-1.5 text-[11px] font-bold text-[#C24545] transition active:scale-95 disabled:opacity-45"
          >
            <Trash2 size={12} /> הסרה
          </button>
        </>
      ) : (
        <label className="flex h-20 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[#D9CBB8] text-[11.5px] font-bold text-[#844442] transition hover:bg-[#FBF7F1]">
          <ImagePlus size={15} className="ml-1" /> העלאה
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              onPick(f);
            }}
          />
        </label>
      )}
    </div>
  );
}

function Empty({ children }) {
  return <p className="rounded-2xl bg-[#F5EFE6] px-3 py-6 text-center text-[12.5px] text-[#7C6E60]">{children}</p>;
}

function Row({ title, meta, phone, note }) {
  return (
    <div className="rounded-2xl border border-[#E8DCCB] bg-[#FBF7F1] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-[#3A2E26]">{title}</p>
          <p className="mt-0.5 text-[11px] text-[#A2937F]">{meta}</p>
        </div>
        {phone && (
          <div className="flex shrink-0 gap-1.5">
            <a href={`tel:${phone}`} aria-label="חיוג" className="rounded-xl bg-[#844442] p-2 text-white transition active:scale-90">
              <Phone size={14} />
            </a>
            <a
              href={`https://wa.me/${waDigits(phone)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="וואטסאפ"
              className="rounded-xl bg-[#62826B] p-2 text-white transition active:scale-90"
            >
              <MessageCircle size={14} />
            </a>
          </div>
        )}
      </div>
      {phone && <p dir="ltr" className="mt-1.5 text-right text-[12px] font-semibold text-[#7C6E60]">{prettyPhone(phone)}</p>}
      {note && <p className="mt-1.5 rounded-xl bg-white px-2.5 py-2 text-[12.5px] leading-relaxed text-[#3A2E26]">{note}</p>}
    </div>
  );
}
