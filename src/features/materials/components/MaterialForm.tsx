'use client';

import { useDeferredValue, useEffect, useId, useRef, useState } from 'react';

import { Button, Field, Input, Select, Switch, Textarea, useToast } from '@/components/ui';
import type { ActionResult } from '@/lib/auth/actions';

import { createMaterial, discardUpload, updateMaterial } from '../actions';
import type { EditorMaterial } from '../queries';
import {
  BODY_MAX,
  buildStoragePath,
  createMaterialSchema,
  FILE_MIME_TYPES,
  formatBytes,
  MATERIAL_TYPE_LABELS,
  MATERIAL_TYPES,
  mimeOf,
  TITLE_MAX,
  updateMaterialSchema,
  validateFile,
  videoUrlFor,
} from '../schemas';
import type { MaterialType, UploadedFile } from '../schemas';
import { uploadToContentBucket } from '../upload';
import { MarkdownPreview } from './MarkdownPreview';
import styles from './MaterialsEditor.module.css';

interface Props {
  courseId: string;
  lessonId: string;
  /** Presente = edição (o tipo não muda: excluir e criar outro). */
  material?: EditorMaterial;
  onDone: () => void;
  onCancel?: () => void;
}

type FieldName = 'title' | 'url' | 'body' | 'file';
type Errors = Partial<Record<FieldName, string>> & { form?: string };
type Busy = { state: 'idle' } | { state: 'uploading'; percent: number } | { state: 'saving' };

const FIELDS: FieldName[] = ['title', 'url', 'body', 'file'];

function pickErrors(fieldErrors: Record<string, string[] | undefined> | undefined): Errors {
  const errors: Errors = {};
  for (const field of FIELDS) {
    const message = fieldErrors?.[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

/** Formulário de criar/editar material (um por tipo), com upload de arquivo com progresso. */
export function MaterialForm({ courseId, lessonId, material, onDone, onCancel }: Props) {
  const { toast } = useToast();
  const editing = Boolean(material);
  const fileInputId = useId();
  const fileStatusId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLFormElement>(null);

  const [type, setType] = useState<MaterialType>(material?.type ?? 'video');
  const [title, setTitle] = useState(material?.title ?? '');
  const [url, setUrl] = useState(
    material?.type === 'link'
      ? (material.externalUrl ?? '')
      : (videoUrlFor(material?.videoProvider ?? null, material?.videoId ?? null) ?? ''),
  );
  const [body, setBody] = useState(material?.body ?? '');
  const [showInAll, setShowInAll] = useState(material?.showInAllLessons ?? false);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<Busy>({ state: 'idle' });
  const previewSource = useDeferredValue(body);

  // Vídeo de provedor sem URL pública (ex.: bunny): só o título é editável.
  const urlLocked = editing && type === 'video' && url === '';
  const working = busy.state !== 'idle';

  useEffect(() => () => abortRef.current?.abort(), []);

  // Após uma tentativa de envio inválida, leva o foco ao primeiro campo com erro (WCAG 3.3.1).
  const focusErrorRef = useRef(false);
  useEffect(() => {
    if (!focusErrorRef.current) return;
    focusErrorRef.current = false;
    rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function clear(field: FieldName) {
    setErrors((current) =>
      current[field] || current.form
        ? { ...current, [field]: undefined, form: undefined }
        : current,
    );
  }

  function chooseFile(next: File | null) {
    if (next) {
      const message = validateFile({ size: next.size, type: mimeOf(next) });
      if (message) {
        setFile(null);
        setErrors((current) => ({ ...current, file: message }));
        return;
      }
    }
    setFile(next);
    clear('file');
  }

  async function submit() {
    if (working) return;
    setErrors({});

    // 1) arquivo escolhido: valida e já decide o caminho (a action confere o prefixo de novo).
    let uploaded: UploadedFile | undefined;
    if (type === 'file' && file) {
      const message = validateFile({ size: file.size, type: mimeOf(file) });
      if (message) {
        setErrors({ file: message });
        return;
      }
      uploaded = {
        storagePath: buildStoragePath(courseId, lessonId, file.name),
        fileName: file.name,
        fileSize: file.size,
        mimeType: mimeOf(file),
      };
    } else if (type === 'file' && !editing) {
      setErrors({ file: 'Escolha um arquivo para enviar.' });
      return;
    }

    // 2) validação com os mesmos schemas da action, antes de gastar banda no upload.
    const common = { title, showInAllLessons: showInAll };
    const payload =
      type === 'video'
        ? { type, ...common, ...(urlLocked ? {} : { url }) }
        : type === 'text'
          ? { type, ...common, body }
          : type === 'link'
            ? { type, ...common, url }
            : { type, ...common, ...(uploaded ? { file: uploaded } : {}) };
    const parsed = editing
      ? updateMaterialSchema.safeParse({ ...payload, id: material!.id })
      : createMaterialSchema.safeParse({ ...payload, lessonId });
    if (!parsed.success) {
      const flat: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        (flat[key] ??= []).push(issue.message);
      }
      focusErrorRef.current = true;
      setErrors(pickErrors(flat));
      return;
    }

    // 3) upload (cancelável) e só então a action.
    if (uploaded && file) {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy({ state: 'uploading', percent: 0 });
      const result = await uploadToContentBucket({
        path: uploaded.storagePath,
        file,
        mimeType: uploaded.mimeType,
        signal: controller.signal,
        onProgress: (percent) => setBusy({ state: 'uploading', percent }),
      });
      abortRef.current = null;
      if (!result.ok) {
        setBusy({ state: 'idle' });
        if (!result.aborted) setErrors({ file: result.message });
        return;
      }
    }

    setBusy({ state: 'saving' });
    let result: ActionResult<unknown>;
    try {
      result = editing ? await updateMaterial(parsed.data) : await createMaterial(parsed.data);
    } catch {
      result = { ok: false, error: 'Não foi possível salvar o material. Tente de novo.' };
    }

    if (!result.ok) {
      // O objeto já está no Storage mas não virou material: remove para não deixar lixo.
      if (uploaded) void discardUpload({ lessonId, storagePath: uploaded.storagePath });
      setBusy({ state: 'idle' });
      const fields = pickErrors(result.fieldErrors);
      focusErrorRef.current = true;
      setErrors(Object.keys(fields).length > 0 ? fields : { form: result.error });
      return;
    }

    setBusy({ state: 'idle' });
    toast({ tone: 'success', title: editing ? 'Material salvo' : 'Material adicionado' });
    onDone();
  }

  const submitLabel = editing ? 'Salvar alterações' : 'Adicionar material';

  return (
    <form
      ref={rootRef}
      className={styles.form}
      noValidate
      aria-label={editing ? 'Editar material' : 'Novo material'}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {editing ? null : (
        <Field label="Tipo de material">
          <Select
            value={type}
            disabled={working}
            onChange={(e) => {
              setType(e.target.value as MaterialType);
              setErrors({});
            }}
          >
            {MATERIAL_TYPES.map((value) => (
              <option key={value} value={value}>
                {MATERIAL_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label={type === 'link' ? 'Título do link' : 'Título (opcional)'}
        required={type === 'link'}
        error={errors.title}
      >
        <Input
          value={title}
          maxLength={TITLE_MAX}
          autoComplete="off"
          enterKeyHint="next"
          disabled={working}
          onChange={(e) => {
            setTitle(e.target.value);
            clear('title');
          }}
        />
      </Field>

      {type === 'video' && !urlLocked ? (
        <Field
          label="URL do vídeo"
          required
          hint="Cole um link do YouTube ou do Vimeo."
          error={errors.url}
        >
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            disabled={working}
            onChange={(e) => {
              setUrl(e.target.value);
              clear('url');
            }}
          />
        </Field>
      ) : null}
      {urlLocked ? (
        <p className={styles.hint}>O vídeo deste provedor não é editável aqui; só o título.</p>
      ) : null}

      {type === 'link' ? (
        <Field
          label="URL"
          required
          hint="Precisa começar com http:// ou https://."
          error={errors.url}
        >
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="https://"
            value={url}
            disabled={working}
            onChange={(e) => {
              setUrl(e.target.value);
              clear('url');
            }}
          />
        </Field>
      ) : null}

      {type === 'text' ? (
        <div className={styles.textGrid}>
          <Field
            label="Texto (markdown)"
            required
            hint="Títulos (#), listas (-), blocos de código (```) e parágrafos. HTML não é aceito."
            error={errors.body}
          >
            <Textarea
              rows={10}
              maxLength={BODY_MAX}
              value={body}
              disabled={working}
              onChange={(e) => {
                setBody(e.target.value);
                clear('body');
              }}
            />
          </Field>
          <section className={styles.previewBox} aria-label="Prévia do texto">
            <h4 className={styles.previewTitle}>Prévia</h4>
            <MarkdownPreview source={previewSource} />
          </section>
        </div>
      ) : null}

      {type === 'file' ? (
        <div className={styles.fileBox}>
          <input
            id={fileInputId}
            className="visually-hidden"
            type="file"
            accept={FILE_MIME_TYPES.join(',')}
            disabled={working}
            aria-describedby={fileStatusId}
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (next) chooseFile(next);
            }}
          />
          {editing && !file && material?.fileName ? (
            <p className={styles.fileCurrent}>
              Arquivo atual: <strong>{material.fileName}</strong>
              {material.fileSize !== null ? ` (${formatBytes(material.fileSize)})` : ''}
            </p>
          ) : null}
          {file ? (
            <p className={styles.fileCurrent}>
              Selecionado: <strong>{file.name}</strong> ({formatBytes(file.size)})
            </p>
          ) : null}
          <div className={styles.controls}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={working}
              onClick={() => document.getElementById(fileInputId)?.click()}
            >
              {file || editing ? 'Escolher outro arquivo' : 'Escolher arquivo'}
            </Button>
            {file && !working ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => chooseFile(null)}>
                Remover seleção
              </Button>
            ) : null}
          </div>
          <div id={fileStatusId} className={styles.status} aria-live="polite">
            {busy.state === 'uploading' ? (
              <>
                <progress
                  className={styles.progress}
                  max={100}
                  value={busy.percent}
                  aria-label="Progresso do envio"
                />
                <span>{busy.percent}%</span>
              </>
            ) : errors.file ? (
              <span className={styles.error} role="alert">
                {errors.file}
              </span>
            ) : (
              <span className={styles.hint}>
                Zip, imagens, áudio, vídeo, fontes, modelos 3D, texto ou dados. Até 200 MB. Sem PDF.
              </span>
            )}
          </div>
        </div>
      ) : null}

      <Switch
        label="Mostrar em todas as aulas do curso"
        hint="O aluno vê este material em todas as aulas, em “Materiais do curso”. O acesso segue esta aula: se ela não for prévia gratuita, visitantes não o veem nas aulas de prévia; se for prévia, ele fica público."
        checked={showInAll}
        disabled={working}
        onChange={(e) => setShowInAll(e.target.checked)}
      />

      {errors.form ? (
        <p className={styles.error} role="alert">
          {errors.form}
        </p>
      ) : null}

      <div className={styles.controls}>
        <Button
          type="submit"
          size="sm"
          pending={busy.state === 'saving'}
          disabled={busy.state === 'uploading'}
        >
          {submitLabel}
        </Button>
        {busy.state === 'uploading' ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
            Cancelar envio
          </Button>
        ) : onCancel ? (
          <Button type="button" variant="ghost" size="sm" disabled={working} onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
