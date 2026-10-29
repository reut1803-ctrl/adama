"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Users, Sparkles, Phone, MessageCircle, AlertTriangle, Link2, Check } from "lucide-react";
import { useCrmStore } from "@/lib/crm/store";
import { EVENT, subscribeEvent } from "@/lib/crm/eventStore";
import { waDigits } from "@/components/crm/profiles/ProfileCard";
import { prettyPhone } from "@/components/crm/ui/CopyStaffButton";

// אזור "ערב משדכים" בלוח הבקרה: מי נרשם, ואילו לידים נאספו מהדף.
// רכיב עצמאי שקורא אך ורק משני האוספים החדשים.

export default function EventAdmin() {
  const role = useCrmStore((s) => s.role);
  const showToast = useCrmStore((s) => s.showToast);
  const [tab, setTab] = useState("rsvps");
  const [rsvps, setRsvps] = useState([]);
  const [leads, setLeads] = useState([]);
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const fmt = (iso) => {
    try { return new Date(iso).toLocaleDateString("he-IL"); } catch { return ""; }
  };

  return (
    <section className="mt-4 rounded-3xl border border-[#CCBDAB] bg-white p-4 shadow-[0_4px_18px_rgba(58,51,53,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-[#3A2E26]">
            <CalendarDays size={17} className="text-[#844442]" /> {EVENT.title}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#7C6E60]">
            {EVENT.dateLabel} · {EVENT.dateShort} · {EVENT.time} · {EVENT.place}
          </p>
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

      <div className="mt-3 flex rounded-2xl border border-[#CCBDAB] bg-[#F5EFE6] p-1">
        {[
          ["rsvps", "נרשמו לערב", rsvps.length, Users],
          ["leads", "לידים חדשים", leads.length, Sparkles],
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

      <div className="mt-3 space-y-2">
        {tab === "rsvps" &&
          (rsvps.length === 0 ? (
            <Empty>עדיין אין נרשמים. שתפי את הקישור כדי להתחיל.</Empty>
          ) : (
            rsvps.map((r) => (
              <Row key={r.id} title={r.name} meta={fmt(r.createdAt)} phone={r.phone} />
            ))
          ))}

        {tab === "leads" &&
          (leads.length === 0 ? (
            <Empty>עדיין לא נאספו לידים מהדף.</Empty>
          ) : (
            leads.map((l) => (
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
