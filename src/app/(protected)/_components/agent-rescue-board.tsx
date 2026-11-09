"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";

import { cancelOrderAction, confirmOrderAction, recordCallAction, type ActionState } from "@/modules/orders/workflow-actions";
import type { PriorityLevel } from "@/modules/rescue/domain/priority";

import type { RescueBoardItem, RescueBoardSummary } from "./rescue-board";

/** Agent Rescue Center: the agent's own queue with quick workflow actions, charts and a guide. Plain props only. */

export type AgentBoardItem = RescueBoardItem & {
  version: number;
  can: { answer: boolean; noAnswer: boolean; confirm: boolean; cancel: boolean };
};

type Action = "answered" | "no_answer" | "confirm" | "refuse";

const LEVELS: PriorityLevel[] = ["urgent", "high", "normal", "low"];
const LEVEL_LABEL: Record<PriorityLevel, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const LEVEL_COLOR: Record<PriorityLevel, string> = {
  urgent: "var(--ov-cancelled)",
  high: "var(--ov-no-answer)",
  normal: "var(--ov-new)",
  low: "#6b6e85",
};
const LEVEL_GUIDE: Record<PriorityLevel, string> = {
  urgent: "Highest score. Work these first.",
  high: "Important. Work these after the urgent ones.",
  normal: "Routine. Work through them in order.",
  low: "Lowest score. Handle them once the queue is clear.",
};
const REASON_COLORS = ["var(--ov-accent)", "var(--ov-new)", "var(--ov-confirmed)", "var(--ov-no-answer)", "var(--ov-cancelled)", "var(--ov-called)"];
/** Time for the exit transition before a finished order is removed. Matches .ar-leaving in globals.css. */
const LEAVE_MS = 420;
const IDLE: ActionState = { ok: false, message: null };

const count = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const style = (vars: Record<string, string>) => vars as CSSProperties;

/** Calls the existing workflow actions. The order version is sent so a stale screen cannot overwrite newer data. */
async function runAction(item: AgentBoardItem, action: Action): Promise<ActionState> {
  const data = new FormData();
  data.set("orderId", item.id);
  data.set("expectedVersion", String(item.version));
  if (action === "confirm") return confirmOrderAction(IDLE, data);
  if (action === "refuse") {
    data.set("reason", "refused");
    return cancelOrderAction(IDLE, data);
  }
  data.set("outcome", action);
  data.set("idempotencyKey", crypto.randomUUID());
  return recordCallAction(IDLE, data);
}

function mark(setter: Dispatch<SetStateAction<Set<string>>>, id: string, on: boolean) {
  setter((previous) => {
    const next = new Set(previous);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
}

export function AgentRescueBoard({
  items,
  summary,
}: {
  items: AgentBoardItem[];
  summary: RescueBoardSummary;
}) {
  const router = useRouter();
  const [level, setLevel] = useState<"all" | PriorityLevel>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Orders finished this session. They are removed for good, so a refresh never brings them back.
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  // Orders playing their exit transition right now.
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [messages, setMessages] = useState<Record<string, string>>({});
  // The order waiting for Refuse confirmation. Set only when the dialog is open; cancelling it writes nothing.
  const [refusing, setRefusing] = useState<AgentBoardItem | null>(null);

  const visible = useMemo(() => items.filter((item) => !finished.has(item.id)), [items, finished]);

  const counts = useMemo(() => {
    const totals: Record<PriorityLevel, number> = { urgent: 0, high: 0, normal: 0, low: 0 };
    for (const item of visible) totals[item.level] += 1;
    return totals;
  }, [visible]);

  const actionMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of visible) map.set(item.action, (map.get(item.action) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [visible]);
  const maxAction = Math.max(1, ...actionMix.map(([, total]) => total));

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visible.filter(
      (item) =>
        (level === "all" || item.level === level) &&
        (needle === "" || [item.ref, item.customer, item.city, item.status].some((value) => value.toLowerCase().includes(needle))),
    );
  }, [visible, level, query]);

  // The hero always shows the first order that is not already leaving, so the next one slides in as soon as one finishes.
  const hero = visible.find((item) => !leaving.has(item.id)) ?? null;
  const heroTotal = hero ? hero.reasons.reduce((sum, reason) => sum + Math.max(0, reason.points), 0) : 0;

  async function act(item: AgentBoardItem, action: Action) {
    if (busy.has(item.id) || leaving.has(item.id)) return;
    mark(setBusy, item.id, true);
    setMessages((previous) => ({ ...previous, [item.id]: "" }));

    let result: ActionState;
    try {
      result = await runAction(item, action);
    } catch {
      result = { ok: false, message: "Something went wrong. Try again." };
    }
    mark(setBusy, item.id, false);

    if (!result.ok) {
      setMessages((previous) => ({ ...previous, [item.id]: result.message ?? "This order could not be updated." }));
      return;
    }

    if (action === "confirm" || action === "refuse") {
      mark(setLeaving, item.id, true);
      window.setTimeout(() => {
        mark(setFinished, item.id, true);
        mark(setLeaving, item.id, false);
      }, LEAVE_MS);
    }
    router.refresh();
  }

  const toggleExpanded = (id: string) => mark(setExpanded, id, !expanded.has(id));

  const kpis: Array<[string, number, string]> = [
    ["Active orders", summary.active, "var(--ov-new)"],
    ["Need attention", summary.needsAttention, "var(--ov-no-answer)"],
    ["Two unanswered", summary.closeToCancel, "var(--ov-called)"],
    ["Not contacted", summary.uncontacted, "var(--ov-cancelled)"],
    ["Need a data check", summary.dataIssues, "#6b6e85"],
  ];

  return (
    <div className="ar-board">
      {/* Keyed by order, so each new hero card replays its entrance instead of patching the old one. */}
      <section key={hero?.id ?? "none"} className="ar-hero" aria-labelledby="ar-next">
        {hero === null ? (
          <div className="ar-hero-main">
            <p id="ar-next" className="ar-eyebrow">Next recommended order</p>
            <p className="ar-lead">{visible.length === 0 ? "Your queue is clear. Nice work." : "Nothing needs action right now."}</p>
          </div>
        ) : (
          <>
            <div className="ar-hero-main">
              <p id="ar-next" className="ar-eyebrow">
                <span className="ar-live" aria-hidden="true" />
                Next recommended order
              </p>
              <div className="ar-hero-title">
                <span className="ar-ref">{hero.ref}</span>
                <span className={`ar-pill ar-pill-${hero.level}`}>{LEVEL_LABEL[hero.level]}</span>
                <span className="ar-action">{hero.action}</span>
              </div>
              <p className="ar-muted">{hero.customer} · {hero.city}</p>
              <div className="ar-hero-actions">
                <Link href={`/agent/orders/${hero.id}`} className="btn btn-primary ar-open">
                  Open order
                </Link>
              </div>
            </div>
            <div className="ar-hero-why">
              <p className="ar-eyebrow">Why it is first · score {hero.score}</p>
              <div className="ar-stack" role="img" aria-label={`Score made of ${hero.reasons.filter((r) => r.points > 0).length} rules`}>
                {hero.reasons
                  .filter((reason) => reason.points > 0)
                  .map((reason, index) => (
                    <span
                      key={reason.code}
                      className="ar-stack-seg"
                      style={style({
                        "--w": `${percent(reason.points, heroTotal)}%`,
                        "--c": REASON_COLORS[index % REASON_COLORS.length],
                        "--d": `${index * 120}ms`,
                      })}
                    />
                  ))}
              </div>
              <ul className="ar-why">
                {hero.reasons.map((reason, index) => (
                  <li key={reason.code}>
                    <span className="ar-dot" style={style({ "--c": REASON_COLORS[index % REASON_COLORS.length] })} aria-hidden="true" />
                    <span>{reason.text}</span>
                    {reason.points > 0 ? <span className="ar-points">+{reason.points}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      <dl className="ar-kpis">
        {kpis.map(([label, value, tone], index) => (
          <div key={label} className="ar-kpi" style={style({ "--i": String(index), "--c": tone })}>
            <dt>{label}</dt>
            <dd>{count(value)}</dd>
          </div>
        ))}
      </dl>

      <div className="ar-analytics">
        <section className="ar-panel" aria-labelledby="ar-mix">
          <div className="ar-panel-head">
            <h2 id="ar-mix">Priority mix</h2>
            <span className="ar-hint">Tap a segment to filter</span>
          </div>
          <div className="ar-mix" role="group" aria-label="Filter by priority">
            {LEVELS.map((value, index) => (
              <button
                key={value}
                type="button"
                className="ar-seg"
                aria-pressed={level === value}
                aria-label={`${LEVEL_LABEL[value]}: ${counts[value]}`}
                style={style({ "--w": `${percent(counts[value], visible.length)}%`, "--c": LEVEL_COLOR[value], "--d": `${index * 90}ms` })}
                onClick={() => setLevel(level === value ? "all" : value)}
              />
            ))}
          </div>
          <ul className="ar-legend">
            {LEVELS.map((value) => (
              <li key={value}>
                <span className="ar-sw" style={style({ "--c": LEVEL_COLOR[value] })} aria-hidden="true" />
                {LEVEL_LABEL[value]}
                <strong>{count(counts[value])}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="ar-panel" aria-labelledby="ar-actions">
          <div className="ar-panel-head">
            <h2 id="ar-actions">What to do next</h2>
            <span className="ar-hint">{count(visible.length)} orders</span>
          </div>
          {actionMix.length === 0 ? (
            <p className="ar-muted">No actions to show yet.</p>
          ) : (
            <ul className="ar-bars">
              {actionMix.map(([label, total], index) => (
                <li key={label} className="ar-bar-row">
                  <span>{label}</span>
                  <span className="ar-bar-track" aria-hidden="true">
                    <span className="ar-bar-fill" style={style({ "--w": `${percent(total, maxAction)}%`, "--d": `${index * 80}ms` })} />
                  </span>
                  <strong>{count(total)}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ar-panel" aria-labelledby="ar-guide">
          <div className="ar-panel-head">
            <h2 id="ar-guide">How to work this queue</h2>
          </div>
          <ol className="ar-steps">
            <li><strong>Start at the top.</strong> The list is sorted by score, highest first.</li>
            <li><strong>Read the reasons.</strong> Each point comes from a fixed rule you can see.</li>
            <li><strong>Record calls as you go.</strong> Answered and No answer keep the order in the queue.</li>
            <li><strong>Confirm or refuse</strong> to finish an order. It leaves the queue for good.</li>
          </ol>
          <ul className="ar-levels">
            {LEVELS.map((value) => (
              <li key={value}>
                <span className={`ar-pill ar-pill-${value}`}>{LEVEL_LABEL[value]}</span>
                {LEVEL_GUIDE[value]}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="ar-queue" aria-labelledby="ar-queue">
        <div className="ar-toolbar">
          <h2 id="ar-queue">My queue</h2>
          <div className="ar-chips" role="group" aria-label="Priority filter">
            <button type="button" className="ar-chip" aria-pressed={level === "all"} onClick={() => setLevel("all")}>
              All <span>{count(visible.length)}</span>
            </button>
            {LEVELS.map((value) => (
              <button key={value} type="button" className="ar-chip" aria-pressed={level === value} onClick={() => setLevel(value)}>
                {LEVEL_LABEL[value]} <span>{count(counts[value])}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            className="ar-search"
            placeholder="Order, customer, city or status"
            aria-label="Search your queue"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <p role="status" aria-live="polite" className="ar-hint">
          Showing {count(filtered.length)} of {count(visible.length)} orders
        </p>

        {visible.length === 0 ? (
          <p className="ar-empty">No active orders need action right now.</p>
        ) : filtered.length === 0 ? (
          <div className="ar-empty">
            <p>No orders match this filter.</p>
            <button type="button" className="btn btn-ghost" onClick={() => { setLevel("all"); setQuery(""); }}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="ar-table-wrap">
            <table className="ar-table">
              <thead>
                <tr>
                  <th scope="col">Priority</th>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">City</th>
                  <th scope="col">Status</th>
                  <th scope="col">Next action</th>
                  <th scope="col">Why</th>
                  <th scope="col">Last call</th>
                  <th scope="col">Act</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, index) => {
                  const isOpen = expanded.has(item.id);
                  const shown = isOpen ? item.reasons : item.reasons.slice(0, 2);
                  const isLeaving = leaving.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={isLeaving ? "ar-row ar-leaving" : "ar-row"}
                      style={style({ "--i": String(Math.min(index, 12)) })}
                    >
                      <td>
                        <span className={`ar-pill ar-pill-${item.level}`}>{LEVEL_LABEL[item.level]}</span>
                        <span className="ar-score">Score {item.score}</span>
                      </td>
                      <td>
                        <Link href={`/agent/orders/${item.id}`} className="ar-ref-link">{item.ref}</Link>
                      </td>
                      <td>{item.customer}</td>
                      <td>{item.city}</td>
                      <td><span className="ar-status">{item.status}</span></td>
                      <td className="ar-strong">{item.action}</td>
                      <td className="ar-why-cell">
                        <ul className="ar-why-list">
                          {shown.map((reason) => (
                            <li key={reason.code}>
                              <span>{reason.text}</span>
                              {reason.points > 0 ? <span className="ar-points">+{reason.points}</span> : null}
                            </li>
                          ))}
                        </ul>
                        {item.reasons.length > 2 ? (
                          <button type="button" className="ar-more" aria-expanded={isOpen} onClick={() => toggleExpanded(item.id)}>
                            {isOpen ? "Show less" : `+${item.reasons.length - 2} more`}
                          </button>
                        ) : null}
                      </td>
                      <td className="ar-last">{item.last}</td>
                      <td className="ar-act-cell">
                        <ActionButtons item={item} busy={busy} onAct={act} onRefuse={setRefusing} />
                        {messages[item.id] ? <p role="status" className="ar-row-msg">{messages[item.id]}</p> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RefuseDialog
        item={refusing}
        onCancel={() => setRefusing(null)}
        onConfirm={(target) => {
          // Closing first keeps the result on the row, next to the action that produced it.
          setRefusing(null);
          void act(target, "refuse");
        }}
      />
    </div>
  );
}

function RefuseDialog({
  item,
  onCancel,
  onConfirm,
}: {
  item: AgentBoardItem | null;
  onCancel: () => void;
  onConfirm: (item: AgentBoardItem) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // Keep the native modal in step with state. Escape and the Keep button both close it, and the close event clears state.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);

  return (
    <dialog
      ref={ref}
      className="ar-dialog"
      aria-labelledby="ar-refuse-title"
      aria-describedby="ar-refuse-desc"
      onClose={onCancel}
    >
      {item ? (
        <div className="ar-dialog-body">
          <h2 id="ar-refuse-title">Refuse order {item.ref}?</h2>
          <p id="ar-refuse-desc">
            This cancels {item.ref} for {item.customer} as refused and removes it from your queue. Nothing changes until you confirm.
          </p>
          <div className="ar-dialog-actions">
            {/* Keep order comes first, so it gets focus when the dialog opens and Enter is the safe choice. */}
            <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
              Keep order
            </button>
            <button type="button" className="btn ar-dialog-refuse" onClick={() => onConfirm(item)}>
              Refuse order
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

function ActionButtons({
  item,
  busy,
  onAct,
  onRefuse,
}: {
  item: AgentBoardItem;
  busy: Set<string>;
  onAct: (item: AgentBoardItem, action: Action) => void;
  onRefuse: (item: AgentBoardItem) => void;
}) {
  const isBusy = busy.has(item.id);
  return (
    <div className="ar-acts" role="group" aria-label={`Actions for ${item.ref}`}>
      <button type="button" className="ar-act ar-act-call" disabled={!item.can.answer || isBusy} onClick={() => onAct(item, "answered")}>
        Answered
      </button>
      <button type="button" className="ar-act ar-act-call" disabled={!item.can.noAnswer || isBusy} onClick={() => onAct(item, "no_answer")}>
        No answer
      </button>
      <button type="button" className="ar-act ar-act-confirm" disabled={!item.can.confirm || isBusy} onClick={() => onAct(item, "confirm")}>
        Confirm
      </button>
      <button type="button" className="ar-act ar-act-refuse" disabled={!item.can.cancel || isBusy} onClick={() => onRefuse(item)}>
        Refuse
      </button>
    </div>
  );
}
