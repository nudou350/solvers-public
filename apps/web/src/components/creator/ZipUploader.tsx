"use client";
// Envio do ZIP do pacote: arrastar e soltar (ou escolher), limite de 50 MB conferido aqui, progresso real (XHR)
// e erros do servidor traduzidos. Serve ao envio novo e ao reenvio depois de "mudanças pedidas" (`resubmit`).
import { useTranslations } from "next-intl";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Toast";
import { useFormat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { MAX_ZIP_BYTES, uploadErrorInfo } from "@/lib/submissions-ui";
import s from "./creator.module.css";

type Props = {
  /** Id da submissão com mudanças pedidas: o envio corrigido entra na mesma versão. */
  resubmit?: string;
  /** Chamado com o id da submissão criada (ou da mesma, no reenvio). */
  onDone: (id: string) => void;
  /** Texto do botão de enviar. */
  action?: string;
};

type T = ReturnType<typeof useTranslations>;
type Format = ReturnType<typeof useFormat>;

function checkFile(f: File, t: T, fmt: Format): string | null {
  if (!/\.zip$/i.test(f.name)) return t("notZip", { name: f.name });
  if (f.size === 0) return t("empty");
  if (f.size > MAX_ZIP_BYTES) return t("tooBig", { size: fmt.fileSize(f.size), max: fmt.fileSize(MAX_ZIP_BYTES) });
  return null;
}

export function ZipUploader({ resubmit, onDone, action }: Props) {
  const t = useTranslations("creator.zip");
  const fmt = useFormat();
  const tSub = useTranslations("submissions");
  const { api } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const sending = progress !== null;

  function pick(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setError(null);
    const problem = checkFile(f, t, fmt);
    setFileError(problem);
    setFile(problem ? null : f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (!sending) pick(e.dataTransfer.files);
  }

  async function send() {
    if (!file || sending) return;
    setError(null);
    setProgress(0);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await api.uploadSubmission(file, { resubmit, signal: ctl.signal, onProgress: setProgress });
      onDone(r.id);
    } catch (e) {
      setProgress(null);
      setError(uploadErrorInfo(tSub, e));
    } finally {
      abort.current = null;
    }
  }

  const pct = Math.round((progress ?? 0) * 100);

  return (
    <div className="col" style={gap(16)}>
      <div
        className={[s.zone, over ? s.zoneOver : ""].filter(Boolean).join(" ")}
        onDragOver={(e) => {
          e.preventDefault();
          if (!sending) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className="brand">
          <Icon name="upload" size="xl" />
        </span>
        <b>{file ? t("picked") : t("drop")}</b>
        <span className="small muted" style={{ maxWidth: 460 }}>
          {file ? t("pickedHint") : t("hint", { max: fmt.fileSize(MAX_ZIP_BYTES) })}
        </span>
        <input ref={input} id="zip-input" className={s.fileInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} disabled={sending} aria-label={t("inputLabel")} />
        <Button variant={file ? "ghost" : "secondary"} icon="file" disabled={sending} onClick={() => input.current?.click()}>
          {file ? t("chooseOther") : t("choose")}
        </Button>
      </div>

      {fileError ? (
        <Notice tone="warn" role="alert" title={t("badFileTitle")}>
          {fileError}
        </Notice>
      ) : null}

      {file ? (
        <div className="card pad-s row between wrapx" style={gap(12)}>
          <span className="row" style={gap(12, { minWidth: 0 })}>
            <span className="brand">
              <Icon name="file" />
            </span>
            <span className="col" style={gap(0, { minWidth: 0 })}>
              <b className="mono" style={{ overflowWrap: "anywhere" }}>
                {file.name}
              </b>
              <span className="tiny faint">{fmt.fileSize(file.size)}</span>
            </span>
          </span>
          {sending ? null : (
            <button type="button" className="icon-btn" aria-label={t("remove", { name: file.name })} onClick={() => setFile(null)}>
              <Icon name="trash" size="s" />
            </button>
          )}
        </div>
      ) : null}

      {sending ? (
        <div className="col" style={gap(8)} role="status" aria-live="polite">
          <div className="bar mint" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("progressLabel")}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="small muted">{pct < 100 ? t("uploading", { pct }) : t("uploaded")}</span>
        </div>
      ) : null}

      {error ? (
        <Notice tone="bad" role="alert" title={error.title}>
          {error.text}
        </Notice>
      ) : null}

      <div className="row wrapx" style={gap(12)}>
        <Button size="lg" icon="upload" disabled={!file} loading={sending} onClick={() => void send()}>
          {action ?? t("send")}
        </Button>
        {sending ? (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
      <p className="tiny faint">{t("note")}</p>
    </div>
  );
}
