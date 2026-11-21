import React, { FormEvent, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type User = { id: string; name: string; phone?: string; email?: string; role?: 'owner' | 'admin'; kind: 'person' | 'organizer'; pinResetRequired?: boolean }
type Modality = { id: string; name: string; slug: string; archived_at?: string | null; created_at?: string; event_count?: number }
type ModalityPreview = { normalized: { name: string; slug: string }; exact: Modality | null; similar: Modality[] }
type EventItem = {
  id: string; event_id: string; name: string; modality_id: string; modality: string; type: 'recorrente' | 'sazonal';
  modality_archived_at?: string | null
  starts_at: string; ends_at: string; seats: number; price_cents: number; pix_key: string; location: string;
  cutoff_hours: number; confirmed_count: number; waiting_count: number; paid_count: number; my_situation?: string;
  my_wait_position?: number; my_payment?: string; closedForJoin?: boolean
  occurrence_id?: string; notice_seen?: number
  weekday?: number; start_time?: string; end_time?: string
  open?: boolean
  series_active?: boolean
  created_by_name?: string
}
type Registration = { id: string; name: string; person_id: string; phone?: string; situation: string; payment: string; wait_position: number | null; notice_seen: number; promoted_at?: string }
type OccurrenceDetail = { occurrence: EventItem; registrations: Registration[]; closedForJoin: boolean; ownerName: string; ownerWhatsapp: string }

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function api<T = Record<string, unknown>>(path: string, init: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init, credentials: 'same-origin',
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    })
  } catch {
    throw new ApiError('Não foi possível conectar. Tente novamente.', 0, 'NETWORK_ERROR', null, true)
  }
  const result = await response.json().catch(() => null) as {
    error?: string | { code?: string; message?: string }
    requestId?: string
  } | null
  if (!response.ok) {
    const requestId = response.headers.get('X-Request-Id') || result?.requestId || null
    const error = result?.error
    const code = typeof error === 'object' && error && typeof error.code === 'string'
      ? error.code
      : 'API_ERROR'
    const serverMessage = typeof error === 'string' ? error
      : typeof error === 'object' && error && typeof error.message === 'string' ? error.message : ''
    const messages: Record<number, string> = {
      401: 'Sua sessão expirou. Entre novamente.',
      403: 'Você não tem permissão para realizar esta ação.',
      404: code === 'ROUTE_NOT_FOUND' ? 'Este endereço da API não existe.' : 'O evento ou recurso não foi encontrado.',
      405: 'Esta ação não está disponível para a rota solicitada.',
      409: code === 'ALREADY_REGISTERED' ? 'Você já está inscrito neste evento.' : 'Não foi possível concluir por causa de um conflito.',
      422: 'Confira os dados informados e tente novamente.',
      429: 'Muitas tentativas. Aguarde antes de tentar novamente.',
      500: 'O serviço está temporariamente indisponível. Tente novamente.',
      503: 'O serviço está temporariamente indisponível. Tente novamente.'
    }
    const message = serverMessage || messages[response.status] || 'Não foi possível concluir a solicitação.'
    const codeSuffix = requestId ? ` (código ${requestId.slice(0, 8)})` : ''
    throw new ApiError(
      `${message}${codeSuffix}`,
      response.status,
      code,
      requestId,
      response.status === 0 || response.status >= 500 || response.status === 429
    )
  }
  return result as T
}
const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: '2-digit' }) =>
  new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'America/Sao_Paulo' }).format(new Date(value)).replace('.', '')
const formatTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value)).replace(':00', 'h').replace(':', 'h')
const localDateInput = (value: string) => new Intl.DateTimeFormat('en-CA', { year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Sao_Paulo' }).format(new Date(value))
const fullDuration = (start: string, end: string) => {
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return hours ? `${hours}h${rest ? `${rest}` : ''}` : `${rest}min`
}
const timeRange = (event: EventItem) => `${formatTime(event.starts_at)}–${formatTime(event.ends_at)} · ${fullDuration(event.starts_at, event.ends_at)}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
function reportableOccurrenceCounts(events:EventItem[]) {
  const today = localDateInput(new Date().toISOString())
  const now = Date.now()
  return events.reduce<Record<string, number>>((counts, event) => {
    if (event.open && event.series_active !== false && localDateInput(event.starts_at) >= today && new Date(event.ends_at).getTime() > now) {
      counts[event.modality_id] = (counts[event.modality_id] || 0) + 1
    }
    return counts
  }, {})
}
function isOccurrenceReportable(event:EventItem) {
  return Boolean(reportableOccurrenceCounts([event])[event.modality_id])
}

function Icon({ name }: { name: 'fire' | 'calendar' | 'list' | 'person' | 'arrow' | 'check' | 'empty' | 'close' | 'copy' | 'search' | 'back' | 'plus' | 'clock' | 'pin' }) {
  const paths: Record<string, React.ReactNode> = {
    fire: <><circle cx="12" cy="12" r="9" /><path d="M12 19c-3-1.6-2.7-4.4 0-7.5.4 2.2 3.2 3.1 2.2 5.7-.4 1-1.2 1.6-2.2 1.8Z" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    empty: <circle cx="12" cy="12" r="8" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h12" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="icon" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [screen, setScreen] = useState('events')
  const [events, setEvents] = useState<EventItem[]>([])
  const [modalities, setModalities] = useState<Modality[]>([])
  const [mine, setMine] = useState<EventItem[]>([])
  const [detail, setDetail] = useState<OccurrenceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailCanRetry, setDetailCanRetry] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState('all')
  const [mineTab, setMineTab] = useState<'upcoming'|'past'>('upcoming')
  const [search, setSearch] = useState('')
  const [people, setPeople] = useState<{id:string;name:string;phone:string}[]>([])
  const [history, setHistory] = useState<{id:string;actor_id:string;actor_name:string;action:string;target_kind:string;created_at:string;details:Record<string,string>}[]>([])
  const [organizers, setOrganizers] = useState<{id:string;name:string;email:string;role:string}[]>([])
  const [invitations, setInvitations] = useState<{id:string;email:string;role:string;expires_at:string}[]>([])
  const [ownerSettings, setOwnerSettings] = useState({whatsapp:'',defaultPix:''})
  const [inviteLink, setInviteLink] = useState('')
  const [modal, setModal] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [detailOccurrenceId, setDetailOccurrenceId] = useState('')
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null)
  const [modalityReturnScreen, setModalityReturnScreen] = useState('')
  const [preferredModalityId, setPreferredModalityId] = useState('')
  const [exportingReportKey, setExportingReportKey] = useState('')

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500) }
  const createModality = async (name:string) => {
    const result = await api<{modality:Modality;created:boolean}>('/admin/modalities', { method:'POST', body:{name} })
    setPreferredModalityId(result.modality.id)
    await loadModalities()
    return result
  }
  const useModality = async (modality:Modality) => {
    if (modality.archived_at) {
      await api(`/admin/modalities/${modality.id}/status`, { method:'PATCH', body:{archived:false} })
      await loadModalities()
      notify(`${modality.name} foi reativada e selecionada.`)
    }
    setPreferredModalityId(modality.id)
    return modality
  }
  const openModalityManager = (returnScreen = '') => {
    setModalityReturnScreen(returnScreen)
    setScreen('modalities')
  }
  const closeModalityManager = () => {
    setScreen(modalityReturnScreen || 'admin')
    setModalityReturnScreen('')
  }
  const loadEvents = useCallback(async () => {
    const result = await api<{events:EventItem[]}>('/events')
    setEvents(result.events)
  }, [])
  const loadMine = useCallback(async () => {
    const result = await api<{registrations:EventItem[]}>('/my-registrations')
    setMine(result.registrations)
  }, [])
  const loadModalities = useCallback(async () => {
    const result = user?.kind === 'organizer'
      ? await api<{modalities:Modality[]}>('/admin/modalities')
      : await api<{modalities:Modality[]}>('/modalities')
    setModalities(result.modalities)
  }, [user])
  const refresh = useCallback(async () => {
    if (!user) return
    try {
      await loadModalities()
      if (user.kind === 'person') { await loadEvents(); await loadMine() }
      else {
        const result = await api<{events:EventItem[]}>('/admin/events')
        setEvents(result.events)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar os eventos.') }
  }, [loadEvents, loadMine, loadModalities, user])

  useEffect(() => {
    let active = true
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('PWA indisponível neste navegador:', error))
    api<{user:User|null}>('/me').then(({user: current}) => { if (active && current) setUser(current) }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Não foi possível carregar sua sessão.') }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])
  useEffect(() => { if (user) void refresh() }, [user, refresh])
  useEffect(() => { if (user?.kind === 'organizer' && screen === 'events') setScreen('admin') }, [screen, user])
  useEffect(() => { if (user?.kind === 'person' && user.pinResetRequired) setScreen('profile') }, [user])
  useEffect(() => {
    if (user?.kind === 'organizer' && screen === 'people') void api<{people:typeof people}>('/admin/people').then(r => setPeople(r.people)).catch(e => setError(e.message))
    if (user?.kind === 'organizer' && screen === 'history') void api<{entries:typeof history}>('/admin/audit').then(r => setHistory(r.entries)).catch(e => setError(e.message))
    if (user?.role === 'owner' && screen === 'organizers') void api<{organizers:typeof organizers;invitations:typeof invitations;whatsapp:string;defaultPix:string}>('/owner/organizers').then(r => { setOrganizers(r.organizers); setInvitations(r.invitations); setOwnerSettings({whatsapp:r.whatsapp,defaultPix:r.defaultPix}) }).catch(e => setError(e.message))
  }, [user, screen])

  async function openEvent(item: Pick<EventItem, 'id'>) {
    setDetailOccurrenceId(item.id)
    setScreen('detail')
    setDetail(null)
    setDetailError('')
    setDetailCanRetry(false)
    setDetailLoading(true)
    try { setDetail(await api<OccurrenceDetail>(`/occurrences/${encodeURIComponent(item.id)}`)) }
    catch (error) {
      const failure = error instanceof ApiError ? error : null
      const message = error instanceof Error ? error.message : 'Não foi possível abrir o evento.'
      console.error(JSON.stringify({
        event: 'occurrence.detail.failed',
        query: 'GET /api/occurrences/:id',
        requestId: failure?.requestId || null,
        status: failure?.status || null,
        errorName: failure?.name || 'Error',
        errorMessage: message
      }))
      setDetailError(message)
      setDetailCanRetry(failure?.retryable ?? true)
    } finally { setDetailLoading(false) }
  }
  async function handle(action: () => Promise<unknown>, success: string, reload = true) {
    setError('')
    try {
      await action()
      notify(success)
      if (reload) {
        await refresh()
        if (screen === 'detail') await openEvent({ id: detailOccurrenceId })
        if (user?.kind === 'organizer' && screen === 'people') setPeople((await api<{people:typeof people}>('/admin/people')).people)
        if (user?.role === 'owner' && screen === 'organizers') {
          const result = await api<{organizers:typeof organizers;invitations:typeof invitations;whatsapp:string;defaultPix:string}>('/owner/organizers')
          setOrganizers(result.organizers); setInvitations(result.invitations); setOwnerSettings({whatsapp:result.whatsapp,defaultPix:result.defaultPix})
        }
      }
      return true
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir. Tente novamente.'); return false }
  }
  async function downloadReport(path:string, reportKey:string) {
    setExportingReportKey(reportKey)
    setError('')
    try {
      let response:Response
      try {
        response = await fetch(path, {
          credentials: 'same-origin'
        })
      } catch {
        throw new ApiError('Não foi possível conectar. Tente novamente.', 0, 'NETWORK_ERROR', null, true)
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as {
          error?: string | { code?: string; message?: string }
          requestId?: string
        } | null
        const requestId = response.headers.get('X-Request-Id') || payload?.requestId || null
        const errorValue = payload?.error
        const code = typeof errorValue === 'object' && errorValue && typeof errorValue.code === 'string'
          ? errorValue.code : ''
        const serverMessage = typeof errorValue === 'string' ? errorValue
          : typeof errorValue === 'object' && errorValue && typeof errorValue.message === 'string'
            ? errorValue.message : ''
        const message = code === 'REPORT_NO_OCCURRENCES'
          ? reportKey.startsWith('occurrence:')
            ? 'Este evento não está elegível para exportação.'
            : 'Não há eventos elegíveis para exportar.'
          : serverMessage || (response.status === 401
            ? 'Sua sessão expirou. Entre novamente.'
            : response.status === 403
              ? 'Você não tem permissão para exportar este relatório.'
              : response.status === 504
                ? 'A geração do relatório pode ter atingido o limite de tempo da função serverless.'
              : 'Não foi possível gerar o relatório. Tente novamente.')
        throw new ApiError(
          `${message}${requestId ? ` (código ${requestId.slice(0, 8)})` : ''}`,
          response.status,
          code || 'REPORT_ERROR',
          requestId,
          response.status >= 500
        )
      }

      const requestId = response.headers.get('X-Request-Id')
      if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
        throw new ApiError(
          `O serviço não retornou um arquivo Excel válido.${requestId ? ` (código ${requestId.slice(0, 8)})` : ''}`,
          response.status,
          'INVALID_REPORT_RESPONSE',
          requestId,
          false
        )
      }
      const blob = await response.blob()
      const filename = /filename="([^"]+)"/i.exec(response.headers.get('Content-Disposition') || '')?.[1]
        || 'ethos-relatorio.xlsx'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify(response.headers.get('X-Report-Warning') === 'large'
        ? 'Relatório baixado. A geração deste arquivo grande pode atingir o limite de tempo da Vercel.'
        : 'Relatório baixado.')
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Não foi possível gerar o relatório. Tente novamente.')
    } finally {
      setExportingReportKey('')
    }
  }
  async function exportModalityReport(modalityId:string) {
    return downloadReport(`/api/admin/modalities/${encodeURIComponent(modalityId)}/report.xlsx`, `modality:${modalityId}`)
  }
  async function exportOccurrenceReport(occurrenceId:string) {
    return downloadReport(`/api/admin/occurrences/${encodeURIComponent(occurrenceId)}/report.xlsx`, `occurrence:${occurrenceId}`)
  }
  async function closeEventSeries() {
    if (!detail) return
    const event = detail.occurrence
    setError('')
    try {
      const result = await api<{ok:boolean;alreadyClosed?:boolean}>(`/admin/events/${event.event_id}/close`, { method: 'PATCH' })
      const remainingEvents = events.filter(item => item.event_id !== event.event_id)
      setEvents(remainingEvents)
      if (filter !== 'all' && !remainingEvents.some(item => item.modality_id === filter)) setFilter('all')
      setScreen('admin')
      notify(result.alreadyClosed ? 'Este evento já estava encerrado.' : 'Série encerrada.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível encerrar este evento. Tente novamente.')
    }
  }
  async function logout() { await api('/logout', { method: 'POST' }); setUser(null); setScreen('events'); setEvents([]); setMine([]) }

  const visibleEvents = events.filter(e => (filter === 'all' || e.modality_id === filter) && new Date(e.starts_at).getTime() > Date.now() - 86400000)
  const visibleAdminEvents = events.filter(event => filter === 'all' || event.modality_id === filter)
  const reportableCounts = reportableOccurrenceCounts(events)
  const adminModalities = [...new Map(events.map(event => [event.modality_id, {
    id: event.modality_id, name: event.modality
  }])).values()].sort((left, right) => left.name.localeCompare(right.name))
  const visibleMine = mine.filter(event => mineTab === 'upcoming' ? new Date(event.ends_at).getTime() >= Date.now() : new Date(event.ends_at).getTime() < Date.now())
  const visiblePeople = people.filter(p => `${p.name} ${p.phone}`.toLowerCase().includes(search.toLowerCase()))
  const selectedPerson = modal === 'remove-person' ? people.find(person => person.id === selectedId) : undefined

  if (busy) return <div className="loading-page"><div className="brand-mark"><Icon name="fire" /></div><p>Preparando seu próximo encontro…</p></div>
  if (!user) return <AuthScreen onLogin={setUser} />
  const organizer = user.kind === 'organizer'

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand-small" onClick={() => setScreen(organizer ? 'admin' : 'events')} aria-label="Ir para o início"><Icon name="fire" /></button>
      <div className="topbar-title"><strong>{organizer ? 'Painel do organizador' : `Olá, ${user.name.split(' ')[0]}!`}</strong><small>{organizer ? <span className="tag">{user.role === 'owner' ? 'Owner' : 'Admin'}</span> : 'Que bom ter você por aqui.'}</small></div>
      {organizer && <button className="text-button exit-button" onClick={() => void logout()}>Sair</button>}
    </header>

    {error && <div className="alert alert-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar aviso"><Icon name="close" /></button></div>}

    {user.kind === 'person' && screen === 'events' && <main className="page">
      <div className="page-heading"><div><p className="eyebrow">Bons encontros começam aqui</p><h1>Próximos eventos</h1></div><p className="subheading">Escolha seu próximo momento com a tribo.</p></div>
      <ModalityChips modalities={modalities} selected={filter} onSelect={setFilter} label="Filtrar por modalidade" />
      {visibleEvents.length ? <div className="event-grid">{visibleEvents.map(event => <EventCard key={event.id} event={event} onOpen={() => void openEvent(event)} onJoin={() => void handle(() => api(`/occurrences/${event.id}/join`, { method: 'POST' }), 'Sua inscrição foi registrada!')} person />)}</div>
        : <EmptyState title="Nenhum evento aberto agora." text="Volte em breve para ver os próximos encontros." />}
    </main>}

    {user.kind === 'person' && screen === 'mine' && <main className="page">
      <div className="page-heading"><p className="eyebrow">Sua agenda</p><h1>Meus eventos</h1><p className="subheading">Suas inscrições e os encontros que já viveu.</p></div>
      <div className="chips mine-tabs" role="tablist" aria-label="Filtrar meus eventos"><button role="tab" aria-selected={mineTab==='upcoming'} className={`chip ${mineTab==='upcoming'?'active':''}`} onClick={() => setMineTab('upcoming')}>Próximos</button><button role="tab" aria-selected={mineTab==='past'} className={`chip ${mineTab==='past'?'active':''}`} onClick={() => setMineTab('past')}>Anteriores</button></div>
      {mine.some(x => x.notice_seen === 0) && mine.filter(x => x.notice_seen === 0).map(event => <div className="promotion" key={event.id}><strong>Você subiu para a lista principal!</strong><p>{event.name} · {formatDate(event.starts_at)} às {formatTime(event.starts_at)}. Não se esqueça de fazer o Pix.</p><div className="button-row"><button className="button secondary small" onClick={() => void openEvent({...event,id:event.occurrence_id||event.id})}>Ver evento</button><button className="text-button" onClick={() => void handle(() => api(`/registrations/${event.id}/notice-seen`, { method: 'POST' }), 'Aviso dispensado.')}>Ok</button></div></div>)}
      {visibleMine.length ? <div className="event-grid">{visibleMine.map(event => <EventCard key={event.id} event={event} onOpen={() => void openEvent({...event,id:event.occurrence_id||event.id})} onJoin={() => {}} onLeave={() => { void openEvent({...event,id:event.occurrence_id||event.id}).then(() => setModal(event.my_payment==='paid'?'paid-leave':'leave')) }} person mine />)}</div>
        : <EmptyState title={mineTab==='upcoming'?'Você não tem eventos próximos.':'Nenhum evento anterior por aqui.'} text={mineTab==='upcoming'?'Veja os próximos encontros e encontre sua turma.':'Quando um encontro passar, ele aparecerá nesta lista.'} action={mineTab==='upcoming'?<button className="button primary" onClick={() => setScreen('events')}>Ver eventos</button>:undefined} />}
    </main>}

    {screen === 'detail' && <main className="page">
      <button className="back-button" onClick={() => setScreen(organizer ? 'admin' : 'events')}><Icon name="back" /> Voltar</button>
      {detailLoading ? <div className="skeleton-card" /> : detailError ? <div className="alert alert-error detail-load-error" role="alert"><span>{detailError}</span>{detailCanRetry && <button className="button secondary small" onClick={() => void openEvent({id:detailOccurrenceId})}>Tentar novamente</button>}</div> : !detail ? null : <EventDetail detail={detail} user={user}
        canExportReport={isOccurrenceReportable(detail.occurrence)}
        exportingReport={exportingReportKey === `occurrence:${detail.occurrence.id}`}
        onExportReport={() => void exportOccurrenceReport(detail.occurrence.id)}
        onJoin={() => void handle(() => api(`/occurrences/${detail.occurrence.id}/join`, { method: 'POST' }), 'Sua inscrição foi registrada!')}
        onLeave={() => { const r = detail.registrations.find(x => x.person_id === user.id); if (r?.payment === 'paid') setModal('paid-leave'); else setModal('leave') }}
        onPayment={(r, paid) => void handle(() => api(`/admin/registrations/${r.id}/payment`, { method: 'PATCH', body: { paid } }), paid ? 'Pagamento confirmado.' : 'Pagamento atualizado.')}
        onRemove={(r) => { setSelectedId(r.id); setModal('remove-registration') }} onClose={() => void closeEventSeries()} /> }
    </main>}

    {organizer && screen === 'admin' && <main className="page wide">
      <div className="admin-heading"><div><p className="eyebrow">Organização da tribo</p><h1>Eventos</h1></div><button className="button primary" onClick={() => {setPreferredModalityId('');setScreen('create-event')}}><Icon name="plus" /> Criar evento</button></div>
      <div className="admin-shortcuts"><button onClick={() => setScreen('people')}><Icon name="person" /> Pessoas</button><button onClick={() => setScreen('history')}><Icon name="list" /> Histórico de ações</button><button onClick={() => openModalityManager()}><Icon name="list" /> Modalidades</button>{user.role === 'owner' && <button onClick={() => setScreen('organizers')}><Icon name="fire" /> Organizadores</button>}</div>
      <div className="admin-modality-controls"><ModalityChips modalities={adminModalities} selected={filter} onSelect={setFilter} label="Filtrar eventos por modalidade" />
        {filter !== 'all' && <div className="report-controls">
          <ReportButton disabled={!reportableCounts[filter]} loading={exportingReportKey === `modality:${filter}`} onClick={() => void exportModalityReport(filter)} />
        </div>}
      </div>
      {visibleAdminEvents.length ? <div className="admin-events">{visibleAdminEvents.map(event => <EventCard key={event.id} event={event} onOpen={() => void openEvent(event)} onJoin={() => {}} onEdit={() => { setPreferredModalityId(''); setEditingEvent(event); setScreen('edit-event') }} admin />)}</div> : <EmptyState title={events.length ? 'Nenhum evento nesta modalidade.' : 'Ainda não há eventos.'} text={events.length ? 'Escolha outra modalidade ou volte para Todos.' : 'Crie o primeiro evento da Ethos Tribo.'} action={events.length ? undefined : <button className="button primary" onClick={() => {setPreferredModalityId('');setScreen('create-event')}}>Criar evento</button>} />}
    </main>}

    {organizer && screen === 'modalities' && <main className="page wide"><button className="back-button" onClick={closeModalityManager}><Icon name="back" /> Voltar {modalityReturnScreen ? 'ao evento' : 'aos eventos'}</button><div className="page-heading"><p className="eyebrow">Organização da tribo</p><h1>Gerenciar modalidades</h1><p className="subheading">Crie, renomeie, arquive ou organize as modalidades associadas aos eventos.</p></div><ModalityManager modalities={modalities} reportableCounts={reportableCounts} exportingModalityId={exportingReportKey} onExport={exportModalityReport} isOwner={user.role === 'owner'} onPreview={name => api<ModalityPreview>(`/admin/modalities/preview?name=${encodeURIComponent(name)}`)} onCreate={createModality} onUse={useModality} onRename={(id,name) => handle(() => api(`/admin/modalities/${id}`, {method:'PATCH',body:{name}}), 'Modalidade renomeada.')} onToggle={(id,archived) => handle(() => api(`/admin/modalities/${id}/status`, {method:'PATCH',body:{archived}}), archived ? 'Modalidade arquivada.' : 'Modalidade reativada.')} onMerge={(id,targetId) => handle(() => api(`/admin/modalities/${id}/merge`, {method:'POST',body:{target_id:targetId}}), 'Modalidades mescladas.')} onDelete={id => handle(() => api(`/admin/modalities/${id}`, {method:'DELETE'}), 'Modalidade excluída.')} /></main>}

    {organizer && (screen === 'create-event' || (screen === 'modalities' && modalityReturnScreen === 'create-event')) && <main className="page wide" hidden={screen === 'modalities'}><button className="back-button" onClick={() => setScreen('admin')}><Icon name="back" /> Voltar aos eventos</button><EventForm modalities={modalities} preferredModalityId={preferredModalityId} onManageModalities={() => openModalityManager('create-event')} onSubmit={async data => { if(await handle(() => api('/admin/events', { method: 'POST', body: data }), 'Evento publicado!')) setScreen('admin') }} /></main>}
    {organizer && editingEvent && (screen === 'edit-event' || (screen === 'modalities' && modalityReturnScreen === 'edit-event')) && <main className="page wide" hidden={screen === 'modalities'}><button className="back-button" onClick={() => setScreen('admin')}><Icon name="back" /> Voltar aos eventos</button><EventForm key={editingEvent.id} initial={editingEvent} modalities={modalities} preferredModalityId={preferredModalityId} onManageModalities={() => openModalityManager('edit-event')} onSubmit={async data => { if(await handle(() => api(`/admin/occurrences/${editingEvent.id}`, { method:'PATCH', body: data }), 'Evento atualizado!')) { setEditingEvent(null); setScreen('admin') } }} /></main>}

    {organizer && screen === 'people' && <main className="page wide"><button className="back-button" onClick={() => setScreen('admin')}><Icon name="back" /> Voltar ao painel</button><div className="page-heading"><p className="eyebrow">Comunidade</p><h1>Pessoas</h1><p className="subheading">Os telefones aparecem apenas para organizadores.</p></div><label className="search-field"><Icon name="search" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone" /></label><div className="people-list">{visiblePeople.map(person => <div className="person-row" key={person.id}><div><strong>{person.name}</strong><span>{person.phone}</span></div><div className="button-row"><button className="button secondary small" onClick={() => void handle(async () => { const result = await api<{temporaryPin:string}>(`/admin/people/${person.id}/reset-pin`, { method:'POST' }); window.alert(`PIN temporário: ${result.temporaryPin}\\nCompartilhe com cuidado; a pessoa deve escolher um novo PIN.`) }, 'PIN redefinido.')}>Redefinir PIN</button><button className="button danger small" onClick={() => { setSelectedId(person.id); setModal('remove-person') }}>Remover</button></div></div>)}</div></main>}

    {organizer && screen === 'history' && <main className="page wide"><button className="back-button" onClick={() => setScreen('admin')}><Icon name="back" /> Voltar ao painel</button><div className="page-heading"><p className="eyebrow">Transparência</p><h1>Histórico de ações</h1><p className="subheading">Ações sensíveis ficam registradas para consulta dos organizadores.</p></div><div className="history-list">{history.length ? history.map(item => <article className="history-item" key={item.id}><strong>{auditLabel(item.action)}</strong><p>{item.details?.name || item.details?.email || (item.details?.source ? `${item.details.source} → ${item.details.target} (${item.details.event_count} eventos)` : item.target_kind)}</p><small>Por {item.actor_name} · {formatDate(item.created_at, { day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit' })}</small>{item.action === 'close_event_series' && item.details?.created_by_id && item.details.created_by_id !== item.actor_id && item.details.created_by_name && <small className="history-creator">Criado por {item.details.created_by_name}</small>}</article>) : <EmptyState title="Nenhuma ação registrada ainda." text="As ações importantes aparecerão aqui." />}</div></main>}

    {user.role === 'owner' && screen === 'organizers' && <main className="page wide"><button className="back-button" onClick={() => setScreen('admin')}><Icon name="back" /> Voltar ao painel</button><div className="admin-heading"><div><p className="eyebrow">Acesso da equipe</p><h1>Organizadores <span className="tag">Owner</span></h1></div><button className="button primary" onClick={() => setModal('invite')}><Icon name="plus" /> Convidar</button></div><p className="info-note">Admins gerenciam eventos, pagamentos e PINs, mas não criam nem removem outros admins.</p><div className="people-list">{organizers.map(item => <div className="person-row" key={item.id}><div><strong>{item.name} {item.role === 'owner' && <span className="tag">Owner</span>}</strong><span>{item.email}</span></div>{item.role !== 'owner' && <button className="button danger small" onClick={() => void handle(() => api(`/owner/organizers/${item.id}`, { method:'DELETE' }), 'Acesso removido.')}>Remover acesso</button>}</div>)}</div><h2 className="section-title">Convites pendentes</h2>{invitations.map(invite => <div className="person-row" key={invite.id}><div><strong>{invite.email}</strong><span>Expira em {formatDate(invite.expires_at)}</span></div><div className="button-row"><button className="button secondary small" onClick={async () => { try { const result=await api<{link:string}>('/owner/invitations',{method:'POST',body:{email:invite.email}}); setInviteLink(result.link); const list=await api<{invitations:typeof invitations}>('/owner/organizers'); setInvitations(list.invitations); setModal('invite-link') } catch(e) { setError(e instanceof Error?e.message:'Não foi possível gerar outro convite.') } }}>Reenviar</button><button className="button secondary small" onClick={() => void handle(() => api(`/owner/invitations/${invite.id}`, { method:'DELETE' }), 'Convite cancelado.')}>Cancelar</button></div></div>)}<SettingsForm initial={ownerSettings} onSave={async settings => { await handle(() => api('/owner/settings', { method:'PATCH', body:settings }), 'Configurações atualizadas.') }} /><button className="text-button underlined" onClick={() => setScreen('history')}>Ver histórico de ações</button></main>}

    {user.kind === 'person' && screen === 'profile' && <Profile user={user} onSaveName={async name => { await handle(() => api('/profile', {method:'PATCH', body:{name} }), 'Perfil atualizado.'); setUser({...user,name}) }} onChangePin={async (currentPin,newPin) => { try { await api('/profile/pin', { method:'PATCH', body:{currentPin,newPin} }); notify('PIN alterado.'); setUser({...user,pinResetRequired:false}) } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível alterar o PIN.') } }} onLogout={() => void logout()} />}

    {!organizer && !user.pinResetRequired && <nav className="bottom-nav" aria-label="Navegação principal"><button className={screen === 'events' || screen === 'detail' ? 'selected' : ''} onClick={() => setScreen('events')}><Icon name="calendar" /><span>Eventos</span></button><button className={screen === 'mine' ? 'selected' : ''} onClick={() => setScreen('mine')}><Icon name="list" /><span>Meus eventos</span></button><button className={screen === 'profile' ? 'selected' : ''} onClick={() => setScreen('profile')}><Icon name="person" /><span>Perfil</span></button></nav>}

    {toast && <div className="toast" role="status">{toast}</div>}
    {modal && <Modal onClose={() => setModal('')} title={modal === 'invite' ? 'Convidar organizador' : modal === 'paid-leave' ? 'Fale com o organizador' : modal === 'leave' ? 'Desistir da vaga?' : modal === 'remove-person' ? 'Remover pessoa?' : 'Remover inscrição?'}>
      {modal === 'invite' ? <form onSubmit={async e => { e.preventDefault(); const email = new FormData(e.currentTarget).get('email'); try { const result = await api<{link:string}>('/owner/invitations', { method:'POST', body:{email} }); setInviteLink(result.link); const list = await api<{invitations:typeof invitations}>('/owner/organizers'); setInvitations(list.invitations); setModal('invite-link') } catch(err) { setError((err as Error).message) } }}><label>E-mail do organizador<input name="email" type="email" required /></label><button className="button primary full">Gerar convite</button></form>
        : modal === 'invite-link' ? <div><p>Este convite é válido por 7 dias e pode ser usado uma vez.</p><input readOnly value={inviteLink} /><div className="button-row"><button className="button secondary" onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => notify('Link copiado!'))}>Copiar link</button><a className="button primary" href={`https://wa.me/?text=${encodeURIComponent(inviteLink)}`} target="_blank" rel="noreferrer">Enviar no WhatsApp</a></div></div>
        : modal === 'paid-leave' ? <><p>Como você já pagou, a desistência e o reembolso são combinados com o organizador. Sua vaga só será liberada depois que ele confirmar.</p>{detail?.ownerWhatsapp && <a className="button primary full" href={`https://wa.me/${detail.ownerWhatsapp}?text=${encodeURIComponent(`Olá, ${detail.ownerName}! Sou ${user.name} e quero desistir do ${detail.occurrence.name} (${formatDate(detail.occurrence.starts_at)}, ${timeRange(detail.occurrence)}). Já fiz o pagamento e gostaria de pedir o reembolso.`)}`} target="_blank" rel="noreferrer">Falar com {detail.ownerName} no WhatsApp</a>}</>
        : <><p>{modal === 'leave' ? 'Você ainda não pagou e pode sair sem custo. Se mudar de ideia, pode entrar de novo antes do prazo.' : modal === 'remove-person' ? <><strong>{selectedPerson?.name}</strong> · {selectedPerson?.phone}<br/>A pessoa sairá de todas as listas, as vagas serão liberadas para a espera e o cadastro será apagado. Para voltar, ela precisará se cadastrar novamente.</> : 'A pessoa será removida desta lista. Se houver vaga, a primeira pessoa da espera sobe automaticamente.'}</p><div className="button-row"><button className="button secondary" onClick={() => setModal('')}>Cancelar</button><button className="button danger" onClick={() => { const selected = selectedId; const operation = modal === 'leave' ? api(`/occurrences/${detail?.occurrence.id}/leave`, {method:'POST'}) : modal === 'remove-person' ? api(`/admin/people/${selected}`, {method:'DELETE'}) : api(`/admin/registrations/${selected}`, {method:'DELETE'}); void handle(() => operation, 'Pronto.'); setModal('') }}>Confirmar</button></div></>}
    </Modal>}
  </div>
}

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login'|'signup'|'organizer'|'invite'>('login')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [phone, setPhone] = useState('')
  const inviteToken = new URLSearchParams(location.search).get('convite') || ''
  useEffect(() => { if (inviteToken) { setMode('invite'); void api<{email:string}>(`/invitations/${encodeURIComponent(inviteToken)}`).then(result => setInviteEmail(result.email)).catch(e => setError(e.message)) } }, [inviteToken])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(form.entries())
    try {
      if (mode === 'invite') { await api('/invitations/accept', {method:'POST',body:{...values,token:inviteToken}}); const me = await api<{user:User}>('/me'); onLogin(me.user); return }
      const path = mode === 'organizer' ? '/organizer/login' : mode === 'signup' ? '/signup' : '/login'
      const result = await api<{user:User}>(path, {method:'POST',body:values})
      onLogin(result.user)
    } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível entrar.') }
    finally { setBusy(false) }
  }
  return <main className="auth-page"><section className="auth-card">
    <div className="hero-logo"><div className="logo-emblem"><Icon name="fire" /></div><span>ethos tribo</span></div>
    <p className="eyebrow">Um convite para viver o agora</p>
    <h1>{mode === 'signup' ? 'Bem-vindo à Ethos Tribo!' : mode === 'organizer' ? 'Acesso do organizador' : mode === 'invite' ? 'Criar meu acesso' : 'Que bom ter você de volta'}</h1>
    {mode === 'signup' && <p className="subheading">Seu cadastro é feito uma vez só. Depois, é só chegar e aproveitar.</p>}
    {mode === 'invite' && <p className="subheading">Você foi convidado para organizar eventos na Ethos Tribo.</p>}
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    <form onSubmit={submit} className="form-stack">
      {mode === 'signup' && <label>Nome completo<input name="name" autoComplete="name" required minLength={2} maxLength={100} /></label>}
      {(mode === 'signup' || mode === 'login') && <label>{mode === 'signup'?'Telefone (WhatsApp)':'Telefone'}<input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" value={phone} onChange={e=>setPhone(maskPhone(e.target.value))} required /></label>}
      {mode === 'organizer' && <><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required /></label></>}
      {mode === 'signup' && <label>PIN de 6 dígitos<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="new-password" required /></label>}
      {mode === 'login' && <label>PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="current-password" required /></label>}
      {mode === 'invite' && <><label>E-mail<input name="email" type="email" value={inviteEmail} readOnly required /></label><label>Nome completo<input name="name" autoComplete="name" required minLength={2} maxLength={100} /></label><label>Senha (mínimo 12 caracteres)<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label><label>Confirme sua senha<input name="confirmPassword" type="password" minLength={12} autoComplete="new-password" required /></label></>}
      <button className="button primary full" disabled={busy}>{busy ? 'Só um instante…' : mode === 'signup' ? 'Criar cadastro' : mode === 'organizer' ? 'Entrar (owner ou admin)' : mode === 'invite' ? 'Criar acesso' : 'Entrar'}</button>
    </form>
    {mode === 'login' && <div className="info-note"><strong>Esqueceu o PIN?</strong><br />Fale com um organizador da Ethos Tribo. Ele redefine e você escolhe um novo.</div>}
    <div className="auth-links">
      {mode === 'login' && <><button onClick={() => setMode('signup')}>Criar cadastro</button><button onClick={() => setMode('organizer')}>Acesso do organizador</button></>}
      {mode === 'signup' && <button onClick={() => setMode('login')}>Já tenho cadastro</button>}
      {mode === 'organizer' && <button onClick={() => setMode('login')}>Voltar para participantes</button>}
    </div>
    {mode === 'organizer' && <p className="small-muted">Recebeu um convite? Abra o link enviado pelo owner para criar seu acesso.</p>}
  </section></main>
}
function maskPhone(value:string) {
  const digits=value.replace(/\D/g,'').slice(0,11)
  if(digits.length<3)return digits
  const area=digits.slice(0,2)
  const local=digits.slice(2)
  const split=digits.length>10?5:4
  return `(${area}) ${local.slice(0,split)}${local.length>split?`-${local.slice(split)}`:''}`
}

function EventCard({ event, onOpen, onJoin, onLeave, onEdit, person = false, mine = false, admin = false }: { event: EventItem; onOpen:()=>void; onJoin:()=>void; onLeave?:()=>void; onEdit?:()=>void; person?:boolean; mine?:boolean; admin?:boolean }) {
  const lot = event.confirmed_count >= event.seats
  const waitlisted = event.my_situation === 'waitlist'
  return <article className="event-card">
    <button className="card-open" onClick={onOpen} aria-label={`Ver ${event.name}`}>
      <div className="card-kicker"><span className="tag">{event.type === 'recorrente' ? 'Semanal' : 'Sazonal'}</span><span className="modality">{event.modality}</span></div>
      <h2>{event.name}</h2><p className="event-meta"><Icon name="calendar" /> {formatDate(event.starts_at)} · {timeRange(event)}</p>
      {event.location && <p className="event-meta"><Icon name="pin" /> {event.location}</p>}
      <div className="card-stats"><strong>{event.confirmed_count} de {event.seats} vagas</strong><span>{money(event.price_cents)}</span></div>
      {admin && <div className="admin-stats"><span>{event.paid_count} pagos</span><span>{event.confirmed_count-event.paid_count} pendentes</span><span>{event.waiting_count} na espera</span></div>}
      {waitlisted && <Badge type="wait">Espera · {event.my_wait_position}º</Badge>}
      {event.my_situation === 'confirmed' && <Badge type={event.my_payment === 'paid' ? 'paid' : 'pending'}>{event.my_payment === 'paid' ? 'Pago' : 'Pendente'}</Badge>}
      {person && event.closedForJoin && !mine && !event.my_situation && <p className="closed-label">Inscrições encerradas</p>}
    </button>
    {person && !mine && <div className="card-actions">{event.my_situation ? <button className="button secondary full" onClick={onOpen}>Ver lista</button> : event.closedForJoin ? <button className="button secondary full" disabled>Prazo encerrado</button> : <button className={`button ${lot ? 'secondary' : 'primary'} full`} onClick={onJoin}>{lot ? 'Entrar na lista de espera' : 'Quero participar'}</button>}</div>}
    {mine && <div className="card-actions"><button className="button secondary full" onClick={onOpen}>Ver lista</button><button className="text-button" onClick={onLeave}>Desistir</button></div>}
    {admin && <div className="card-actions"><button className="button secondary full" onClick={onOpen}>Gerenciar lista</button><button className="text-button" onClick={onEdit}>Editar</button></div>}
  </article>
}

function Badge({ type, children }: {type:'paid'|'pending'|'wait';children:React.ReactNode}) {
  return <span className={`badge ${type}`}><Icon name={type === 'paid' ? 'check' : 'empty'} />{children}</span>
}
function EmptyState({ title, text, action }: { title:string;text:string;action?:React.ReactNode }) { return <div className="empty-state"><div className="empty-icon"><Icon name="fire" /></div><h2>{title}</h2><p>{text}</p>{action}</div> }

function EventDetail({detail,user,canExportReport,exportingReport,onExportReport,onJoin,onLeave,onPayment,onRemove,onClose}:{detail:OccurrenceDetail;user:User;canExportReport:boolean;exportingReport:boolean;onExportReport:()=>void;onJoin:()=>void;onLeave:()=>void;onPayment:(r:Registration,p:boolean)=>void;onRemove:(r:Registration)=>void;onClose:()=>void}) {
  const {occurrence:event,registrations}=detail
  const people=registrations.filter(r=>r.situation==='confirmed')
  const wait=registrations.filter(r=>r.situation==='waitlist')
  const own=registrations.find(r=>r.person_id===user.id)
  const paid=people.filter(r=>r.payment==='paid').length
  const participant=user.kind==='person'
  const lot=people.length>=event.seats
  const cutoffTime=new Date(new Date(event.starts_at).getTime()-event.cutoff_hours*3600000).toISOString()
  const canChange=!detail.closedForJoin
  return <div className="detail-view">
    <div className="detail-hero"><span className="tag">{event.type==='recorrente'?'Semanal':'Sazonal'}</span><h1>{event.name}</h1><p className="subheading">{event.modality}</p></div>
    {user.kind==='organizer'&&<div className="detail-report-action"><ReportButton disabled={!canExportReport} loading={exportingReport} onClick={onExportReport} /></div>}
    <div className="detail-facts"><div><Icon name="calendar" /><span>{formatDate(event.starts_at)}<br/><strong>{timeRange(event)}</strong></span></div><div><Icon name="pin" /><span>{event.location||'Local a combinar'}</span></div></div>
    <section className="pix-card"><div><span className="eyebrow">Contribuição</span><strong>{money(event.price_cents)}</strong></div><div><span className="eyebrow">Chave Pix</span><span className="pix-key">{event.pix_key||'Chave a informar pelo organizador'}</span></div>{event.pix_key&&<button className="copy-button" onClick={()=>void navigator.clipboard.writeText(event.pix_key).then(()=>alert('Chave Pix copiada.'))} aria-label="Copiar chave Pix"><Icon name="copy" /></button>}</section>
    <div className="list-summary"><div><strong>Inscritos {people.length} de {event.seats}</strong><span>{paid} pagos · {people.length-paid} pendentes</span></div>{own&&<Badge type={own.situation==='waitlist'?'wait':own.payment==='paid'?'paid':'pending'}>{own.situation==='waitlist'?`Espera · ${own.wait_position}º`:own.payment==='paid'?'Pago':'Pendente'}</Badge>}</div>
    <section className="roster-section"><h2>Lista de inscritos</h2>{people.length ? <ol className="roster">{people.map((r,index)=><li className={r.person_id===user.id?'is-you':''} key={r.id}><span className="rank">{index+1}</span><span className="roster-name">{r.name}{r.person_id===user.id?' (você)':''}{!participant&&r.phone&&<small>{r.phone}</small>}</span>    {participant?<Badge type={r.payment==='paid'?'paid':'pending'}>{r.payment==='paid'?'Pago':'Pendente'}</Badge>:<div className="row-actions">{r.payment==='paid'?<button className="button paid-action small" onClick={()=>{if(confirm('Desfazer a confirmação deste pagamento?'))onPayment(r,false)}}>✓ Pago · desfazer</button>:<button className="button secondary small" onClick={()=>onPayment(r,true)}>Marcar como pago</button>}<button className="text-button danger-text" onClick={()=>onRemove(r)}>Remover inscrito</button></div>}</li>)}</ol>:<p className="small-muted">Ainda não há inscritos.</p>}</section>
    <section className="roster-section waiting-section"><h2>Lista de espera <span className="tag">{wait.length}</span></h2>{wait.length?<ol className="roster">{wait.map(r=><li key={r.id}><span className="rank">{r.wait_position}</span><span className="roster-name">{r.name}{r.person_id===user.id?' (você)':''}{!participant&&r.phone&&<small>{r.phone}</small>}</span><Badge type="wait">{r.wait_position}º da espera</Badge>{!participant&&<button className="text-button danger-text" onClick={()=>onRemove(r)}>Remover</button>}</li>)}</ol>:<p className="small-muted">Ainda não há pessoas na espera.</p>}</section>
    <div className="info-note"><strong>Inscrições e desistências até {event.cutoff_hours}h antes do início ({formatDate(cutoffTime,{weekday:'short',hour:'2-digit',minute:'2-digit'})}).</strong><br/>Fez o Pix? O organizador confirma seu pagamento e o status muda para Pago.</div>
    {participant && <div className="sticky-action">{own ? own.payment==='paid'&&own.situation==='confirmed' ? <button className="button secondary full" onClick={onLeave}>Falar com o organizador para desistir</button> : <button className="button secondary full" disabled={!canChange} onClick={onLeave}>{canChange?'Desistir da vaga':'Prazo encerrado'}</button> : <button className="button primary full" disabled={!canChange} onClick={onJoin}>{!canChange?'Inscrições encerradas':lot?'Entrar na lista de espera':'Entrar na lista'}</button>}{!canChange&&<><small>As inscrições e desistências fecharam. Fale com um organizador se precisar de ajuda.</small>{detail.ownerWhatsapp&&<a className="text-button underlined" href={`https://wa.me/${detail.ownerWhatsapp}`} target="_blank" rel="noreferrer">Falar com um organizador no WhatsApp</a>}</>}</div>}
    {!participant&&<div className="info-note">Só o organizador altera o status de pagamento. O telefone aparece apenas aqui.</div>}
    {user.kind==='organizer'&&<button className="button danger full" onClick={()=>{const creator=event.created_by_name?`\nCriado por ${event.created_by_name}.`:'';if(confirm(`Encerrar “${event.name}”?${creator}\nAs próximas ocorrências não serão abertas.`))void onClose()}}>Encerrar evento</button>}
  </div>
}

function ModalityChips({modalities,selected,onSelect,label}:{modalities:Pick<Modality,'id'|'name'>[];selected:string;onSelect:(id:string)=>void;label:string}) {
  return <div className="chips" aria-label={label}>
    <button className={`chip ${selected==='all'?'active':''}`} onClick={()=>onSelect('all')}>Todos</button>
    {modalities.map(modality=><button key={modality.id} className={`chip ${selected===modality.id?'active':''}`} onClick={()=>onSelect(modality.id)}>{modality.name}</button>)}
  </div>
}

function ReportButton({disabled,loading,onClick}:{disabled:boolean;loading:boolean;onClick:()=>void}) {
  const tooltip = disabled ? 'Sem eventos para exportar' : undefined
  return <span className="report-button-wrapper" title={tooltip}>
    <button type="button" className="button secondary small report-button" disabled={disabled||loading} onClick={onClick} title={tooltip}>
      {loading?'Gerando…':'Baixar Excel'}
    </button>
  </span>
}

function ModalityManager({modalities,reportableCounts,exportingModalityId,onExport,isOwner,onPreview,onCreate,onUse,onRename,onToggle,onMerge,onDelete}:{modalities:Modality[];reportableCounts:Record<string,number>;exportingModalityId:string;onExport:(id:string)=>Promise<void>;isOwner:boolean;onPreview:(name:string)=>Promise<ModalityPreview>;onCreate:(name:string)=>Promise<{modality:Modality;created:boolean}>;onUse:(modality:Modality)=>Promise<Modality>;onRename:(id:string,name:string)=>Promise<boolean>;onToggle:(id:string,archived:boolean)=>Promise<boolean>;onMerge:(id:string,targetId:string)=>Promise<boolean>;onDelete:(id:string)=>Promise<boolean>}) {
  const [renamingId,setRenamingId]=useState('')
  const [name,setName]=useState('')
  const [targets,setTargets]=useState<Record<string,string>>({})
  const [creating,setCreating]=useState(false)
  const [newName,setNewName]=useState('')
  const [preview,setPreview]=useState<ModalityPreview|null>(null)
  const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const activeModalities=modalities.filter(modality=>!modality.archived_at)
  const archivedModalities=modalities.filter(modality=>Boolean(modality.archived_at))

  async function checkNewModality(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try { setPreview(await onPreview(newName)) }
    catch(failure) { setError(failure instanceof Error?failure.message:'Não foi possível verificar o nome da modalidade.') }
    finally { setSaving(false) }
  }

  async function useExisting(modality:Modality) {
    setSaving(true)
    setError('')
    try {
      await onUse(modality)
      setCreating(false)
      setPreview(null)
      setNewName('')
    } catch(failure) {
      setError(failure instanceof Error?failure.message:'Não foi possível usar esta modalidade.')
    } finally { setSaving(false) }
  }

  async function confirmCreate() {
    if(!preview)return
    setSaving(true)
    setError('')
    try {
      const result=await onCreate(preview.normalized.name)
      if(result.modality.archived_at) await onUse(result.modality)
      setCreating(false)
      setPreview(null)
      setNewName('')
    } catch(failure) {
      setError(failure instanceof Error?failure.message:'Não foi possível criar a modalidade.')
    } finally { setSaving(false) }
  }

  function renderModalities(items:Modality[]) {
    return items.map(modality=><article className="modality-management-card" key={modality.id}>
      <div className="modality-management-heading">
        <div><h2>{modality.name}</h2><p>{modality.event_count||0} {(modality.event_count||0)===1?'evento vinculado':'eventos vinculados'} · {modality.archived_at?'Arquivada':'Ativa'}</p>{!modality.event_count&&modality.created_at&&Date.now()-new Date(modality.created_at).getTime()>=3*86400000&&<span className="tag unused-modality">Sem uso há {Math.floor((Date.now()-new Date(modality.created_at).getTime())/86400000)} dias</span>}</div>
        <span className="tag">{modality.slug}</span>
      </div>
      {renamingId===modality.id
        ? <form className="modality-rename-form" onSubmit={async event=>{event.preventDefault();if(await onRename(modality.id,name))setRenamingId('')}}><label>Novo nome<input value={name} onChange={event=>setName(event.target.value)} minLength={2} maxLength={80} required /></label><div className="button-row"><button className="button primary small">Salvar nome</button><button type="button" className="button secondary small" onClick={()=>setRenamingId('')}>Cancelar</button></div></form>
        : <div className="modality-actions">
          <button className="button secondary small" onClick={()=>{setRenamingId(modality.id);setName(modality.name)}}>Renomear</button>
          <ReportButton disabled={!reportableCounts[modality.id]} loading={exportingModalityId===`modality:${modality.id}`} onClick={()=>void onExport(modality.id)} />
          <button className="button secondary small" onClick={()=>void onToggle(modality.id,!modality.archived_at)}>{modality.archived_at?'Reativar':'Arquivar'}</button>
          {isOwner&&Boolean(modality.event_count)&&<div className="modality-merge"><label>Mesclar em<select value={targets[modality.id]||''} onChange={event=>setTargets(current=>({...current,[modality.id]:event.target.value}))}><option value="">Escolher destino ativo</option>{modalities.filter(target=>target.id!==modality.id&&!target.archived_at).map(target=><option key={target.id} value={target.id}>{target.name}</option>)}</select></label><button className="button secondary small" disabled={!targets[modality.id]} onClick={()=>{const target=modalities.find(item=>item.id===targets[modality.id]);if(target&&confirm(`Mesclar “${modality.name}” em “${target.name}” moverá ${modality.event_count} ${(modality.event_count||0)===1?'evento':'eventos'}. A origem será arquivada. Continuar?`))void onMerge(modality.id,target.id).then(ok=>{if(ok)setTargets(current=>({...current,[modality.id]:''}))})}}>Mesclar</button></div>}
          {isOwner&&!modality.event_count&&<button className="button danger small" onClick={()=>{if(confirm(`Excluir a modalidade sem eventos “${modality.name}”?`))void onDelete(modality.id)}}>Excluir</button>}
        </div>}
    </article>)
  }

  return <div className="modality-manager">
    <div className="admin-heading modality-manager-heading"><div><p className="subheading">Crie e organize as modalidades disponíveis para eventos.</p></div><button className="button primary" onClick={()=>{setCreating(true);setPreview(null);setError('')}}><Icon name="plus" /> Nova modalidade</button></div>
    {creating&&<section className="modality-create-panel">
      <form className="form-stack" onSubmit={checkNewModality}>
        <div className="modality-panel-heading"><h2>Nova modalidade</h2><button type="button" className="text-button" onClick={()=>{setCreating(false);setPreview(null);setError('')}}>Cancelar</button></div>
        <label>Nome<input value={newName} onChange={event=>{setNewName(event.target.value);setPreview(null)}} placeholder="Ex.: Vôlei de areia" minLength={2} maxLength={80} pattern="[A-Za-zÀ-ÿ0-9 -]+" title="Use letras, números, espaços ou hífens." required /></label>
        {preview&&<div className="modality-confirmation"><strong>Pré-visualização</strong><p>Nome: <b>{preview.normalized.name}</b></p><p>Slug: <code>{preview.normalized.slug}</code></p>
          {preview.exact&&<><p>Já existe uma modalidade parecida: <b>{preview.exact.name}</b>{preview.exact.archived_at?' (arquivada)':''}.</p><button type="button" className="button secondary full" disabled={saving} onClick={()=>void useExisting(preview.exact!)}>{preview.exact.archived_at?'Reativar':'Usar'} existente</button></>}
          {!preview.exact&&preview.similar.length>0&&<div><p>Encontramos modalidades com nome muito semelhante:</p>{preview.similar.map(item=><button type="button" className="button secondary small" key={item.id} disabled={saving} onClick={()=>void useExisting(item)}>{item.archived_at?'Reativar':'Usar'} “{item.name}”</button>)}</div>}
          {!preview.exact&&<button type="button" className="button primary full" disabled={saving} onClick={()=>void confirmCreate()}>{saving?'Salvando…':`Confirmar e criar “${preview.normalized.name}”`}</button>}
        </div>}
        {error&&<div className="alert alert-error" role="alert">{error}</div>}
        {!preview&&<button className="button secondary full" disabled={saving}>{saving?'Verificando…':'Pré-visualizar nome'}</button>}
      </form>
    </section>}
    <section className="modality-section"><h2>Ativas</h2><div className="modality-management-list">{activeModalities.length?renderModalities(activeModalities):<p className="small-muted">Não há modalidades ativas.</p>}</div></section>
    <section className="modality-section"><h2>Arquivadas</h2><div className="modality-management-list">{archivedModalities.length?renderModalities(archivedModalities):<p className="small-muted">Não há modalidades arquivadas.</p>}</div></section>
  </div>
}

function EventForm({onSubmit,onManageModalities,modalities,initial,preferredModalityId}:{onSubmit:(data:Record<string,unknown>)=>Promise<void>;onManageModalities:()=>void;modalities:Modality[];initial?:EventItem;preferredModalityId:string}) {
  const [type,setType]=useState<'recorrente'|'sazonal'>(initial?.type||'recorrente')
  const [start,setStart]=useState(initial?.start_time?.slice(0,5)||'16:00');const[end,setEnd]=useState(initial?.end_time?.slice(0,5)||'18:00')
  const [modalityId,setModalityId]=useState(initial?.modality_id||'')
  const [formError,setFormError]=useState('')
  const [saving,setSaving]=useState(false)
  const mins=(time:string)=>{const [h,m]=time.split(':').map(Number);return h*60+m}
  const length=end&&start?((mins(end)-mins(start)+1440)%1440):0
  const activeModalities=modalities.filter(modality=>!modality.archived_at)
  const availableModalities=modalities.filter(modality=>!modality.archived_at||modality.id===initial?.modality_id)
  const selectedModality=modalityId||preferredModalityId||initial?.modality_id||activeModalities[0]?.id||''
  useEffect(()=>{if(preferredModalityId)setModalityId(preferredModalityId)},[preferredModalityId])
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setFormError('')
    const form=new FormData(e.currentTarget);const values=Object.fromEntries(form.entries())
    if(!length){setFormError('Informe um horário de término válido.');setSaving(false);return}
    if(!activeModalities.length&&!initial?.modality_id){setFormError('Cadastre uma modalidade antes de criar o evento.');setSaving(false);return}
    try {await onSubmit({...values,modality_id:selectedModality,type,price:Number(values.price||0),seats:Number(values.seats),cutoffHours:Number(values.cutoffHours),weekday:Number(values.weekday)})}
    catch(error) {setFormError(error instanceof Error?error.message:'Não foi possível salvar o evento.')}
    finally {setSaving(false)}
  }
  return <section className="form-panel"><p className="eyebrow">{initial?'Ajustar encontro':'Novo encontro'}</p><h1>{initial?'Editar evento':'Criar evento'}</h1><p className="subheading">Monte a lista e compartilhe com a comunidade.</p><form className="form-stack" onSubmit={submit}><label>Nome do evento<input name="name" placeholder="Ex.: Vôlei de quadra" defaultValue={initial?.name||''} required minLength={2} /></label><label>Modalidade<select name="modality_id" value={selectedModality} onChange={event=>setModalityId(event.target.value)} disabled={!activeModalities.length&&!initial?.modality_id} required><option value="">{activeModalities.length?'Selecione uma modalidade':'Nenhuma modalidade cadastrada'}</option>{availableModalities.map(modality=><option key={modality.id} value={modality.id}>{modality.name}{modality.archived_at?' (arquivada)':''}</option>)}</select></label><button type="button" className="text-button underlined manage-modalities-link" onClick={onManageModalities}>{activeModalities.length?'Gerenciar modalidades':'Cadastrar modalidade'}</button>{formError&&<div className="alert alert-error" role="alert">{formError}</div>}<fieldset className="segmented"><legend>Tipo de evento</legend><button type="button" disabled={Boolean(initial)} className={type==='recorrente'?'selected':''} onClick={()=>setType('recorrente')}>Recorrente</button><button type="button" disabled={Boolean(initial)} className={type==='sazonal'?'selected':''} onClick={()=>setType('sazonal')}>Sazonal</button></fieldset>
    {type==='recorrente'?<label>Dia da semana<select name="weekday" defaultValue={String(initial?.weekday ?? 6)}><option value="0">Domingo</option><option value="1">Segunda-feira</option><option value="2">Terça-feira</option><option value="3">Quarta-feira</option><option value="4">Quinta-feira</option><option value="5">Sexta-feira</option><option value="6">Sábado</option></select></label>:<label>Data<input name="date" type="date" defaultValue={initial?localDateInput(initial.starts_at):undefined} min={new Date().toISOString().slice(0,10)} required /></label>}
    <div className="two-fields"><label>Início<input name="startTime" type="time" value={start} onChange={e=>setStart(e.target.value)} required /></label><label>Fim<input name="endTime" type="time" value={end} onChange={e=>setEnd(e.target.value)} required /></label></div><p className="duration-line"><Icon name="clock"/> Duração: {Math.floor(length/60)?`${Math.floor(length/60)}h`:''}{length%60?`${length%60}`:''}{length<60?'min':''}</p>
    <div className="two-fields"><label>Vagas<input name="seats" type="number" min="1" max="1000" defaultValue={initial?.seats||16} required /></label><label>Valor (R$)<input name="price" type="number" min="0" step="0.01" defaultValue={initial?(initial.price_cents/100).toFixed(2):'0'} required /></label></div><label>Chave Pix<input name="pixKey" placeholder="Chave Pix" defaultValue={initial?.pix_key||''} /></label><label>Local<input name="location" placeholder="Onde será o encontro?" defaultValue={initial?.location||''} /></label><label>Fechar entrada e saída (horas antes)<input name="cutoffHours" type="number" min="0" max="168" defaultValue={initial?.cutoff_hours??5} required /></label><div className="info-note">A lista da próxima semana abre automaticamente no dia seguinte ao evento (ex.: domingo, para o sábado seguinte).</div><button className="button primary full" disabled={saving||(!activeModalities.length&&!initial?.modality_id)}>{saving?'Salvando…':initial?'Salvar alterações':'Publicar evento'}</button></form></section>
}

function Profile({user,onSaveName,onChangePin,onLogout}:{user:User;onSaveName:(name:string)=>Promise<void>;onChangePin:(current:string,next:string)=>Promise<void>;onLogout:()=>void}) {
  const [name,setName]=useState(user.name);const[showPin,setShowPin]=useState(Boolean(user.pinResetRequired))
  return <main className="page profile-page"><div className="profile-header"><div className="avatar">{user.name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div><h1>{user.name}</h1><p>{user.phone}</p></div>{user.pinResetRequired&&<div className="info-note"><strong>Escolha um novo PIN para continuar.</strong><br/>Um organizador redefiniu seu acesso. Use o PIN temporário que recebeu para criar um PIN pessoal.</div>}{!user.pinResetRequired&&<><form className="form-stack profile-form" onSubmit={e=>{e.preventDefault();void onSaveName(name)}}><label>Nome completo<input value={name} onChange={e=>setName(e.target.value)} required /></label><button className="button secondary full">Salvar alterações</button></form><div className="info-note">Seu nome aparece na lista dos eventos. O telefone é visível só para os organizadores. Para trocar o telefone, fale com um organizador.</div><button className="button secondary full" onClick={()=>setShowPin(!showPin)}>Alterar PIN</button></>}{showPin&&<form className="form-stack pin-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void onChangePin(String(f.get('current')),String(f.get('next')))}}><label>PIN atual<input name="current" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label><label>Novo PIN<input name="next" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label><button className="button primary full">Salvar novo PIN</button></form>}{!user.pinResetRequired&&<><details className="privacy"><summary>Privacidade</summary><p>Seu telefone é usado para identificar seu cadastro e é visível somente aos organizadores. Seu nome e status de pagamento aparecem na lista do evento para a comunidade. Você pode pedir a remoção do cadastro a um organizador.</p></details><button className="button secondary full" onClick={onLogout}>Sair deste aparelho</button></>}</main>
}

function SettingsForm({initial,onSave}:{initial:{whatsapp:string;defaultPix:string};onSave:(settings:{whatsapp:string;defaultPix:string})=>Promise<void>}) {const [whatsapp,setWhatsapp]=useState(initial.whatsapp);const[defaultPix,setDefaultPix]=useState(initial.defaultPix);useEffect(()=>{setWhatsapp(initial.whatsapp);setDefaultPix(initial.defaultPix)},[initial.whatsapp,initial.defaultPix]);return <form className="form-stack settings" onSubmit={e=>{e.preventDefault();void onSave({whatsapp,defaultPix})}}><h2 className="section-title">Configurações da comunidade</h2><label>WhatsApp do owner (DDI + DDD)<input value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} placeholder="5511999999999" inputMode="tel" /></label><label>Chave Pix padrão<input value={defaultPix} onChange={e=>setDefaultPix(e.target.value)} placeholder="Usada quando o evento não informa outra chave" /></label><button className="button secondary">Salvar configurações</button></form>}
function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}) {return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label="Fechar"><Icon name="close"/></button><h2 id="modal-title">{title}</h2>{children}</section></div>}
function auditLabel(action:string) {const labels:Record<string,string>={mark_paid:'Pagamento confirmado',mark_pending:'Pagamento desfeito',remove_registration:'Inscrição removida',reset_pin:'PIN redefinido',remove_person:'Pessoa removida',create_event:'Evento criado',close_event_series:'Série encerrada',export_modality_report:'Relatório de pagamentos exportado',export_occurrence_report:'Relatório do evento exportado',invite_organizer:'Organizador convidado',cancel_invitation:'Convite cancelado',remove_organizer:'Acesso de organizador removido',promote_waitlist:'Pessoa promovida da espera',create_modality:'Modalidade criada',rename_modality:'Modalidade renomeada',archive_modality:'Modalidade arquivada',reactivate_modality:'Modalidade reativada',merge_modalities:'Modalidades mescladas',delete_modality:'Modalidade excluída'};return labels[action]||action.replaceAll('_',' ')}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
