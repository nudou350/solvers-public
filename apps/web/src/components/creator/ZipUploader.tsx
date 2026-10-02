"use client";
// Envio do ZIP do pacote: arrastar e soltar (ou escolher), limite de 50 MB conferido aqui, progresso real (XHR)
// e erros do servidor traduzidos. Serve ao envio novo e ao reenvio depois de "mudanças pedidas" (`resubmit`).
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import { gap } from "@/lib/style";
import { fileSizeText, MAX_ZIP_BYTES, uploadErrorInfo } from "@/lib/submissions-ui";
import s from "./creator.module.css";

type Props = {
  /** Id da submissão com mudanças pedidas: o envio corrigido entra na mesma versão. */
  resubmit?: string;
  /** Chamado com o id da submissão criada (ou da mesma, no reenvio). */
  onDone: (id: string) => void;
  /** Texto do botão de enviar. */
  action?: string;
};

function checkFile(f: File): string | null {
  if (!/\.zip$/i.test(f.name)) return `“${f.name}” não é um arquivo ZIP. Compacte a pasta do pacote em um .zip e escolha de novo.`;
  if (f.size === 0) return "Esse arquivo está vazio.";
  if (f.size > MAX_ZIP_BYTES) return `O arquivo tem ${fileSizeText(f.size)} e o limite é ${fileSizeText(MAX_ZIP_BYTES)}. Tire o que não faz parte do pacote e compacte de novo.`;
  return null;
}

export function ZipUploader({ resubmit, onDone, action }: Props) {
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
    const problem = checkFile(f);
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
      setError(uploadErrorInfo(e));
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
        <b>{file ? "Pacote escolhido" : "Arraste o ZIP do pacote até aqui"}</b>
        <span className="small muted" style={{ maxWidth: 460 }}>
          {file ? "Confira o arquivo abaixo e envie." : `Um arquivo .zip de até ${fileSizeText(MAX_ZIP_BYTES)}, com o manifest.json na raiz.`}
        </span>
        <input ref={input} id="zip-input" className={s.fileInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} disabled={sending} aria-label="Escolher o arquivo ZIP do pacote" />
        <Button variant={file ? "ghost" : "secondary"} icon="file" disabled={sending} onClick={() => input.current?.click()}>
          {file ? "Escolher outro arquivo" : "Escolher arquivo"}
        </Button>
      </div>

      {fileError ? (
        <Notice tone="warn" role="alert" title="Esse arquivo não serve">
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
              <span className="tiny faint">{fileSizeText(file.size)}</span>
            </span>
          </span>
          {sending ? null : (
            <button type="button" className="icon-btn" aria-label={`Remover ${file.name}`} onClick={() => setFile(null)}>
              <Icon name="trash" size="s" />
            </button>
          )}
        </div>
      ) : null}

      {sending ? (
        <div className="col" style={gap(8)} role="status" aria-live="polite">
          <div className="bar mint" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso do envio">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="small muted">{pct < 100 ? `Enviando… ${pct}%` : "Enviado. Aguardando o servidor confirmar o recebimento…"}</span>
        </div>
      ) : null}

      {error ? (
        <Notice tone="bad" role="alert" title={error.title}>
          {error.text}
        </Notice>
      ) : null}

      <div className="row wrapx" style={gap(12)}>
        <Button size="lg" icon="upload" disabled={!file} loading={sending} onClick={() => void send()}>
          {action ?? "Enviar para revisão"}
        </Button>
        {sending ? (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            Cancelar envio
          </Button>
        ) : null}
      </div>
      <p className="tiny faint">
        O servidor confere o pacote de novo, mesmo que você já tenha validado no seu computador. Se houver erros, você vê tudo na tela de acompanhamento e nada vai para a revisão da equipe.
      </p>
    </div>
  );
}
