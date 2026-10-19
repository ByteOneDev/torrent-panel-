import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, X } from 'lucide-react';
import type { MediaRequest, RequestStatus } from '@motflix/shared';
import { api } from '../api.ts';
import { ago } from '../format.ts';
import { useRole } from '../hooks.ts';
import { Layout } from '../Layout.tsx';
import { Poster } from '../media.tsx';
import { useToast } from '../ui.tsx';

const STATUS: Record<RequestStatus, { cls: string; label: string }> = {
  pending: { cls: 'warn', label: 'En attente' },
  approved: { cls: 'ok', label: 'Acceptée' },
  rejected: { cls: 'err', label: 'Refusée' },
};
const KIND: Record<MediaRequest['kind'], string> = { movie: 'Film', series: 'Série', book: 'Livre' };
const LANG: Record<MediaRequest['language'], string> = { default: '', original: 'VO d’abord', french: 'Français seulement' };

export function RequestsPage() {
  const admin = useRole() === 'admin';
  const q = useQuery({ queryKey: ['requests'], queryFn: api.requests.list, refetchInterval: 15_000 });
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [busy, setBusy] = useState<number | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  async function act(r: MediaRequest, fn: () => Promise<unknown>, done: string) {
    setBusy(r.id);
    try {
      await fn();
      toast({ title: done, detail: r.title });
      await Promise.all([qc.invalidateQueries({ queryKey: ['requests'] }), qc.invalidateQueries({ queryKey: ['library'] })]);
    } catch (e) {
      toast({ title: 'Action impossible', detail: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  const list = (q.data ?? []).filter((r) => tab === 'all' || r.status === 'pending');
  const pending = (q.data ?? []).filter((r) => r.status === 'pending').length;

  return (
    <Layout title={admin ? 'Demandes' : 'Mes demandes'}>
      <div className="lib-toolbar">
        <div className="chips">
          <button className={`chip ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>En attente · {pending}</button>
          <button className={`chip ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>Toutes · {q.data?.length ?? 0}</button>
        </div>
        {!admin && <div className="right"><Link className="btn btn-primary" to="/recherche"><Plus className="ic ic-sm" />Nouvelle demande</Link></div>}
      </div>

      {q.error && <div className="alert">{(q.error as Error).message}</div>}
      {q.data && !list.length && (
        <div className="empty">{tab === 'pending' ? 'Aucune demande en attente.' : 'Aucune demande pour l’instant.'}
          {!admin && ' Cherchez un film ou une série, puis « Demander ».'}</div>
      )}

      <div className="card">
        {list.map((r) => (
          <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ width: 54, flex: 'none' }}><Poster title={r.title} src={r.poster} /></div>
            <div className="row-main">
              <b>{r.title}{r.year ? ` (${r.year})` : ''}</b>
              <span>
                {[KIND[r.kind], LANG[r.language], r.formats.length ? r.formats.map((f) => (f === 'eBook' ? 'livre' : 'livre audio')).join(' + ') : null,
                  admin ? `demandé par ${r.requestedBy}` : null, ago(r.createdAt)].filter(Boolean).join(' · ')}
              </span>
              {r.note && <span style={{ display: 'block' }}>{r.status === 'rejected' ? 'Motif : ' : ''}{r.note}</span>}
            </div>
            <span className={`badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
            {busy === r.id ? <Loader2 className="ic ic-sm spin dim" /> : r.status === 'pending' && (
              admin ? (
                <>
                  <button className="btn btn-sm btn-ok" onClick={() => act(r, () => api.requests.approve(r.id), 'Demande acceptée')}><Check className="ic ic-sm" />Accepter</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => {
                    const note = window.prompt('Motif du refus (facultatif) :') ?? undefined;
                    void act(r, () => api.requests.reject(r.id, note || undefined), 'Demande refusée');
                  }}><X className="ic ic-sm" />Refuser</button>
                </>
              ) : (
                <button className="btn btn-sm btn-ghost" onClick={() => act(r, () => api.requests.cancel(r.id), 'Demande annulée')}>Annuler</button>
              )
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
