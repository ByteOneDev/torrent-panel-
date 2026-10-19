import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { VpnSettings } from '@motflix/shared';
import { DEFAULT_PREFERENCES, parsePreferences } from '../src/settings.ts';
import { Agent, AgentError, parseResult, serializeRequest, vpnEnv } from '../src/setup/agent.ts';
import {
  applyQualities, languageFormats, languageScores, matchLanguage, maxMbPerMinute, qualityAllowed, type ProfileItem,
} from '../src/setup/profiles.ts';

describe('langues', () => {
  it('reconnaît les étiquettes des sorties françaises', () => {
    const cases: [string, string | null][] = [
      ['Film.2010.TRUEFRENCH.1080p.WEB.H264-GRP', 'VF'],
      ['Film.2010.FRENCH.1080p.BluRay.x264-GRP', 'VF'],
      ['Film.2010.VFF.1080p.WEB-GRP', 'VF'],
      ['Film.2010.MULTi.VFF.1080p.BluRay-GRP', 'MULTi'],
      ['Film.2010.MULTI.1080p.WEB-GRP', 'MULTi'],
      ['Film.2010.VOSTFR.1080p.WEB-GRP', 'VOSTFR'],
      ['Film.2010.SUBFRENCH.720p.HDTV-GRP', 'VOSTFR'],
      ['Film.2010.1080p.WEB-DL.x264-GRP', 'VO'],
      ['Film.2010.FRENCH.VFQ.1080p.WEB-GRP', null],
    ];
    for (const [release, expected] of cases) expect(matchLanguage(release, false), release).toBe(expected);
    expect(matchLanguage('Film.2010.FRENCH.VFQ.1080p.WEB-GRP', true)).toBe('VF');
    // Un film français sans étiquette n'est pas une « VO » au sens de l'utilisateur.
    expect(matchLanguage('Film.2010.1080p.WEB-GRP', false, true)).toBeNull();
  });

  it('note les langues selon l’ordre choisi', () => {
    expect([...languageScores(DEFAULT_PREFERENCES)]).toEqual([['VF', 400], ['MULTi', 300], ['VO', 200], ['VOSTFR', 100]]);
    expect([...languageScores({ ...DEFAULT_PREFERENCES, languages: ['MULTi', 'VF'] })]).toEqual([['MULTi', 200], ['VF', 100]]);
  });

  it('exclut la VFQ des formats VF sauf si on l’accepte', () => {
    const names = (accept: boolean) => languageFormats(accept).VF.specifications.map((s) => s.name);
    expect(names(false)).toContain('Pas québécoise');
    expect(names(true)).not.toContain('Pas québécoise');
  });
});

describe('qualités et tailles', () => {
  const q = (id: number, name: string, resolution: number, source: string, modifier = 'none') =>
    ({ id, name, resolution, source, modifier });

  it('garde 720p à 1080p, sans remux ni copie de disque', () => {
    const p = DEFAULT_PREFERENCES;
    expect(qualityAllowed(q(7, 'Bluray-1080p', 1080, 'bluray'), p)).toBe(true);
    expect(qualityAllowed(q(4, 'HDTV-720p', 720, 'tv'), p)).toBe(true);
    expect(qualityAllowed(q(30, 'Remux-1080p', 1080, 'bluray', 'remux'), p)).toBe(false);
    expect(qualityAllowed(q(22, 'BR-DISK', 1080, 'bluray', 'brdisk'), p)).toBe(false);
    expect(qualityAllowed(q(19, 'Bluray-2160p', 2160, 'bluray'), p)).toBe(false);
    expect(qualityAllowed(q(1, 'SDTV', 480, 'tv'), p)).toBe(false);
    expect(qualityAllowed(q(20, 'Bluray-1080p Remux', 1080, 'blurayRaw'), p)).toBe(false); // Sonarr
    expect(qualityAllowed(q(19, 'Bluray-2160p', 2160, 'bluray'), { ...p, resolution: '2160p' })).toBe(true);
  });

  it('coche les groupes et vise la meilleure qualité permise', () => {
    const items: ProfileItem[] = [
      { quality: q(1, 'SDTV', 480, 'tv'), items: [], allowed: false },
      { id: 1001, name: 'WEB 720p', items: [{ quality: q(5, 'WEBDL-720p', 720, 'webdl'), items: [], allowed: false }], allowed: false },
      { quality: q(7, 'Bluray-1080p', 1080, 'bluray'), items: [], allowed: false },
      { quality: q(19, 'Bluray-2160p', 2160, 'bluray'), items: [], allowed: false },
    ];
    expect(applyQualities(items, DEFAULT_PREFERENCES)).toBe(7);
    expect(items.map((i) => i.allowed)).toEqual([false, true, true, false]);
    expect(items[1]!.items[0]!.allowed).toBe(true);
  });

  it('convertit une taille en Mo par minute', () => {
    expect(maxMbPerMinute(4, 120)).toBe(34.1);
    expect(maxMbPerMinute(1.5, 45)).toBe(34.1);
  });

  it('valide les préférences reçues', () => {
    expect(parsePreferences({ languages: ['VO', 'VO', 'XX'], maxMovieGb: 9999 })).toMatchObject({ languages: ['VO'], maxMovieGb: 100 });
    expect(() => parsePreferences({ languages: [] })).toThrow();
  });
});

describe('agent VPN', () => {
  const vpn: VpnSettings = {
    enabled: true, provider: 'protonvpn', type: 'wireguard', wireguardPrivateKey: `${'A'.repeat(39)}bc+/=`, wireguardAddresses: '10.2.0.2/32',
    openvpnUser: '', openvpnPassword: '', countries: 'Switzerland', portForwarding: true,
  };
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('traduit les réglages en variables pour le .env', () => {
    expect(vpnEnv(vpn)).toMatchObject({ VPN_ENABLED: '1', VPN_PROVIDER: 'protonvpn', VPN_PORT_FORWARDING: 'on', WIREGUARD_PRIVATE_KEY: vpn.wireguardPrivateKey });
    expect(() => vpnEnv({ ...vpn, wireguardPrivateKey: 'cle-de-test-invalide' })).toThrow(/44 caractères/);
    expect(vpnEnv({ ...vpn, provider: 'mullvad' }).VPN_PORT_FORWARDING).toBe('off'); // Mullvad n'ouvre pas de port
    expect(vpnEnv({ ...vpn, enabled: false })).toEqual({ VPN_ENABLED: '0' });
    expect(() => vpnEnv({ ...vpn, wireguardPrivateKey: '' })).toThrow(AgentError);
  });

  it('refuse les valeurs qui pourraient casser le .env', () => {
    expect(() => serializeRequest('x', { VPN_PROVIDER: "a'b" })).toThrow(AgentError);
    expect(() => serializeRequest('x', { VPN_PROVIDER: 'a\nPUID=0' })).toThrow(AgentError);
    expect(() => serializeRequest('x', { PUID: '0' })).toThrow(AgentError);
    expect(serializeRequest('x', { VPN_ENABLED: '0' })).toBe('ID=x\nVPN_ENABLED=0\n');
  });

  it('dépose une seule demande à la fois et lit le résultat', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'motflix-agent-'));
    const agent = new Agent(dir, '/opt/motflix');
    const id = agent.submit({ VPN_ENABLED: '0' });
    expect(readFileSync(path.join(dir, 'agent/queue/request.env'), 'utf8')).toContain(`ID=${id}`);
    expect(() => agent.submit({ VPN_ENABLED: '1' })).toThrow(AgentError);
    expect(agent.applyCommand()).toBe('/opt/motflix/apply.sh');

    writeFileSync(path.join(dir, 'agent/result.env'), `ID=${id}\nOK=1\nMESSAGE=VPN coupé\nFINISHED=2026-10-19T10:00:00Z\n`);
    expect(agent.lastResult()).toEqual({ id, ok: true, message: 'VPN coupé', finishedAt: '2026-10-19T10:00:00Z' });
    expect(parseResult('rien')).toBeNull();
  });
});

describe('réglages de téléchargement', () => {
  const base = {
    dl_limit: 0, up_limit: 2 * 1024 * 1024, alt_dl_limit: 1024 * 1024, alt_up_limit: 512 * 1024,
    scheduler_enabled: true, schedule_from_hour: 9, schedule_from_min: 0, schedule_to_hour: 18, schedule_to_min: 30,
    scheduler_days: 0, max_active_downloads: 3, max_ratio_enabled: true, max_ratio: 1,
    max_seeding_time_enabled: true, max_seeding_time: 4320, max_ratio_act: 1,
  };

  it('traduit qBittorrent en unités humaines, et retour', async () => {
    const { fromQbt, toQbt } = await import('../src/setup/downloads.ts');
    const human = fromQbt(base);
    expect(human).toEqual({
      maxDownloadMBps: 0, maxUploadMBps: 2, scheduleEnabled: true, scheduleFrom: '09:00', scheduleTo: '18:30',
      altDownloadMBps: 1, altUploadMBps: 0.5, maxActiveDownloads: 3, seedRatio: 1, seedDays: 3, removeAfterSeeding: true,
    });
    expect(toQbt(human)).toEqual(base);
    expect(toQbt({ ...human, seedRatio: null, seedDays: null, removeAfterSeeding: false }))
      .toMatchObject({ max_ratio_enabled: false, max_ratio: -1, max_seeding_time_enabled: false, max_ratio_act: 0 });
  });

  it('refuse les valeurs invalides', async () => {
    const { fromQbt, toQbt } = await import('../src/setup/downloads.ts');
    const human = fromQbt(base);
    expect(() => toQbt({ ...human, scheduleFrom: '25:00' })).toThrow(/heure invalide/);
    expect(() => toQbt({ ...human, maxActiveDownloads: 0 })).toThrow();
    expect(() => toQbt({ ...human, maxDownloadMBps: -1 })).toThrow();
  });
});
