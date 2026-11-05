import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, MessageCircle, Users, Megaphone, CalendarDays, FolderOpen, Search,
  Send, Paperclip, Smile, LogOut, Menu, X, Image as ImageIcon, FileText,
  CheckCheck, Plus, ShieldCheck, ArrowLeft, MoreVertical, Download, LoaderCircle
} from 'lucide-react'
import { supabase, isConfigured } from './lib/supabase'

const EMOJIS = ['😀','😊','😂','🥰','🙏','👍','👏','🎉','❤️','🔥','🤝','✅']
const fmt = (v) => new Date(v).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})
const initials = (s='Pegawai') => s.split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()

export default function App() {
  const [session,setSession] = useState(null)
  const [profile,setProfile] = useState(null)
  const [conversations,setConversations] = useState([])
  const [active,setActive] = useState(null)
  const [messages,setMessages] = useState([])
  const [text,setText] = useState('')
  const [loginEmail,setLoginEmail] = useState('')
  const [loginPassword,setLoginPassword] = useState('')
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [showEmoji,setShowEmoji] = useState(false)
  const [mobileChat,setMobileChat] = useState(false)
  const [search,setSearch] = useState('')
  const [fileBusy,setFileBusy] = useState(false)
  const fileRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.auth.getSession().then(({data}) => setSession(data.session))
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || !supabase) { setProfile(null); setConversations([]); setActive(null); return }
    loadProfile()
  }, [session])

  async function loadProfile() {
    const {data,error} = await supabase.from('profiles').select('*').eq('id',session.user.id).single()
    if (error) { setError('Profil belum tersedia. Hubungi admin untuk menyiapkan akun pegawai.'); return }
    setProfile(data)
    await loadConversations()
  }

  async function loadConversations() {
    const {data,error} = await supabase.from('conversation_members')
      .select('conversation_id, conversations(id,title,type,updated_at)')
      .eq('user_id',session.user.id)
    if (error) { setError(error.message); return }
    const rows = (data || []).map(x=>x.conversations).filter(Boolean)
    rows.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at))
    setConversations(rows)
    if (!active && rows.length) setActive(rows[0])
  }

  useEffect(() => {
    if (!active || !supabase) { setMessages([]); return }
    let alive = true
    async function load() {
      const {data,error} = await supabase.from('messages')
        .select('id,conversation_id,sender_id,body,attachment_name,attachment_path,attachment_type,created_at,profiles:sender_id(full_name)')
        .eq('conversation_id',active.id).order('created_at',{ascending:true}).limit(300)
      if (error) { setError(error.message); return }
      if (alive) setMessages(data || [])
    }
    load()
    const channel = supabase.channel('messages-'+active.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${active.id}`},payload=>{
        supabase.from('messages').select('id,conversation_id,sender_id,body,attachment_name,attachment_path,attachment_type,created_at,profiles:sender_id(full_name)')
          .eq('id',payload.new.id).single().then(({data})=>{
            if (data && alive) setMessages(old=>old.some(m=>m.id===data.id)?old:[...old,data])
          })
      }).subscribe()
    return ()=>{ alive=false; supabase.removeChannel(channel) }
  }, [active?.id])

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) },[messages])

  async function signIn(e) {
    e.preventDefault(); setError(''); setBusy(true)
    const {error} = await supabase.auth.signInWithPassword({email:loginEmail.trim(),password:loginPassword})
    if (error) setError('Login gagal. Periksa email dan password atau hubungi admin.')
    setBusy(false)
  }

  async function signOut() { await supabase.auth.signOut(); setProfile(null); setActive(null); setMobileChat(false) }

  async function sendMessage(e) {
    e?.preventDefault()
    if (!text.trim() || !active || !supabase) return
    const body = text.trim(); setText('')
    const {error} = await supabase.from('messages').insert({conversation_id:active.id,sender_id:session.user.id,body})
    if (error) { setText(body); setError('Pesan belum terkirim: '+error.message) }
    else await supabase.from('conversations').update({updated_at:new Date().toISOString()}).eq('id',active.id)
  }

  async function sendFile(file) {
    if (!file || !active || !supabase) return
    setFileBusy(true); setError('')
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const path = `${active.id}/${session.user.id}/${Date.now()}-${safeName}`
    const {error:uploadError} = await supabase.storage.from('chat-files').upload(path,file,{upsert:false})
    if (uploadError) { setError('Unggah gagal: '+uploadError.message); setFileBusy(false); return }
    const {error:insertError} = await supabase.from('messages').insert({
      conversation_id:active.id,sender_id:session.user.id,body:'',
      attachment_name:file.name,attachment_path:path,attachment_type:file.type || 'application/octet-stream'
    })
    if (insertError) setError('File terunggah tetapi pesan gagal disimpan: '+insertError.message)
    setFileBusy(false)
  }

  async function openAttachment(m) {
    const {data,error} = await supabase.storage.from('chat-files').createSignedUrl(m.attachment_path,300)
    if (error) { setError(error.message); return }
    window.open(data.signedUrl,'_blank','noopener,noreferrer')
  }

  async function createGroup() {
    const title = window.prompt('Nama grup baru:')
    if (!title?.trim()) return
    const {data,error} = await supabase.rpc('create_conversation',{p_title:title.trim(),p_type:'group',p_member_ids:[]})
    if (error) { setError('Grup belum dapat dibuat: '+error.message); return }
    await loadConversations()
    const {data:conv} = await supabase.from('conversations').select('*').eq('id',data).single()
    if (conv) { setActive(conv); setMobileChat(true) }
  }

  const filtered = useMemo(()=>conversations.filter(c=>(c.title||'Percakapan').toLowerCase().includes(search.toLowerCase())),[conversations,search])

  if (!isConfigured) return <SetupScreen />
  if (loading) return <div className="center-screen"><LoaderCircle className="spin"/> Memuat BIRO UMUM CONNECT...</div>

  if (!session) return <main className="login-wrap">
    <section className="login-card">
      <div className="brand-mark"><ShieldCheck size={34}/></div>
      <div className="eyebrow">BIRO UMUM SETDA PROVINSI SUMATERA BARAT</div>
      <h1>BIRO UMUM <span>CONNECT</span></h1>
      <p className="muted">Ruang komunikasi internal pegawai.</p>
      <form onSubmit={signIn} className="login-form">
        <label>Email kantor<input type="email" required value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="nama@instansi.go.id"/></label>
        <label>Password<input type="password" required value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} placeholder="Masukkan password"/></label>
        {error && <div className="error">{error}</div>}
        <button className="primary full" disabled={busy}>{busy?'Memproses...':'Masuk ke aplikasi'}</button>
      </form>
      <div className="login-foot">AKSES KHUSUS PEGAWAI • SISTEM INTERNAL</div>
    </section>
  </main>

  return <div className="app-shell">
    <aside className={`sidebar ${mobileChat?'hide-mobile':''}`}>
      <div className="side-brand"><div className="brand-mini"><ShieldCheck/></div><div><b>BIRO UMUM</b><small>CONNECT</small></div><button className="icon-btn mobile-only" onClick={()=>setMobileChat(true)}><X/></button></div>
      <div className="profile-strip"><div className="avatar gold">{initials(profile?.full_name)}</div><div className="profile-info"><b>{profile?.full_name || 'Pegawai'}</b><small>{profile?.position || 'Pegawai'} · {profile?.section || 'Biro Umum'}</small></div><button className="icon-btn" title="Keluar" onClick={signOut}><LogOut size={17}/></button></div>
      <div className="side-label">KOMUNIKASI</div>
      <div className="search-box"><Search size={16}/><input placeholder="Cari percakapan..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="conversation-head"><span>Pesan</span><button className="icon-btn" title="Buat grup" onClick={createGroup}><Plus size={18}/></button></div>
      <div className="conversation-list">
        {filtered.map(c=><button key={c.id} className={`conversation ${active?.id===c.id?'selected':''}`} onClick={()=>{setActive(c);setMobileChat(true)}}>
          <div className="avatar">{c.type==='group'?<Users size={19}/>:initials(c.title)}</div>
          <div className="conv-copy"><b>{c.title || 'Percakapan'}</b><small>{c.type==='group'?'Grup':'Percakapan pribadi'}</small></div>
        </button>)}
        {!filtered.length && <div className="empty-small">Belum ada percakapan. Admin atau anggota dapat membuat grup.</div>}
      </div>
      <div className="sidebar-bottom"><ShieldCheck size={15}/> Ruang komunikasi internal</div>
    </aside>

    <main className={`chat-area ${mobileChat?'show-mobile':''}`}>
      {active ? <>
        <header className="chat-header">
          <button className="icon-btn mobile-only" onClick={()=>setMobileChat(false)}><ArrowLeft/></button>
          <div className="avatar">{active.type==='group'?<Users size={19}/>:initials(active.title)}</div>
          <div className="chat-heading"><b>{active.title}</b><small>{active.type==='group'?'Grup komunikasi':'Percakapan'}</small></div>
          <button className="icon-btn"><MoreVertical/></button>
        </header>
        <section className="message-list">
          {messages.length===0 && <div className="empty-chat"><MessageCircle size={38}/><b>Mulai percakapan</b><span>Kirim pesan pertama ke ruang ini.</span></div>}
          {messages.map(m=><div key={m.id} className={`message-row ${m.sender_id===session.user.id?'mine':''}`}>
            <div className="message-bubble">
              {m.sender_id!==session.user.id && <b className="sender">{m.profiles?.full_name || 'Pegawai'}</b>}
              {m.body && <div className="message-text">{m.body}</div>}
              {m.attachment_path && <button className="attachment" onClick={()=>openAttachment(m)}>
                {m.attachment_type?.startsWith('image/')?<ImageIcon/>:<FileText/>}
                <span>{m.attachment_name}<small>Buka lampiran · tautan aman 5 menit</small></span><Download size={16}/>
              </button>}
              <div className="message-meta">{fmt(m.created_at)} {m.sender_id===session.user.id && <CheckCheck size={14}/>}</div>
            </div>
          </div>)}
          <div ref={bottomRef}/>
        </section>
        {showEmoji && <div className="emoji-tray">{EMOJIS.map(e=><button key={e} onClick={()=>setText(t=>t+e)}>{e}</button>)}</div>}
        <form className="composer" onSubmit={sendMessage}>
          <button type="button" className="icon-btn" onClick={()=>setShowEmoji(v=>!v)} title="Emoji"><Smile/></button>
          <button type="button" className="icon-btn" onClick={()=>fileRef.current?.click()} title="Lampirkan gambar atau dokumen" disabled={fileBusy}><Paperclip/></button>
          <input value={text} onChange={e=>setText(e.target.value)} placeholder="Tulis pesan..." aria-label="Tulis pesan"/>
          <input ref={fileRef} type="file" hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={e=>{sendFile(e.target.files?.[0]);e.target.value=''}}/>
          <button className="send-btn" disabled={!text.trim()} title="Kirim pesan"><Send size={18}/></button>
        </form>
        {fileBusy && <div className="upload-note">Mengunggah lampiran...</div>}
      </> : <div className="welcome-panel"><div className="welcome-emblem"><MessageCircle size={42}/></div><h2>BIRO UMUM CONNECT</h2><p>Pilih percakapan untuk mulai berkoordinasi.</p><small>Komunikasi internal dalam satu ruang kerja.</small></div>}
      {error && <div className="toast-error" onClick={()=>setError('')}>{error} <X size={14}/></div>}
    </main>
  </div>
}

function SetupScreen() {
  return <main className="setup-wrap"><section className="setup-card"><div className="brand-mark"><ShieldCheck size={34}/></div><div className="eyebrow">BIRO UMUM SETDA PROVINSI SUMATERA BARAT</div><h1>BIRO UMUM <span>CONNECT</span></h1><h2>Konfigurasi awal diperlukan</h2><p>Aplikasi sudah disiapkan, tetapi belum dihubungkan ke proyek database dan autentikasi.</p><ol><li>Buat proyek Supabase.</li><li>Jalankan skrip <code>supabase/schema.sql</code> di SQL Editor.</li><li>Salin URL proyek dan publishable/anon key ke file <code>.env</code>.</li><li>Jalankan <code>npm install</code> lalu <code>npm run dev</code>.</li></ol><p className="muted">Jangan masukkan service_role key ke aplikasi/browser.</p></section></main>
}