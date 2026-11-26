/* eslint-disable @typescript-eslint/no-explicit-any -- a loosely typed stand-in for supabase-js */
/**
 * An in-memory stand-in for the three Phase 3 tables, answering the
 * supabase-js calls src/lib/notify makes: select / insert / update / upsert /
 * delete with eq, is and gt filters, maybeSingle, and the notification_claim
 * RPC. It keeps the migration's unique keys — the 23505s the code relies on
 * — and the claim's rule. Not a database: the dry-run against Postgres
 * (supabase/migrations/20261125203540_notifications.sql) checks the SQL.
 */
type Row = Record<string, any>;
type Result = { data: any; error: { code: string; message: string } | null };

const UNIQUE: Record<string, ((a: Row, b: Row) => boolean)[]> = {
  notifications: [(a, b) => a.dedupe_key === b.dedupe_key],
  notification_channels: [
    (a, b) => a.user_id === b.user_id && a.kind === b.kind,
    (a, b) => a.kind === "telegram" && b.kind === "telegram" && a.telegram_chat_id === b.telegram_chat_id,
  ],
  channel_link_tokens: [(a, b) => a.token_hash === b.token_hash],
};

const DEFAULTS: Record<string, () => Row> = {
  notifications: () => ({ status: "pending", attempts: 0, claimed_until: null, last_error: null, sent_at: null }),
  notification_channels: () => ({ email: null, telegram_chat_id: null, telegram_username: null, verified_at: null, disabled_at: null }),
  channel_link_tokens: () => ({ email: null, used_at: null }),
};

export class FakeDb {
  tables: Record<string, Row[]> = { notifications: [], notification_channels: [], channel_link_tokens: [] };
  private n = 0;
  /** Calls seen, "table.op" or "rpc.name". */
  calls: string[] = [];

  nextId() {
    return `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`;
  }
  from(table: string) {
    if (!this.tables[table]) throw new Error(`FakeDb: unexpected table ${table}`);
    return new Query(this, table);
  }
  async rpc(fn: string, args: any): Promise<Result> {
    this.calls.push(`rpc.${fn}`);
    if (fn !== "notification_claim") throw new Error(`FakeDb: unexpected rpc ${fn}`);
    const row = this.tables.notifications.find((r) => r.id === args.p_id);
    const now = Date.now();
    const lapsed = row?.status === "sending" && row.claimed_until && Date.parse(row.claimed_until) < now;
    if (!row || !(row.status === "pending" || row.status === "failed" || lapsed)) return { data: [], error: null };
    row.status = "sending";
    row.attempts += 1;
    row.claimed_until = new Date(now + args.p_lease_seconds * 1000).toISOString();
    return { data: [{ ...row }], error: null };
  }
  clashes(table: string, row: Row, except?: Row): boolean {
    return this.tables[table].some((other) => other !== except && UNIQUE[table].some((same) => same(row, other)));
  }
}

const duplicate: Result = { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private values: Row = {};
  private onConflict: string[] = [];
  private filters: ((r: Row) => boolean)[] = [];
  private returning = false;
  private single = false;

  constructor(
    private db: FakeDb,
    private table: string
  ) {}

  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(values: Row) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.values = values;
    return this;
  }
  upsert(values: Row, opts: { onConflict: string }) {
    this.op = "upsert";
    this.values = values;
    this.onConflict = opts.onConflict.split(",").map((c) => c.trim());
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((r) => r[column] === value || r[column] === undefined);
    return this;
  }
  gt(column: string, value: string) {
    this.filters.push((r) => r[column] > value);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then<A = Result, B = never>(ok?: ((r: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, fail);
  }

  private answer(rows: Row[]): Result {
    const copies = rows.map((r) => ({ ...r }));
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    return { data: this.single ? (copies[0] ?? null) : copies, error: null };
  }

  private run(): Result {
    this.db.calls.push(`${this.table}.${this.op}`);
    const rows = this.db.tables[this.table];
    const matching = () => rows.filter((r) => this.filters.every((f) => f(r)));
    switch (this.op) {
      case "select":
        return this.answer(matching());
      case "insert": {
        const row = { id: this.db.nextId(), created_at: new Date().toISOString(), ...DEFAULTS[this.table](), ...this.values };
        if (this.db.clashes(this.table, row)) return duplicate;
        rows.push(row);
        return this.answer([row]);
      }
      case "update": {
        const hit = matching();
        for (const r of hit) {
          const next = { ...r, ...this.values };
          if (this.db.clashes(this.table, next, r)) return duplicate;
          Object.assign(r, this.values);
        }
        return this.answer(hit);
      }
      case "upsert": {
        const existing = rows.find((r) => this.onConflict.every((c) => r[c] === this.values[c]));
        if (existing) {
          const next = { ...existing, ...this.values };
          if (this.db.clashes(this.table, next, existing)) return duplicate;
          Object.assign(existing, this.values);
          return this.answer([existing]);
        }
        const row = { id: this.db.nextId(), created_at: new Date().toISOString(), ...DEFAULTS[this.table](), ...this.values };
        if (this.db.clashes(this.table, row)) return duplicate;
        rows.push(row);
        return this.answer([row]);
      }
      case "delete": {
        const hit = matching();
        this.db.tables[this.table] = rows.filter((r) => !hit.includes(r));
        return this.answer(hit);
      }
    }
  }
}
