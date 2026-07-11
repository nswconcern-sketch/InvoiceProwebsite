import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, ArrowLeft, Check, Trash2, Pencil, FileText, Users,
  LayoutGrid, X, Search, ChevronRight, Send, Clock3, CircleDollarSign,
  Phone, Mail, MapPin, AlertCircle, Settings, Printer, RefreshCw
} from "lucide-react";
import {
  fetchCustomers, createCustomer, updateCustomer, deleteCustomerApi,
  fetchInvoices, createInvoice, updateInvoice, deleteInvoiceApi, setInvoiceStatusApi,
} from "./api";

// ---------------------------------------------------------------------------
// Design tokens — ledger & brass: the visual language of an old account book.
// ---------------------------------------------------------------------------
const C = {
  ink: "#1B2340",       // deep navy ink — primary text, headers
  inkSoft: "#3A4166",   // secondary text
  slate: "#6B7290",     // muted / captions
  paper: "#E9EAF0",     // cool ledger-paper background
  card: "#FFFFFF",
  line: "#DBDDE6",      // hairline rule
  brass: "#A9822F",     // primary accent — brass fittings
  brassDark: "#8A6A26",
  brassSoft: "#F1E7CF",
  stampRed: "#A23B4A",  // overdue / unpaid
  stampRedSoft: "#F3DEE1",
  stampGreen: "#2E6B52", // paid
  stampGreenSoft: "#DCEAE2",
  stampAmber: "#B4791F", // sent
  stampAmberSoft: "#F3E4C9",
};

const serif = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif";
const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const mono = "'SF Mono', 'IBM Plex Mono', 'Courier New', monospace";

const uid = () => Math.random().toString(36).slice(2, 10);

// Currencies supported for invoicing. No live FX conversion — each invoice is
// billed and totalled in a single currency of the user's choice.
const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { code: "MXN", symbol: "$", name: "Mexican Peso" },
];
const currencyMeta = (code) => CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];

// This app runs its own backend now, but there's still no live forex feed
// wired up — exchange rates are a reference table you set and update
// yourself in Settings — good enough to see one consolidated "roughly how
// much am I owed" number without pretending to be a real-time feed. Rates
// below are illustrative starting points only.
const DEFAULT_FX_RATES = {
  base: "USD",
  updatedAt: null,
  rates: { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 157, INR: 83.5, AUD: 1.51, CAD: 1.36, CHF: 0.9, CNY: 7.25, MXN: 18.3 },
};

function convertAmount(amount, from, to, fx) {
  if (!fx || from === to) return amount;
  const rates = fx.rates || {};
  const base = fx.base || "USD";
  const rFrom = from === base ? 1 : rates[from];
  const rTo = to === base ? 1 : rates[to];
  if (!rFrom || !rTo) return null; // no rate on file for one side
  const inBase = amount / rFrom;
  return inBase * rTo;
}

const money = (n, currency = "USD") => {
  try {
    return (Number(n) || 0).toLocaleString(undefined, { style: "currency", currency });
  } catch {
    return `${currencyMeta(currency).symbol}${(Number(n) || 0).toFixed(2)}`;
  }
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const STATUS = {
  draft: { label: "Draft", fg: C.slate, bg: "#EEEFF3" },
  sent: { label: "Sent", fg: C.stampAmber, bg: C.stampAmberSoft },
  paid: { label: "Paid", fg: C.stampGreen, bg: C.stampGreenSoft },
  overdue: { label: "Overdue", fg: C.stampRed, bg: C.stampRedSoft },
};

function computeStatus(inv) {
  if (inv.status === "paid") return "paid";
  if (inv.status === "draft") return "draft";
  if (inv.dueDate && inv.dueDate < todayISO()) return "overdue";
  return "sent";
}

// Full breakdown: subtotal → discount → tax → total. Discount can be a flat
// amount or a percent of the subtotal; tax is always a percent applied after
// the discount, which is the common convention for invoicing.
function invoiceTotals(inv) {
  const subtotal = (inv.items || []).reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0
  );
  const discountValue = Number(inv.discountValue) || 0;
  const discountAmount = inv.discountType === "percent"
    ? subtotal * (discountValue / 100)
    : Math.min(discountValue, subtotal);
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const taxRate = Number(inv.taxRate) || 0;
  const taxAmount = afterDiscount * (taxRate / 100);
  const total = afterDiscount + taxAmount;
  return { subtotal, discountAmount, afterDiscount, taxAmount, total };
}

function invoiceTotal(inv) {
  return invoiceTotals(inv).total;
}

// ---------------------------------------------------------------------------
// Local-only persistence for business profile & FX rate table. These aren't
// backed by the API yet, and this is a real deployed website (not a Claude
// artifact), so plain localStorage is the right tool here.
// ---------------------------------------------------------------------------
function loadObjLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveObjLocal(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {
    // best-effort; UI already reflects the change in memory
  }
}

// ---------------------------------------------------------------------------
// Small UI atoms
// ---------------------------------------------------------------------------
function StampBadge({ status, size = "sm" }) {
  const s = STATUS[status];
  const pad = size === "lg" ? "6px 14px" : "3px 10px";
  const font = size === "lg" ? 13 : 11;
  return (
    <span
      style={{
        color: s.fg,
        background: s.bg,
        fontFamily: mono,
        fontSize: font,
        fontWeight: 700,
        letterSpacing: "0.08em",
        padding: pad,
        borderRadius: 999,
        border: `1px solid ${s.fg}33`,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span
        className="block mb-1.5 text-xs font-semibold uppercase"
        style={{ color: C.slate, letterSpacing: "0.06em", fontFamily: sans }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  fontFamily: sans,
  fontSize: 15,
  color: C.ink,
  background: C.card,
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: "10px 12px",
  outline: "none",
};

function TextInput(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}

function PrimaryButton({ children, onClick, style, type = "button", disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
      style={{
        background: disabled ? C.line : C.ink,
        color: disabled ? C.slate : "#fff",
        fontFamily: sans,
        fontWeight: 600,
        fontSize: 15,
        borderRadius: 10,
        padding: "11px 18px",
        border: "none",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, style }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
      style={{
        background: "transparent",
        color: C.ink,
        fontFamily: sans,
        fontWeight: 600,
        fontSize: 15,
        borderRadius: 10,
        padding: "11px 18px",
        border: `1px solid ${C.line}`,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function TopBar({ title, onBack, right }) {
  return (
    <div
      className="flex items-center justify-between px-4 sticky top-0 z-10"
      style={{
        height: 56,
        background: C.paper,
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {onBack && (
          <button onClick={onBack} className="p-1 -ml-1" aria-label="Back">
            <ArrowLeft size={20} color={C.ink} />
          </button>
        )}
        <h1
          className="truncate"
          style={{ fontFamily: serif, fontSize: 19, fontWeight: 700, color: C.ink }}
        >
          {title}
        </h1>
      </div>
      {right}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body, actionLabel, onAction }) {
  return (
    <div className="flex flex-col items-center text-center px-8 py-16">
      <div
        className="flex items-center justify-center mb-4"
        style={{ width: 56, height: 56, borderRadius: 999, background: C.brassSoft }}
      >
        <Icon size={24} color={C.brassDark} />
      </div>
      <div style={{ fontFamily: serif, fontSize: 17, fontWeight: 700, color: C.ink }}>{title}</div>
      <div style={{ fontFamily: sans, fontSize: 13.5, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
        {body}
      </div>
      {actionLabel && (
        <div className="mt-5">
          <PrimaryButton onClick={onAction}>
            <Plus size={16} /> {actionLabel}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({ invoices, customers, openInvoice, goTab, fxRates, openSettings }) {
  const stats = useMemo(() => {
    // Balances are tallied per currency first — converting only happens for
    // the headline number, using the reference rates from Settings.
    const outstanding = {}; // { USD: 120.50, EUR: 40 }
    const paidThisMonth = {};
    let overdueCount = 0;
    const thisMonth = todayISO().slice(0, 7);
    invoices.forEach((inv) => {
      const st = computeStatus(inv);
      const total = invoiceTotal(inv);
      const cur = inv.currency || "USD";
      if (st === "paid") {
        if ((inv.paidDate || "").slice(0, 7) === thisMonth) {
          paidThisMonth[cur] = (paidThisMonth[cur] || 0) + total;
        }
      } else {
        outstanding[cur] = (outstanding[cur] || 0) + total;
        if (st === "overdue") overdueCount += 1;
      }
    });
    return { outstanding, paidThisMonth, overdueCount };
  }, [invoices]);

  const recent = [...invoices]
    .sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""))
    .slice(0, 5);

  const customerName = (id) => customers.find((c) => c.id === id)?.name || "No customer";
  const outstandingEntries = Object.entries(stats.outstanding);
  const homeCurrency = fxRates?.base || "USD";
  const multiCurrency = outstandingEntries.length > 1;

  // Consolidated total in the home currency, when a rate is on file for
  // every currency that has an outstanding balance.
  let consolidated = 0, consolidatedOk = true;
  outstandingEntries.forEach(([cur, amt]) => {
    const converted = convertAmount(amt, cur, homeCurrency, fxRates);
    if (converted === null) consolidatedOk = false;
    else consolidated += converted;
  });

  return (
    <div className="pb-6">
      <div className="px-4 pt-5 pb-2">
        <div className="flex items-center justify-between">
          <div style={{ fontFamily: sans, fontSize: 13, color: C.slate }}>Outstanding balance</div>
          <button onClick={openSettings} className="flex items-center gap-1" style={{ fontFamily: sans, fontSize: 11.5, color: C.brassDark, fontWeight: 600 }}>
            <RefreshCw size={12} /> Rates
          </button>
        </div>

        {outstandingEntries.length === 0 ? (
          <div style={{ fontFamily: serif, fontSize: 38, fontWeight: 700, color: C.ink, lineHeight: 1.1 }}>
            {money(0, homeCurrency)}
          </div>
        ) : multiCurrency && consolidatedOk ? (
          <>
            <div style={{ fontFamily: serif, fontSize: 38, fontWeight: 700, color: C.ink, lineHeight: 1.1 }}>
              ≈ {money(consolidated, homeCurrency)}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mt-1.5">
              {outstandingEntries.map(([cur, amt]) => (
                <span key={cur} style={{ fontFamily: mono, fontSize: 13, color: C.slate }}>
                  {money(amt, cur)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {outstandingEntries.map(([cur, amt], idx) => (
              <div
                key={cur}
                style={{
                  fontFamily: serif,
                  fontSize: idx === 0 ? 38 : 22,
                  fontWeight: 700,
                  color: idx === 0 ? C.ink : C.inkSoft,
                  lineHeight: 1.1,
                }}
              >
                {money(amt, cur)}
              </div>
            ))}
          </div>
        )}
        {multiCurrency && !consolidatedOk && (
          <button
            onClick={openSettings}
            className="mt-1.5"
            style={{ fontFamily: sans, fontSize: 11.5, color: C.brassDark, fontWeight: 600, textAlign: "left" }}
          >
            Add a rate for every currency above to see one combined total →
          </button>
        )}
        {stats.overdueCount > 0 && (
          <div className="flex items-center gap-1.5 mt-2" style={{ color: C.stampRed }}>
            <AlertCircle size={14} />
            <span style={{ fontFamily: sans, fontSize: 12.5, fontWeight: 600 }}>
              {stats.overdueCount} invoice{stats.overdueCount > 1 ? "s" : ""} overdue
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 mt-4">
        <div style={{ background: C.card, borderRadius: 14, padding: 14, border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: sans, fontSize: 11.5, color: C.slate, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Paid this month
          </div>
          {Object.keys(stats.paidThisMonth).length === 0 ? (
            <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: C.stampGreen, marginTop: 4 }}>
              {money(0, homeCurrency)}
            </div>
          ) : (
            Object.entries(stats.paidThisMonth).map(([cur, amt]) => (
              <div key={cur} style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: C.stampGreen, marginTop: 4 }}>
                {money(amt, cur)}
              </div>
            ))
          )}
        </div>
        <div style={{ background: C.card, borderRadius: 14, padding: 14, border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: sans, fontSize: 11.5, color: C.slate, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Customers
          </div>
          <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: C.ink, marginTop: 4 }}>
            {customers.length}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 mt-7 mb-2">
        <h2 style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: C.ink }}>Recent invoices</h2>
        <button onClick={() => goTab("invoices")} style={{ fontFamily: sans, fontSize: 12.5, color: C.brassDark, fontWeight: 600 }}>
          View all
        </button>
      </div>

      {recent.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices yet"
          body="Create your first invoice to start tracking what you're owed."
          actionLabel="New invoice"
          onAction={() => goTab("newInvoice")}
        />
      ) : (
        <div className="px-4 flex flex-col gap-2">
          {recent.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} customerName={customerName(inv.customerId)} onClick={() => openInvoice(inv.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ inv, customerName, onClick }) {
  const st = computeStatus(inv);
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between w-full text-left active:opacity-70"
      style={{ background: C.card, borderRadius: 14, padding: "12px 14px", border: `1px solid ${C.line}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: mono, fontSize: 12.5, color: C.slate }}>#{inv.number}</span>
          <StampBadge status={st} />
        </div>
        <div className="truncate mt-1" style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: C.ink }}>
          {customerName}
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: C.slate, marginTop: 2 }}>
          Due {fmtDate(inv.dueDate)}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-2">
        <div className="flex flex-col items-end">
          <span style={{ fontFamily: mono, fontSize: 9.5, fontWeight: 700, color: C.brassDark, letterSpacing: "0.05em" }}>
            {inv.currency || "USD"}
          </span>
          <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: C.ink }}>{money(invoiceTotal(inv), inv.currency)}</span>
        </div>
        <ChevronRight size={16} color={C.slate} />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Invoice list (with filter)
// ---------------------------------------------------------------------------
function InvoiceList({ invoices, customers, openInvoice, goTab }) {
  const [filter, setFilter] = useState("all");
  const customerName = (id) => customers.find((c) => c.id === id)?.name || "No customer";

  const filtered = invoices.filter((inv) => filter === "all" || computeStatus(inv) === filter);
  const sorted = [...filtered].sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));

  const tabs = [
    { key: "all", label: "All" },
    { key: "draft", label: "Draft" },
    { key: "sent", label: "Sent" },
    { key: "overdue", label: "Overdue" },
    { key: "paid", label: "Paid" },
  ];

  return (
    <div className="pb-6">
      <div className="flex gap-2 px-4 pt-4 pb-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {tabs.map((t) => {
          const active = filter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              style={{
                fontFamily: sans,
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                padding: "7px 14px",
                borderRadius: 999,
                background: active ? C.ink : C.card,
                color: active ? "#fff" : C.inkSoft,
                border: `1px solid ${active ? C.ink : C.line}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={invoices.length === 0 ? "No invoices yet" : "Nothing here"}
          body={invoices.length === 0 ? "Create your first invoice to start tracking what you're owed." : "No invoices match this filter."}
          actionLabel={invoices.length === 0 ? "New invoice" : undefined}
          onAction={() => goTab("newInvoice")}
        />
      ) : (
        <div className="px-4 mt-3 flex flex-col gap-2">
          {sorted.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} customerName={customerName(inv.customerId)} onClick={() => openInvoice(inv.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice detail (the "paper" view)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Print / "export as PDF" — hands off to the browser's native print dialog,
// where "Save as PDF" produces a real PDF. Global print CSS (in the App
// shell) hides everything else on the page and shows only this block while
// printing.
// ---------------------------------------------------------------------------
function PrintableInvoice({ inv, customer, business }) {
  const cur = inv.currency || "USD";
  const { subtotal, discountAmount, taxAmount, total } = invoiceTotals(inv);
  return (
    <div className="printable-invoice" style={{ background: "#fff", color: "#111", fontFamily: sans, padding: 32 }}>
      <div className="flex items-start justify-between" style={{ marginBottom: 28 }}>
        <div>
          <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 700, color: "#111" }}>
            {business?.name || "Your business name"}
          </div>
          {business?.email && <div style={{ fontSize: 12, color: "#444" }}>{business.email}</div>}
          {business?.address && <div style={{ fontSize: 12, color: "#444", whiteSpace: "pre-line" }}>{business.address}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: serif, fontSize: 26, fontWeight: 700, letterSpacing: "0.02em" }}>INVOICE</div>
          <div style={{ fontFamily: mono, fontSize: 13, color: "#444" }}>#{inv.number}</div>
        </div>
      </div>

      <div className="flex items-start justify-between" style={{ marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "#777" }}>Billed to</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{customer?.name || "No customer selected"}</div>
          {customer?.email && <div style={{ fontSize: 12.5, color: "#444" }}>{customer.email}</div>}
          {customer?.address && <div style={{ fontSize: 12.5, color: "#444", whiteSpace: "pre-line" }}>{customer.address}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "#777" }}>Issued</div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>{fmtDate(inv.issueDate)}</div>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "#777" }}>Due</div>
          <div style={{ fontSize: 13 }}>{fmtDate(inv.dueDate)}</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid #111" }}>
            <th style={{ textAlign: "left", padding: "6px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Description</th>
            <th style={{ textAlign: "right", padding: "6px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Qty</th>
            <th style={{ textAlign: "right", padding: "6px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Rate</th>
            <th style={{ textAlign: "right", padding: "6px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(inv.items || []).map((it) => (
            <tr key={it.id} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={{ padding: "8px 0", fontSize: 13 }}>{it.desc || "Untitled item"}</td>
              <td style={{ padding: "8px 0", fontSize: 13, textAlign: "right" }}>{it.qty}</td>
              <td style={{ padding: "8px 0", fontSize: 13, textAlign: "right" }}>{money(it.rate, cur)}</td>
              <td style={{ padding: "8px 0", fontSize: 13, textAlign: "right" }}>
                {money((Number(it.qty) || 0) * (Number(it.rate) || 0), cur)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex" style={{ justifyContent: "flex-end" }}>
        <div style={{ width: 220 }}>
          <div className="flex items-center justify-between" style={{ padding: "3px 0", fontSize: 13 }}>
            <span style={{ color: "#444" }}>Subtotal</span><span>{money(subtotal, cur)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex items-center justify-between" style={{ padding: "3px 0", fontSize: 13 }}>
              <span style={{ color: "#444" }}>Discount</span><span>−{money(discountAmount, cur)}</span>
            </div>
          )}
          {taxAmount > 0 && (
            <div className="flex items-center justify-between" style={{ padding: "3px 0", fontSize: 13 }}>
              <span style={{ color: "#444" }}>Tax ({Number(inv.taxRate) || 0}%)</span><span>{money(taxAmount, cur)}</span>
            </div>
          )}
          <div className="flex items-center justify-between" style={{ padding: "8px 0 0 0", marginTop: 4, borderTop: "1.5px solid #111", fontSize: 16, fontWeight: 700 }}>
            <span>Total</span><span>{money(total, cur)}</span>
          </div>
        </div>
      </div>

      {inv.notes && (
        <div style={{ marginTop: 28, paddingTop: 12, borderTop: "1px solid #ddd" }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "#777" }}>Notes</div>
          <div style={{ fontSize: 12.5, color: "#333", marginTop: 3, lineHeight: 1.5 }}>{inv.notes}</div>
        </div>
      )}
    </div>
  );
}

function InvoiceDetail({ inv, customer, business, onBack, onEdit, onDelete, onSetStatus }) {
  const st = computeStatus(inv);
  const cur = inv.currency || "USD";
  const { subtotal, discountAmount, taxAmount, total } = invoiceTotals(inv);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="pb-8">
      <TopBar
        title={`Invoice #${inv.number}`}
        onBack={onBack}
        right={
          <div className="flex items-center gap-3">
            <button onClick={() => window.print()} className="p-1" aria-label="Export as PDF">
              <Printer size={18} color={C.ink} />
            </button>
            <button onClick={onEdit} className="p-1" aria-label="Edit">
              <Pencil size={18} color={C.ink} />
            </button>
          </div>
        }
      />

      <div className="px-4 pt-5">
        <div
          className="relative overflow-hidden"
          style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.line}`, padding: 20 }}
        >
          <div
            className="absolute"
            style={{
              top: 16,
              right: -8,
              transform: "rotate(-9deg)",
            }}
          >
            <StampBadge status={st} size="lg" />
          </div>

          <div style={{ fontFamily: sans, fontSize: 11.5, color: C.slate, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Billed to
          </div>
          <div style={{ fontFamily: serif, fontSize: 20, fontWeight: 700, color: C.ink, marginTop: 2 }}>
            {customer ? customer.name : "No customer selected"}
          </div>
          {customer?.email && <div style={{ fontFamily: sans, fontSize: 13, color: C.slate }}>{customer.email}</div>}

          <div className="flex gap-6 mt-4">
            <div>
              <div style={{ fontFamily: sans, fontSize: 11, color: C.slate, textTransform: "uppercase" }}>Issued</div>
              <div style={{ fontFamily: mono, fontSize: 13.5, color: C.ink }}>{fmtDate(inv.issueDate)}</div>
            </div>
            <div>
              <div style={{ fontFamily: sans, fontSize: 11, color: C.slate, textTransform: "uppercase" }}>Due</div>
              <div style={{ fontFamily: mono, fontSize: 13.5, color: C.ink }}>{fmtDate(inv.dueDate)}</div>
            </div>
          </div>

          <div className="mt-5" style={{ borderTop: `1px dashed ${C.line}` }}>
            {(inv.items || []).map((it) => (
              <div key={it.id} className="flex items-start justify-between py-3" style={{ borderBottom: `1px dashed ${C.line}` }}>
                <div className="pr-3 min-w-0">
                  <div style={{ fontFamily: sans, fontSize: 14, color: C.ink, fontWeight: 600 }}>{it.desc || "Untitled item"}</div>
                  <div style={{ fontFamily: mono, fontSize: 12, color: C.slate, marginTop: 2 }}>
                    {it.qty} × {money(it.rate, cur)}
                  </div>
                </div>
                <div style={{ fontFamily: mono, fontSize: 14.5, color: C.ink, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {money((Number(it.qty) || 0) * (Number(it.rate) || 0), cur)}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span style={{ fontFamily: sans, fontSize: 13.5, color: C.inkSoft }}>Subtotal</span>
              <span style={{ fontFamily: mono, fontSize: 14, color: C.inkSoft }}>{money(subtotal, cur)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: sans, fontSize: 13.5, color: C.inkSoft }}>
                  Discount{inv.discountType === "percent" ? ` (${Number(inv.discountValue) || 0}%)` : ""}
                </span>
                <span style={{ fontFamily: mono, fontSize: 14, color: C.stampRed }}>−{money(discountAmount, cur)}</span>
              </div>
            )}
            {taxAmount > 0 && (
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: sans, fontSize: 13.5, color: C.inkSoft }}>
                  Tax ({Number(inv.taxRate) || 0}%)
                </span>
                <span style={{ fontFamily: mono, fontSize: 14, color: C.inkSoft }}>{money(taxAmount, cur)}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: C.ink }}>Total due</span>
            <span style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: C.ink }}>{money(total, cur)}</span>
          </div>

          {inv.notes && (
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontFamily: sans, fontSize: 11.5, color: C.slate, textTransform: "uppercase" }}>Notes</div>
              <div style={{ fontFamily: sans, fontSize: 13.5, color: C.inkSoft, marginTop: 3, lineHeight: 1.5 }}>{inv.notes}</div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 mt-5">
          {st !== "paid" && (
            <PrimaryButton onClick={() => onSetStatus("paid")} style={{ background: C.stampGreen }}>
              <Check size={16} /> Mark as paid
            </PrimaryButton>
          )}
          {inv.status === "draft" && (
            <GhostButton onClick={() => onSetStatus("sent")}>
              <Send size={16} /> Mark as sent
            </GhostButton>
          )}
          {st === "paid" && (
            <GhostButton onClick={() => onSetStatus("sent")}>
              <Clock3 size={16} /> Reopen invoice
            </GhostButton>
          )}

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="mt-2"
              style={{ fontFamily: sans, fontSize: 13.5, color: C.stampRed, fontWeight: 600 }}
            >
              Delete invoice
            </button>
          ) : (
            <div className="flex items-center justify-center gap-3 mt-2">
              <span style={{ fontFamily: sans, fontSize: 13, color: C.slate }}>Delete this invoice?</span>
              <button onClick={onDelete} style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, color: C.stampRed }}>
                Yes, delete
              </button>
              <button onClick={() => setConfirmDelete(false)} style={{ fontFamily: sans, fontSize: 13, color: C.slate }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <PrintableInvoice inv={inv} customer={customer} business={business} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// New / edit invoice
// ---------------------------------------------------------------------------
function InvoiceForm({ initial, customers, onCancel, onSave, onNewCustomer }) {
  const startCustomer = customers.find((c) => c.id === (initial?.customerId || customers[0]?.id));

  const [customerId, setCustomerId] = useState(initial?.customerId || customers[0]?.id || "");
  const [currency, setCurrency] = useState(initial?.currency || startCustomer?.defaultCurrency || "USD");
  const [issueDate, setIssueDate] = useState(initial?.issueDate || todayISO());
  const [dueDate, setDueDate] = useState(initial?.dueDate || todayISO());
  const [notes, setNotes] = useState(initial?.notes || "");
  const [taxRate, setTaxRate] = useState(initial?.taxRate ?? startCustomer?.defaultTaxRate ?? "");
  const [discountType, setDiscountType] = useState(initial?.discountType || startCustomer?.defaultDiscountType || "percent");
  const [discountValue, setDiscountValue] = useState(initial?.discountValue ?? startCustomer?.defaultDiscountValue ?? "");
  const [items, setItems] = useState(
    initial?.items?.length ? initial.items : [{ id: uid(), desc: "", qty: 1, rate: "" }]
  );
  const [saving, setSaving] = useState(false);

  const totals = invoiceTotals({ items, taxRate, discountType, discountValue });

  const updateItem = (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));
  const addItem = () => setItems((prev) => [...prev, { id: uid(), desc: "", qty: 1, rate: "" }]);

  // Switching the customer on a *new* invoice pulls in their saved billing
  // defaults. On an existing invoice we leave whatever's already filled in.
  const handleCustomerChange = (newId) => {
    setCustomerId(newId);
    if (initial) return;
    const cust = customers.find((c) => c.id === newId);
    setCurrency(cust?.defaultCurrency || "USD");
    setTaxRate(cust?.defaultTaxRate ?? "");
    setDiscountType(cust?.defaultDiscountType || "percent");
    setDiscountValue(cust?.defaultDiscountValue ?? "");
  };

  const canSave = customerId && items.some((it) => it.desc.trim());

  const handleSave = async (status) => {
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || uid(),
        number: initial?.number,
        customerId,
        currency,
        issueDate,
        dueDate,
        notes,
        taxRate: taxRate === "" ? 0 : Number(taxRate),
        discountType,
        discountValue: discountValue === "" ? 0 : Number(discountValue),
        items: items.filter((it) => it.desc.trim()),
        status: status || initial?.status || "draft",
        paidDate: initial?.paidDate || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-8">
      <TopBar title={initial ? "Edit invoice" : "New invoice"} onBack={onCancel} />

      <div className="px-4 pt-4">
        <Field label="Customer">
          {customers.length === 0 ? (
            <button
              onClick={onNewCustomer}
              className="w-full text-left flex items-center justify-between"
              style={{ ...inputStyle, color: C.slate }}
            >
              Add a customer first <Plus size={16} />
            </button>
          ) : (
            <select value={customerId} onChange={(e) => handleCustomerChange(e.target.value)} style={inputStyle}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Currency">
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inputStyle}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name} ({c.symbol})</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Issue date">
            <TextInput type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="mt-2 mb-2 flex items-center justify-between">
          <span
            className="text-xs font-semibold uppercase"
            style={{ color: C.slate, letterSpacing: "0.06em", fontFamily: sans }}
          >
            Line items
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {items.map((it) => (
            <div key={it.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
              <div className="flex items-start gap-2">
                <TextInput
                  placeholder="Description"
                  value={it.desc}
                  onChange={(e) => updateItem(it.id, { desc: e.target.value })}
                  style={{ flex: 1 }}
                />
                {items.length > 1 && (
                  <button onClick={() => removeItem(it.id)} className="p-2" aria-label="Remove item">
                    <Trash2 size={16} color={C.slate} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <TextInput
                  type="number"
                  min="0"
                  placeholder="Qty"
                  value={it.qty}
                  onChange={(e) => updateItem(it.id, { qty: e.target.value })}
                />
                <TextInput
                  type="number"
                  min="0"
                  placeholder="Rate"
                  value={it.rate}
                  onChange={(e) => updateItem(it.id, { rate: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <button onClick={addItem} className="flex items-center gap-1.5 mt-3" style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: C.brassDark }}>
          <Plus size={15} /> Add line item
        </button>

        <div className="mt-5 mb-2">
          <span
            className="text-xs font-semibold uppercase"
            style={{ color: C.slate, letterSpacing: "0.06em", fontFamily: sans }}
          >
            Discount & tax
          </span>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
          <span
            className="block mb-1.5 text-xs font-semibold uppercase"
            style={{ color: C.slate, letterSpacing: "0.06em", fontFamily: sans }}
          >
            Discount
          </span>
          <div className="flex gap-2">
            <div className="flex" style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
              {[{ key: "percent", label: "%" }, { key: "flat", label: currencyMeta(currency).symbol }].map((opt) => {
                const active = discountType === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setDiscountType(opt.key)}
                    style={{
                      fontFamily: sans, fontSize: 13, fontWeight: 700, padding: "10px 12px",
                      background: active ? C.ink : C.card, color: active ? "#fff" : C.inkSoft, border: "none",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <TextInput
              type="number"
              min="0"
              placeholder="0"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>

          <span
            className="block mb-1.5 mt-4 text-xs font-semibold uppercase"
            style={{ color: C.slate, letterSpacing: "0.06em", fontFamily: sans }}
          >
            Tax rate (%)
          </span>
          <TextInput
            type="number"
            min="0"
            placeholder="e.g. 8.5"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </div>

        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="Payment terms, thank-you note, etc."
          />
        </Field>

        <div className="flex flex-col gap-1 py-3 mt-1" style={{ borderTop: `1px solid ${C.line}` }}>
          <div className="flex items-center justify-between">
            <span style={{ fontFamily: sans, fontSize: 13.5, color: C.slate }}>Subtotal</span>
            <span style={{ fontFamily: mono, fontSize: 14, color: C.inkSoft }}>{money(totals.subtotal, currency)}</span>
          </div>
          {totals.discountAmount > 0 && (
            <div className="flex items-center justify-between">
              <span style={{ fontFamily: sans, fontSize: 13.5, color: C.slate }}>Discount</span>
              <span style={{ fontFamily: mono, fontSize: 14, color: C.stampRed }}>−{money(totals.discountAmount, currency)}</span>
            </div>
          )}
          {totals.taxAmount > 0 && (
            <div className="flex items-center justify-between">
              <span style={{ fontFamily: sans, fontSize: 13.5, color: C.slate }}>Tax</span>
              <span style={{ fontFamily: mono, fontSize: 14, color: C.inkSoft }}>{money(totals.taxAmount, currency)}</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1">
            <span style={{ fontFamily: serif, fontSize: 15, fontWeight: 700, color: C.ink }}>Total</span>
            <span style={{ fontFamily: mono, fontSize: 19, fontWeight: 700, color: C.ink }}>{money(totals.total, currency)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-3">
          <PrimaryButton disabled={!canSave || saving} onClick={() => handleSave(initial?.status || "draft")}>
            {saving ? "Saving…" : "Save invoice"}
          </PrimaryButton>
          {!initial && (
            <GhostButton onClick={() => canSave && !saving && handleSave("sent")}>
              <Send size={16} /> Save & mark as sent
            </GhostButton>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
function CustomerList({ customers, invoices, openCustomer, onAdd }) {
  const [q, setQ] = useState("");
  const filtered = customers.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="pb-6">
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2" style={{ ...inputStyle, padding: "8px 12px" }}>
          <Search size={16} color={C.slate} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers"
            style={{ border: "none", outline: "none", flex: 1, fontFamily: sans, fontSize: 14.5, background: "transparent" }}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={customers.length === 0 ? "No customers yet" : "No matches"}
          body={customers.length === 0 ? "Add a customer to start billing them." : "Try a different search."}
          actionLabel={customers.length === 0 ? "Add customer" : undefined}
          onAction={onAdd}
        />
      ) : (
        <div className="px-4 mt-3 flex flex-col gap-2">
          {filtered.map((c) => {
            const count = invoices.filter((i) => i.customerId === c.id).length;
            return (
              <button
                key={c.id}
                onClick={() => openCustomer(c.id)}
                className="flex items-center justify-between w-full text-left active:opacity-70"
                style={{ background: C.card, borderRadius: 14, padding: "12px 14px", border: `1px solid ${C.line}` }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex items-center justify-center shrink-0"
                    style={{ width: 38, height: 38, borderRadius: 999, background: C.brassSoft, fontFamily: serif, fontWeight: 700, color: C.brassDark }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate" style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: C.ink }}>{c.name}</div>
                    <div style={{ fontFamily: sans, fontSize: 12, color: C.slate }}>
                      {count} invoice{count !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} color={C.slate} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CustomerForm({ initial, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [defaultCurrency, setDefaultCurrency] = useState(initial?.defaultCurrency || "USD");
  const [defaultTaxRate, setDefaultTaxRate] = useState(initial?.defaultTaxRate ?? "");
  const [defaultDiscountType, setDefaultDiscountType] = useState(initial?.defaultDiscountType || "percent");
  const [defaultDiscountValue, setDefaultDiscountValue] = useState(initial?.defaultDiscountValue ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || uid(),
        name: name.trim(),
        email,
        phone,
        address,
        defaultCurrency,
        defaultTaxRate: defaultTaxRate === "" ? 0 : Number(defaultTaxRate),
        defaultDiscountType,
        defaultDiscountValue: defaultDiscountValue === "" ? 0 : Number(defaultDiscountValue),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-8">
      <TopBar title={initial ? "Edit customer" : "New customer"} onBack={onCancel} />
      <div className="px-4 pt-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name or company" />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="Phone">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
        </Field>
        <Field label="Address">
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>

        <div className="mt-2 mb-2">
          <span className="text-xs font-semibold uppercase" style={{ color: C.slate, letterSpacing: "0.06em", fontFamily: sans }}>
            Billing defaults
          </span>
          <div style={{ fontFamily: sans, fontSize: 12, color: C.slate, marginTop: 2 }}>
            Auto-fills new invoices for this customer. Change anytime per invoice.
          </div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
          <Field label="Currency">
            <select value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)} style={inputStyle}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name} ({c.symbol})</option>
              ))}
            </select>
          </Field>

          <span className="block mb-1.5 text-xs font-semibold uppercase" style={{ color: C.slate, letterSpacing: "0.06em", fontFamily: sans }}>
            Discount
          </span>
          <div className="flex gap-2 mb-4">
            <div className="flex" style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
              {[{ key: "percent", label: "%" }, { key: "flat", label: currencyMeta(defaultCurrency).symbol }].map((opt) => {
                const active = defaultDiscountType === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setDefaultDiscountType(opt.key)}
                    style={{
                      fontFamily: sans, fontSize: 13, fontWeight: 700, padding: "10px 12px",
                      background: active ? C.ink : C.card, color: active ? "#fff" : C.inkSoft, border: "none",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <TextInput
              type="number"
              min="0"
              placeholder="0"
              value={defaultDiscountValue}
              onChange={(e) => setDefaultDiscountValue(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>

          <Field label="Tax rate (%)">
            <TextInput
              type="number"
              min="0"
              placeholder="e.g. 8.5"
              value={defaultTaxRate}
              onChange={(e) => setDefaultTaxRate(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5">
          <PrimaryButton disabled={!name.trim() || saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save customer"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function CustomerDetail({ customer, invoices, onBack, onEdit, onDelete, openInvoice }) {
  const own = invoices.filter((i) => i.customerId === customer.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="pb-8">
      <TopBar
        title={customer.name}
        onBack={onBack}
        right={
          <button onClick={onEdit} className="p-1" aria-label="Edit">
            <Pencil size={18} color={C.ink} />
          </button>
        }
      />
      <div className="px-4 pt-4">
        <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.line}`, padding: 14 }}>
          {customer.email && (
            <div className="flex items-center gap-2 py-1.5">
              <Mail size={15} color={C.slate} />
              <span style={{ fontFamily: sans, fontSize: 14, color: C.inkSoft }}>{customer.email}</span>
            </div>
          )}
          {customer.phone && (
            <div className="flex items-center gap-2 py-1.5">
              <Phone size={15} color={C.slate} />
              <span style={{ fontFamily: sans, fontSize: 14, color: C.inkSoft }}>{customer.phone}</span>
            </div>
          )}
          {customer.address && (
            <div className="flex items-center gap-2 py-1.5">
              <MapPin size={15} color={C.slate} />
              <span style={{ fontFamily: sans, fontSize: 14, color: C.inkSoft }}>{customer.address}</span>
            </div>
          )}
          {!customer.email && !customer.phone && !customer.address && (
            <span style={{ fontFamily: sans, fontSize: 13.5, color: C.slate }}>No contact details yet.</span>
          )}
        </div>

        <h2 className="mt-6 mb-2" style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: C.ink }}>
          Invoices
        </h2>
        {own.length === 0 ? (
          <span style={{ fontFamily: sans, fontSize: 13.5, color: C.slate }}>No invoices for this customer yet.</span>
        ) : (
          <div className="flex flex-col gap-2">
            {own.map((inv) => (
              <InvoiceRow key={inv.id} inv={inv} customerName={customer.name} onClick={() => openInvoice(inv.id)} />
            ))}
          </div>
        )}

        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="mt-6" style={{ fontFamily: sans, fontSize: 13.5, color: C.stampRed, fontWeight: 600 }}>
            Delete customer
          </button>
        ) : (
          <div className="flex items-center gap-3 mt-6">
            <span style={{ fontFamily: sans, fontSize: 13, color: C.slate }}>Delete this customer?</span>
            <button onClick={onDelete} style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, color: C.stampRed }}>Yes, delete</button>
            <button onClick={() => setConfirmDelete(false)} style={{ fontFamily: sans, fontSize: 13, color: C.slate }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings — business profile (used on the printed invoice) and the
// reference exchange-rate table used for the dashboard's consolidated total.
// ---------------------------------------------------------------------------
function SettingsScreen({ business, fxRates, onBack, onSaveBusiness, onSaveFxRates }) {
  const [name, setName] = useState(business?.name || "");
  const [email, setEmail] = useState(business?.email || "");
  const [address, setAddress] = useState(business?.address || "");

  const [base, setBase] = useState(fxRates?.base || "USD");
  const [rates, setRates] = useState(() => ({ ...DEFAULT_FX_RATES.rates, ...(fxRates?.rates || {}) }));
  const [savedFlash, setSavedFlash] = useState(false);

  const updateRate = (code, val) => setRates((prev) => ({ ...prev, [code]: val }));

  const saveRates = () => {
    const cleaned = {};
    CURRENCIES.forEach((c) => {
      cleaned[c.code] = c.code === base ? 1 : Number(rates[c.code]) || 0;
    });
    onSaveFxRates({ base, rates: cleaned, updatedAt: todayISO() });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  return (
    <div className="pb-10">
      <TopBar title="Settings" onBack={onBack} />

      <div className="px-4 pt-4">
        <h2 style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: C.ink }}>Business info</h2>
        <div style={{ fontFamily: sans, fontSize: 12.5, color: C.slate, marginTop: 2, marginBottom: 12 }}>
          Shown on the letterhead when you export an invoice as a PDF.
        </div>
        <Field label="Business name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Your business name" />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@yourbusiness.com" />
        </Field>
        <Field label="Address">
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>
        <GhostButton onClick={() => onSaveBusiness({ name, email, address })}>Save business info</GhostButton>

        <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${C.line}` }}>
          <h2 style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: C.ink }}>Exchange rates</h2>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: C.slate, marginTop: 2, marginBottom: 4, lineHeight: 1.5 }}>
            There's no live forex feed wired up yet, so set your home currency
            and the rates below yourself — the Dashboard uses them to show one
            combined outstanding total. Update them whenever you want current
            rates;
            {fxRates?.updatedAt ? ` last updated ${fmtDate(fxRates.updatedAt)}.` : " not set yet."}
          </div>

          <Field label="Home currency">
            <select value={base} onChange={(e) => setBase(e.target.value)} style={inputStyle}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </Field>

          <div className="flex flex-col gap-2 mt-1">
            {CURRENCIES.filter((c) => c.code !== base).map((c) => (
              <div key={c.code} className="flex items-center gap-3">
                <span style={{ fontFamily: mono, fontSize: 13, color: C.inkSoft, width: 90 }}>
                  1 {base} =
                </span>
                <TextInput
                  type="number"
                  min="0"
                  step="0.0001"
                  value={rates[c.code] ?? ""}
                  onChange={(e) => updateRate(c.code, e.target.value)}
                  style={{ flex: 1 }}
                />
                <span style={{ fontFamily: mono, fontSize: 13, color: C.slate, width: 40 }}>{c.code}</span>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <PrimaryButton onClick={saveRates}>
              {savedFlash ? <><Check size={16} /> Saved</> : "Save rates"}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom navigation
// ---------------------------------------------------------------------------
function BottomNav({ tab, goTab }) {
  const items = [
    { key: "dashboard", label: "Home", icon: LayoutGrid },
    { key: "invoices", label: "Invoices", icon: FileText },
    { key: "newInvoice", label: "New", icon: Plus, accent: true },
    { key: "customers", label: "Customers", icon: Users },
  ];
  return (
    <div
      className="flex items-stretch"
      style={{ borderTop: `1px solid ${C.line}`, background: C.paper, paddingBottom: 6 }}
    >
      {items.map((it) => {
        const active = tab === it.key;
        const Icon = it.icon;
        if (it.accent) {
          return (
            <button key={it.key} onClick={() => goTab(it.key)} className="flex-1 flex flex-col items-center justify-center py-1.5">
              <div
                className="flex items-center justify-center -mt-4"
                style={{ width: 46, height: 46, borderRadius: 999, background: C.brass, boxShadow: "0 4px 10px rgba(169,130,47,0.4)" }}
              >
                <Icon size={22} color="#fff" />
              </div>
            </button>
          );
        }
        return (
          <button key={it.key} onClick={() => goTab(it.key)} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2">
            <Icon size={20} color={active ? C.ink : C.slate} strokeWidth={active ? 2.4 : 2} />
            <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: active ? 700 : 500, color: active ? C.ink : C.slate }}>
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------
export default function InvoiceApp() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [business, setBusiness] = useState({ name: "", email: "", address: "" });
  const [fxRates, setFxRates] = useState(DEFAULT_FX_RATES);

  const [tab, setTab] = useState("dashboard");
  const [view, setView] = useState({ name: "list" }); // list | invoiceDetail | invoiceForm | customerDetail | customerForm | settings

  useEffect(() => {
    (async () => {
      try {
        const [c, i] = await Promise.all([fetchCustomers(), fetchInvoices()]);
        setCustomers(c);
        setInvoices(i);
      } catch (err) {
        console.error(err);
        setLoadError("Couldn't reach the API. Is the backend running and VITE_API_BASE set correctly?");
      }
      setBusiness(loadObjLocal("business", { name: "", email: "", address: "" }));
      setFxRates(loadObjLocal("fxRates", DEFAULT_FX_RATES));
      setLoading(false);
    })();
  }, []);

  const persistBusiness = (next) => { setBusiness(next); saveObjLocal("business", next); };
  const persistFxRates = (next) => { setFxRates(next); saveObjLocal("fxRates", next); };

  const goTab = (key) => {
    setTab(key === "newInvoice" ? "newInvoice" : key);
    setView({ name: "list" });
  };

  // Invoice CRUD — talks to the Express API; isEdit tells us POST vs PUT.
  const saveInvoice = async (inv, isEdit) => {
    const result = isEdit ? await updateInvoice(inv.id, inv) : await createInvoice(inv);
    setInvoices((prev) => (isEdit ? prev.map((i) => (i.id === result.id ? result : i)) : [...prev, result]));
    setTab("invoices");
    setView({ name: "invoiceDetail", id: result.id });
  };

  const deleteInvoice = async (id) => {
    await deleteInvoiceApi(id);
    setInvoices((prev) => prev.filter((i) => i.id !== id));
    setView({ name: "list" });
  };

  const setInvoiceStatus = async (id, status) => {
    const result = await setInvoiceStatusApi(id, status);
    setInvoices((prev) => prev.map((i) => (i.id === id ? result : i)));
  };

  // Customer CRUD
  const saveCustomer = async (c, isEdit) => {
    const result = isEdit ? await updateCustomer(c.id, c) : await createCustomer(c);
    setCustomers((prev) => (isEdit ? prev.map((x) => (x.id === result.id ? result : x)) : [...prev, result]));
    setTab("customers");
    setView({ name: "customerDetail", id: result.id });
  };

  const deleteCustomer = async (id) => {
    await deleteCustomerApi(id);
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    setView({ name: "list" });
  };

  let content = null;

  if (loading) {
    content = (
      <div className="flex items-center justify-center h-full">
        <span style={{ fontFamily: serif, color: C.slate, fontSize: 14 }}>Loading ledger…</span>
      </div>
    );
  } else if (loadError) {
    content = (
      <div className="flex flex-col items-center text-center px-8 py-16">
        <AlertCircle size={28} color={C.stampRed} />
        <div style={{ fontFamily: sans, fontSize: 14, color: C.stampRed, marginTop: 10, lineHeight: 1.5 }}>
          {loadError}
        </div>
      </div>
    );
  } else if (tab === "newInvoice" || view.name === "invoiceForm") {
    const initial = view.name === "invoiceForm" ? invoices.find((i) => i.id === view.id) : null;
    content = (
      <InvoiceForm
        initial={initial}
        customers={customers}
        onCancel={() => (initial ? setView({ name: "invoiceDetail", id: initial.id }) : goTab("dashboard"))}
        onSave={(inv) => saveInvoice(inv, Boolean(initial))}
        onNewCustomer={() => { setTab("customers"); setView({ name: "customerForm" }); }}
      />
    );
  } else if (tab === "dashboard" && view.name === "list") {
    content = (
      <Dashboard
        invoices={invoices}
        customers={customers}
        openInvoice={(id) => setView({ name: "invoiceDetail", id })}
        goTab={goTab}
        fxRates={fxRates}
        openSettings={() => setView({ name: "settings" })}
      />
    );
  } else if (tab === "invoices" && view.name === "list") {
    content = <InvoiceList invoices={invoices} customers={customers} openInvoice={(id) => setView({ name: "invoiceDetail", id })} goTab={goTab} />;
  } else if (view.name === "invoiceDetail") {
    const inv = invoices.find((i) => i.id === view.id);
    const customer = customers.find((c) => c.id === inv?.customerId);
    content = inv ? (
      <InvoiceDetail
        inv={inv}
        customer={customer}
        business={business}
        onBack={() => setView({ name: "list" })}
        onEdit={() => setView({ name: "invoiceForm", id: inv.id })}
        onDelete={() => deleteInvoice(inv.id)}
        onSetStatus={(s) => setInvoiceStatus(inv.id, s)}
      />
    ) : null;
  } else if (tab === "customers" && view.name === "list") {
    content = (
      <CustomerList
        customers={customers}
        invoices={invoices}
        openCustomer={(id) => setView({ name: "customerDetail", id })}
        onAdd={() => setView({ name: "customerForm" })}
      />
    );
  } else if (view.name === "customerForm") {
    const initial = view.id ? customers.find((c) => c.id === view.id) : null;
    content = (
      <CustomerForm
        initial={initial}
        onCancel={() => setView(initial ? { name: "customerDetail", id: initial.id } : { name: "list" })}
        onSave={(c) => saveCustomer(c, Boolean(initial))}
      />
    );
  } else if (view.name === "customerDetail") {
    const customer = customers.find((c) => c.id === view.id);
    content = customer ? (
      <CustomerDetail
        customer={customer}
        invoices={invoices}
        onBack={() => setView({ name: "list" })}
        onEdit={() => setView({ name: "customerForm", id: customer.id })}
        onDelete={() => deleteCustomer(customer.id)}
        openInvoice={(id) => setView({ name: "invoiceDetail", id })}
      />
    ) : null;
  } else if (view.name === "settings") {
    content = (
      <SettingsScreen
        business={business}
        fxRates={fxRates}
        onBack={() => setView({ name: "list" })}
        onSaveBusiness={persistBusiness}
        onSaveFxRates={persistFxRates}
      />
    );
  }

  const titles = { dashboard: "Ledger", invoices: "Invoices", customers: "Customers" };
  const showTopBar = view.name === "list" && tab !== "newInvoice";
  const showBottomNav = view.name === "list" || tab === "newInvoice";

  return (
    <div className="flex items-center justify-center w-full h-full min-h-screen" style={{ background: "#D8D4C6" }}>
      <style>{`
        .printable-invoice { display: none; }
        @media print {
          body * { visibility: hidden; }
          .printable-invoice, .printable-invoice * { visibility: visible; }
          .printable-invoice {
            display: block;
            position: absolute;
            top: 0; left: 0;
            width: 100%;
          }
        }
      `}</style>
      <div
        className="relative flex flex-col w-full"
        style={{
          maxWidth: 420,
          height: "100vh",
          maxHeight: 900,
          background: C.paper,
          fontFamily: sans,
          boxShadow: "0 20px 60px rgba(27,35,64,0.35)",
        }}
      >
        {showTopBar && (
          <TopBar
            title={titles[tab]}
            right={
              tab === "customers" ? (
                <button onClick={() => setView({ name: "customerForm" })} className="p-1" aria-label="Add customer">
                  <Plus size={20} color={C.ink} />
                </button>
              ) : tab === "invoices" ? (
                <button onClick={() => goTab("newInvoice")} className="p-1" aria-label="New invoice">
                  <Plus size={20} color={C.ink} />
                </button>
              ) : null
            }
          />
        )}
        <div className="flex-1 overflow-y-auto">{content}</div>
        {showBottomNav && <BottomNav tab={tab} goTab={goTab} />}
      </div>
    </div>
  );
}
