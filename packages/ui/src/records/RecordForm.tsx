'use client';

/**
 * `RecordForm` (ADR-0014 section 3): generated from the record type's Zod schema and
 * field metadata. Create sends the filled fields; edit sends only the changed ones with
 * `If-Match` (through the client). Errors are inline and summarized at the top (the
 * summary takes focus). A `409 version_conflict` says who-changed-what in plain language
 * and offers to load the other version, with or without keeping the user's edits.
 */
import type { FieldDef, RecordTypeDef, RecordView } from '@deemed/domain';
import { t, tCount } from '@deemed/i18n';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';
import { Checkbox, Select } from '../components/controls.js';
import { Input } from '../components/Input.js';
import { useRecords, type RecordsError } from './client.js';
import { enumLabel, fieldLabel, refTarget } from './format.js';
import { RefSelect } from './refs.js';
import {
  formFields,
  isRequired,
  serverErrors,
  toFormValues,
  toPayload,
  validatePayload,
  type FieldErrors,
  type FormMode,
  type FormValues,
} from './validation.js';

export type RecordFormProps = {
  def: RecordTypeDef;
  mode: FormMode;
  /** Edit: the record as loaded (its rowVersion is sent as If-Match). */
  record?: RecordView | undefined;
  onSaved: (record: RecordView) => void;
  onCancel: () => void;
};

type Conflict = { fields: string[] };

export function RecordForm({ def, mode, record, onSaved, onCancel }: RecordFormProps) {
  const { client, locale } = useRecords();
  const base = useId();
  const fields = formFields(def, mode);
  const [current, setCurrent] = useState<RecordView | undefined>(record);
  const [baseline, setBaseline] = useState<FormValues>(() =>
    toFormValues(def, fields, record?.fields),
  );
  const [values, setValues] = useState<FormValues>(baseline);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);

  const errorCount = Object.keys(errors).length;
  useEffect(() => {
    if (errorCount > 0) summaryRef.current?.focus();
  }, [errorCount, errors]);
  useEffect(() => {
    if (conflict) conflictRef.current?.focus();
  }, [conflict]);
  useEffect(() => {
    firstRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, []);

  const set = (name: string, v: string | boolean) => setValues((prev) => ({ ...prev, [name]: v }));
  const fid = (name: string) => `${base}-${name}`;

  function failed(res: RecordsError, payload: Record<string, unknown>) {
    if (res.code === 'version_conflict') {
      setConflict({ fields: res.fields ?? [] });
      return;
    }
    if (res.code === 'bad_request' && res.fields?.length) {
      const errs = serverErrors(locale, def, mode, res.fields, payload, current?.fields);
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        return;
      }
    }
    setFormError(t(locale, `apiError.${res.code === 'network' ? 'internal' : res.code}`));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const payload = toPayload(def, mode, values, baseline);
    if (mode === 'edit' && Object.keys(payload).length === 0) {
      setErrors({});
      setNotice(t(locale, 'records.form.nothingChanged'));
      return;
    }
    const errs = validatePayload(locale, def, mode, payload, current?.fields);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    const res =
      mode === 'create'
        ? await client.create(def.id, payload)
        : await client.update(def.id, current?.id ?? '', current?.rowVersion ?? 1, payload);
    setBusy(false);
    if (res.ok) {
      setConflict(null);
      onSaved(res.data.record);
    } else failed(res, payload);
  }

  async function reload(keepMine: boolean) {
    if (!current) return;
    setBusy(true);
    const res = await client.get(def.id, current.id);
    setBusy(false);
    if (!res.ok) {
      setFormError(t(locale, `apiError.${res.code === 'network' ? 'internal' : res.code}`));
      return;
    }
    const latest = res.data.record;
    const theirs = toFormValues(def, fields, latest.fields);
    const mine: FormValues = {};
    if (keepMine) {
      for (const name of fields) {
        if (values[name] !== baseline[name]) mine[name] = values[name] as string | boolean;
      }
    }
    setCurrent(latest);
    setBaseline(theirs);
    setValues({ ...theirs, ...mine });
    setConflict(null);
    setErrors({});
    setNotice(keepMine ? t(locale, 'records.conflict.reloaded') : null);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {errorCount > 0 && (
        <div ref={summaryRef} tabIndex={-1} className="outline-none">
          <Alert tone="critical" title={tCount(locale, 'records.form.errors', errorCount)}>
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(errors).map(([name, msg]) => (
                <li key={name}>
                  <a
                    href={`#${fid(name)}`}
                    className="focus-ring rounded-sm text-status-critical-text underline"
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(fid(name))?.focus();
                    }}
                  >
                    {msg}
                  </a>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      {conflict && (
        <div ref={conflictRef} tabIndex={-1} className="outline-none">
          <Alert tone="warn" title={t(locale, 'records.conflict.title')}>
            <p>{t(locale, 'records.conflict.body')}</p>
            {conflict.fields.length > 0 && (
              <p className="mt-1">
                {t(locale, 'records.conflict.fields', {
                  fields: conflict.fields
                    .map((f) => (f === 'archivedAt' ? t(locale, 'records.value.archived') : fieldLabel(locale, def, f)))
                    .join(', '),
                })}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void reload(false)} disabled={busy}>
                {t(locale, 'records.conflict.reload')}
              </Button>
              <Button onClick={() => void reload(true)} disabled={busy}>
                {t(locale, 'records.conflict.reapply')}
              </Button>
            </div>
          </Alert>
        </div>
      )}
      {formError && (
        <Alert tone="critical" title={t(locale, 'records.form.problem')}>
          {formError}
        </Alert>
      )}
      {notice && <Alert tone="info" title={notice} />}

      <div ref={firstRef} className="grid gap-5 md:grid-cols-2">
        {fields.map((name) => (
          <FormField
            key={name}
            def={def}
            name={name}
            id={fid(name)}
            value={values[name]}
            values={values}
            error={errors[name]}
            onChange={(v) => set(name, v)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy} loadingLabel={t(locale, 'records.form.saving')}>
          {t(locale, mode === 'create' ? 'records.form.create' : 'records.form.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t(locale, 'records.form.cancel')}
        </Button>
      </div>
    </form>
  );
}

function FormField({
  def,
  name,
  id,
  value,
  values,
  error,
  onChange,
}: {
  def: RecordTypeDef;
  name: string;
  id: string;
  value: string | boolean | undefined;
  values: FormValues;
  error: string | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const { locale } = useRecords();
  const f = def.fields[name] as FieldDef;
  const label = fieldLabel(locale, def, name);
  const requiredText = isRequired(def, name) ? t(locale, 'records.form.required') : undefined;
  const text = typeof value === 'string' ? value : '';

  if (f.kind === 'boolean') {
    return (
      <Checkbox id={id} label={label} checked={value === true} onChange={(c) => onChange(c)} />
    );
  }
  if (f.kind === 'enum') {
    return (
      <Select
        id={id}
        label={label}
        error={error}
        requiredText={requiredText}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {t(locale, f.nullable ? 'records.form.none' : 'records.form.choose')}
        </option>
        {(f.values ?? []).map((v) => (
          <option key={v} value={v}>
            {enumLabel(locale, def, name, v)}
          </option>
        ))}
      </Select>
    );
  }
  if (f.kind === 'uuid') {
    const target = refTarget(def, name, values);
    if (target) {
      return (
        <RefSelect
          id={id}
          type={target}
          label={label}
          value={text}
          onChange={onChange}
          error={error}
          requiredText={requiredText}
          emptyLabel={t(locale, f.nullable ? 'records.form.none' : 'records.form.choose')}
        />
      );
    }
  }
  return (
    <Input
      id={id}
      label={requiredText ? `${label} ${requiredText}` : label}
      error={error}
      aria-required={requiredText ? true : undefined}
      type={f.kind === 'date' ? 'date' : f.kind === 'integer' ? 'number' : 'text'}
      inputMode={name === 'npi' || name === 'postalCode' ? 'numeric' : undefined}
      autoComplete="off"
      value={text}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
