// `AISettingsStore` over SQLite: labelled OpenRouter keys, labelled models, and
// the single row that says which of them are active and whether narration runs
// mock or live.
//
// App-global, not player-scoped — modelled on `players.ts` rather than
// `sessions.ts`. The settings page is reachable before anyone has picked a
// profile, so there is no player to scope to, and the choice is a property of
// this installation rather than of a person.
//
// Two invariants live here rather than in the schema:
//
//   - `source = 'env'` rows belong to the filesystem. `replaceEnvRows()` deletes
//     all of them and re-inserts, so a label dropped from a file disappears;
//     the mutating methods refuse to touch one so the UI cannot make an edit
//     that the next restart would silently undo.
//   - A selection is a label, not a foreign key, and may point at nothing. It is
//     resolved on read, and `openrouter` mode with an unresolvable selection
//     reads back as mock rather than as a broken live configuration.

import type {
  AIKeyRecord,
  AIModelRecord,
  AISettingsRecord,
  AISettingsStore,
  AISettingsUpdate,
} from "../context.ts";
import type { Db, SqlValue } from "./client.ts";
import type { AIEnvSettings } from "../ai-settings-env.ts";

const SETTINGS_ID = "singleton";

/**
 * How each settings column is written. A key absent from this map is not
 * patchable, so no caller-supplied name reaches the SQL — the same guard
 * `sessions.ts` uses.
 */
const SETTINGS_ENCODERS: Record<
  keyof AISettingsUpdate,
  (value: unknown) => SqlValue
> = {
  ai_mode: (value) => String(value),
  ai_key_label: (value) => (value === null ? null : String(value)),
  ai_model_label: (value) => (value === null ? null : String(value)),
};

/** Thrown when a caller tries to edit or delete a row the environment owns. */
export class EnvRowLockedError extends Error {
  constructor(label: string) {
    super(
      `"${label}" comes from an environment file and is rewritten on every ` +
        "start. Edit or remove it there instead.",
    );
    this.name = "EnvRowLockedError";
  }
}

/**
 * Thrown when the caller's input cannot describe a valid configuration: an
 * empty label or value, a selection naming something that is not stored, or a
 * request for live narration with no key and model to call.
 *
 * Distinct from `EnvRowLockedError`, which is a conflict with a row's owner
 * rather than a malformed request — the endpoints map the two to 400 and 409.
 */
export class InvalidLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLabelError";
  }
}

/**
 * Labels are compared and stored lowercased so the picker cannot end up showing
 * `Work` and `work` as two different choices — the environment already
 * lowercases, and a typed one has to agree with it.
 */
function normalizeLabel(raw: string): string {
  const label = raw.trim().toLowerCase();
  if (!label) throw new InvalidLabelError("Label must not be empty.");
  if (label.length > 60) {
    throw new InvalidLabelError("Label must be 60 characters or fewer.");
  }
  return label;
}

function toKeyRecord(row: Record<string, unknown>): AIKeyRecord {
  return {
    label: String(row.label),
    api_key: String(row.api_key),
    source: row.source === "env" ? "env" : "user",
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function toModelRecord(row: Record<string, unknown>): AIModelRecord {
  return {
    label: String(row.label),
    model_id: String(row.model_id),
    source: row.source === "env" ? "env" : "user",
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function toSettingsRecord(row: Record<string, unknown>): AISettingsRecord {
  return {
    ai_mode: row.ai_mode === "openrouter" ? "openrouter" : "mock",
    ai_key_label: row.ai_key_label === null ? null : String(row.ai_key_label),
    ai_model_label:
      row.ai_model_label === null ? null : String(row.ai_model_label),
    updated_at: String(row.updated_at),
  };
}

export function createAISettingsStore(db: Db): AISettingsStore {
  const store: AISettingsStore = {
    listKeys() {
      return db
        .prepare("select * from ai_keys order by label asc")
        .all()
        .map(toKeyRecord);
    },

    getKey(label) {
      const row = db
        .prepare("select * from ai_keys where label = ?")
        .get(normalizeLabel(label));
      return row ? toKeyRecord(row) : null;
    },

    listModels() {
      return db
        .prepare("select * from ai_models order by label asc")
        .all()
        .map(toModelRecord);
    },

    getModel(label) {
      const row = db
        .prepare("select * from ai_models where label = ?")
        .get(normalizeLabel(label));
      return row ? toModelRecord(row) : null;
    },

    putKey(label, apiKey) {
      const normalized = normalizeLabel(label);
      const value = apiKey.trim();
      if (!value) throw new InvalidLabelError("API key must not be empty.");

      const existing = store.getKey(normalized);
      if (existing?.source === "env") throw new EnvRowLockedError(normalized);

      const now = new Date().toISOString();
      db.prepare(
        `insert into ai_keys (label, api_key, source, created_at, updated_at)
         values (?, ?, 'user', ?, ?)
         on conflict(label) do update set api_key = excluded.api_key,
                                          updated_at = excluded.updated_at`,
      ).run(normalized, value, now, now);

      return store.getKey(normalized)!;
    },

    putModel(label, modelId) {
      const normalized = normalizeLabel(label);
      const value = modelId.trim();
      if (!value) throw new InvalidLabelError("Model ID must not be empty.");

      const existing = store.getModel(normalized);
      if (existing?.source === "env") throw new EnvRowLockedError(normalized);

      const now = new Date().toISOString();
      db.prepare(
        `insert into ai_models (label, model_id, source, created_at, updated_at)
         values (?, ?, 'user', ?, ?)
         on conflict(label) do update set model_id = excluded.model_id,
                                          updated_at = excluded.updated_at`,
      ).run(normalized, value, now, now);

      return store.getModel(normalized)!;
    },

    deleteKey(label) {
      const normalized = normalizeLabel(label);
      const existing = store.getKey(normalized);
      if (!existing) return false;
      if (existing.source === "env") throw new EnvRowLockedError(normalized);

      // The selection is cleared in the same transaction, so the settings row
      // can never be left naming a key that has just stopped existing.
      db.transaction(() => {
        db.prepare("delete from ai_keys where label = ?").run(normalized);
        clearDanglingSelections(db);
      });

      return true;
    },

    deleteModel(label) {
      const normalized = normalizeLabel(label);
      const existing = store.getModel(normalized);
      if (!existing) return false;
      if (existing.source === "env") throw new EnvRowLockedError(normalized);

      db.transaction(() => {
        db.prepare("delete from ai_models where label = ?").run(normalized);
        clearDanglingSelections(db);
      });

      return true;
    },

    getSettings() {
      const row = db
        .prepare("select * from app_settings where id = ?")
        .get(SETTINGS_ID);
      if (row) return toSettingsRecord(row);

      // First read on a database that has never been written to. Insert the
      // default rather than returning a phantom, so the row the page updates
      // always exists.
      const now = new Date().toISOString();
      db.prepare(
        `insert into app_settings (id, ai_mode, ai_key_label, ai_model_label, updated_at)
         values (?, 'mock', null, null, ?)
         on conflict(id) do nothing`,
      ).run(SETTINGS_ID, now);

      return toSettingsRecord(
        db.prepare("select * from app_settings where id = ?").get(SETTINGS_ID)!,
      );
    },

    updateSettings(update) {
      // Read first: it creates the row if this is a fresh database, and gives
      // the merged view the validation below needs.
      const current = store.getSettings();
      const merged: AISettingsRecord = {
        ...current,
        ...Object.fromEntries(
          Object.entries(update).filter(([, value]) => value !== undefined),
        ),
      } as AISettingsRecord;

      // Only what this call is *setting* is validated, not what it inherits.
      //
      // A selection can already be dangling — the environment reseed drops a
      // label the files stopped naming, and it does that behind the player's
      // back. Validating the inherited value too would lock the page: with both
      // labels gone, switching back to mock would be refused for naming a key
      // that no longer exists, and there would be no way out of the broken
      // state from the only screen that can fix it.
      const settingKey = update.ai_key_label;
      if (settingKey !== undefined && settingKey !== null && !store.getKey(settingKey)) {
        throw new InvalidLabelError(`No API key is stored under "${settingKey}".`);
      }

      const settingModel = update.ai_model_label;
      if (
        settingModel !== undefined &&
        settingModel !== null &&
        !store.getModel(settingModel)
      ) {
        throw new InvalidLabelError(`No model is stored under "${settingModel}".`);
      }

      // Asking for live narration is refused when there is nothing to call.
      // Rejected at the write rather than repaired at the read, so a stored
      // `openrouter` is something the runtime can trust — but only when the
      // caller asked for it. An inherited `openrouter` that a reseed has since
      // broken is written through and reported by `resolve()`, which falls back
      // to mock and names the missing label.
      if (update.ai_mode === "openrouter") {
        const key =
          merged.ai_key_label === null ? null : store.getKey(merged.ai_key_label);
        const model =
          merged.ai_model_label === null ? null : store.getModel(merged.ai_model_label);

        if (!key || !model) {
          throw new InvalidLabelError(
            "Real AI needs both an API key and a model selected.",
          );
        }
      }

      const assignments: string[] = [];
      const values: SqlValue[] = [];

      for (const [column, encode] of Object.entries(SETTINGS_ENCODERS)) {
        const value = update[column as keyof AISettingsUpdate];
        if (value === undefined) continue;
        assignments.push(`${column} = ?`);
        values.push(encode(value));
      }

      if (assignments.length > 0) {
        assignments.push("updated_at = ?");
        values.push(new Date().toISOString());
        db.prepare(
          `update app_settings set ${assignments.join(", ")} where id = ?`,
        ).run(...values, SETTINGS_ID);
      }

      return store.getSettings();
    },

    resolve() {
      const settings = store.getSettings();
      const key =
        settings.ai_key_label === null
          ? null
          : store.getKey(settings.ai_key_label);
      const model =
        settings.ai_model_label === null
          ? null
          : store.getModel(settings.ai_model_label);

      // A selection can name a label the last reseed removed. That is not an
      // error — the file changed, the choice did not — so it reads back as
      // mock, with the stale label reported so the page can say what went
      // missing.
      const wantsLive = settings.ai_mode === "openrouter";
      const live = wantsLive && key !== null && model !== null;

      // Only reported while live is what was chosen. A dangling selection under
      // mock is not causing anything: saying narration "fell back to mock"
      // when mock is what the player asked for would be a warning about
      // nothing, and it would not clear until they also cleared the selection.
      return {
        mode: live ? "openrouter" : "mock",
        stored_mode: settings.ai_mode,
        key,
        model,
        missing_key_label: wantsLive && key === null ? settings.ai_key_label : null,
        missing_model_label: wantsLive && model === null ? settings.ai_model_label : null,
      };
    },

    replaceEnvRows(env: AIEnvSettings) {
      db.transaction(() => {
        // Clear and re-insert rather than upsert: a label the files no longer
        // mention has to disappear, and an upsert would leave it behind.
        db.prepare("delete from ai_keys where source = 'env'").run();
        db.prepare("delete from ai_models where source = 'env'").run();

        const now = new Date().toISOString();

        for (const key of env.keys) {
          const label = normalizeLabel(key.label);
          // A user row of the same name wins: the player typed it, and the
          // startup seed must not overwrite what they chose to keep.
          db.prepare(
            `insert into ai_keys (label, api_key, source, created_at, updated_at)
             values (?, ?, 'env', ?, ?)
             on conflict(label) do nothing`,
          ).run(label, key.api_key, now, now);
        }

        for (const model of env.models) {
          const label = normalizeLabel(model.label);
          db.prepare(
            `insert into ai_models (label, model_id, source, created_at, updated_at)
             values (?, ?, 'env', ?, ?)
             on conflict(label) do nothing`,
          ).run(label, model.model_id, now, now);
        }
      });
    },
  };

  return store;
}

/**
 * Drops a selection that no longer names a row, and steps back to mock when
 * that leaves live narration with nothing to call.
 *
 * `resolve()` already treats a dangling selection as mock, so this is tidying
 * rather than correctness — but it keeps the stored row honest after a delete
 * the player made deliberately, which is different from a label that vanished
 * from a file behind their back.
 */
function clearDanglingSelections(db: Db): void {
  db.prepare(
    `update app_settings
        set ai_key_label = null
      where ai_key_label is not null
        and ai_key_label not in (select label from ai_keys)`,
  ).run();

  db.prepare(
    `update app_settings
        set ai_model_label = null
      where ai_model_label is not null
        and ai_model_label not in (select label from ai_models)`,
  ).run();

  db.prepare(
    `update app_settings
        set ai_mode = 'mock'
      where ai_mode = 'openrouter'
        and (ai_key_label is null or ai_model_label is null)`,
  ).run();
}
