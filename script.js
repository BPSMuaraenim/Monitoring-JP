/* ============================================================
   Dashboard Monitoring JP Pegawai
   Auth + DB: Firebase
   File PDF: Google Drive via Apps Script Web App
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, deleteDoc, getDocs, query,
  orderBy, onSnapshot, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ==== 1) GANTI CONFIG FIREBASEMU ====
const firebaseConfig = {
  apiKey: "AIzaSyATz8umkN8kxW9BpRvQrLms-NRCoLrDsgM",
  authDomain: "monitoring-jp.web.app",
  projectId: "monitoring-jp",
  appId: "1:615799689454:web:f4728fcfdbf375404ce3ff"
};
// ==== 2) GANTI URL APPS SCRIPT & SECRET ====
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwbt8_9-nr54iyFSaIRKGFkWMq5dNpvhV4AjYF9zmAmS0M4sL2SCawVbRX-pLFtRLe5Fg/exec"; // ex: https://script.google.com/macros/s/AKfycb.../exec
const APPS_SCRIPT_SECRET = "APPS_SCRIPT_SECRET"; // bebas, tapi sama dengan di server.gs
// ==== 3) GANTI FOLDER ID DRIVE TUJUAN DI server.gs ====

// Konstanta
const TARGET_JP = 20;

// DOM helper
const $ = (sel) => document.querySelector(sel);

// DOM refs
const loginBtn = $('#loginBtn');
const logoutBtn = $('#logoutBtn');
const userBox = $('#userBox');
const userPhoto = $('#userPhoto');
const userName = $('#userName');

const pegawaiSelect = $('#pegawaiSelect');
const modeInfo = $('#modeInfo');

const totalJPEl = $('#totalJPEl');
const sisaJPEl = $('#sisaJPEl');
const statusEl = $('#statusEl');

const entryForm = $('#entryForm');
const nomorSertifikat = $('#nomorSertifikat');
const namaDiklat = $('#namaDiklat');
const jumlahJP = $('#jumlahJP');
const pdfFile = $('#pdfFile');

const searchInput = $('#searchInput');
const entriesTbody = $('#entriesTbody');

const allPegawaiList = $('#allPegawaiList');

const pdfFrame = $('#pdfFrame');
const pdfEmpty = $('#pdfEmpty');

const toastEl = $('#toast');

// Utils
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(()=> toastEl.classList.remove('show'), 1800);
}
const fmtDate = (d) => new Date(d).toLocaleDateString('id-ID', {year:'numeric', month:'short', day:'2-digit'});

// Firebase init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// State
let currentUser = null;
let viewingUid = null;
let entriesUnsub = null;
let profilesUnsub = null;
let profilesCache = [];
let entriesCache = [];

// Auth UI
loginBtn.addEventListener('click', async ()=>{
  try{ await signInWithPopup(auth, provider); }
  catch(e){ console.error(e); toast('Gagal login.'); }
});
logoutBtn.addEventListener('click', async ()=>{
  try{ await signOut(auth); } catch(e){ console.error(e); }
});

onAuthStateChanged(auth, async (user)=>{
  currentUser = user || null;

  if(currentUser){
    loginBtn.hidden = true;
    userBox.hidden = false;
    userPhoto.src = currentUser.photoURL || '';
    userName.textContent = currentUser.displayName || currentUser.email || 'Pengguna';
    await ensureProfile(currentUser);
    listenProfiles();
    setViewingUid(currentUser.uid);
  }else{
    loginBtn.hidden = false;
    userBox.hidden = true;
    userPhoto.src = ''; userName.textContent = '';
    detachEntries(); detachProfiles();
    pegawaiSelect.innerHTML = '';
    entriesTbody.innerHTML = '';
    allPegawaiList.innerHTML = '';
    pdfFrame.hidden = true; pdfEmpty.hidden = false;
    modeInfo.value = 'Belum login';
    totalJPEl.textContent = '0'; sisaJPEl.textContent = '20'; statusEl.textContent = 'Belum Tercapai';
  }
});

// Firestore helpers
async function ensureProfile(user){
  const pRef = doc(db, 'profiles', user.uid);
  await setDoc(pRef, {
    uid: user.uid,
    name: user.displayName || user.email || 'Pengguna',
    email: user.email || null,
    photoURL: user.photoURL || null,
    totalJP: 0,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function listenProfiles(){
  if(profilesUnsub) profilesUnsub();
  profilesUnsub = onSnapshot(collection(db, 'profiles'), (snap)=>{
    profilesCache = snap.docs.map(d => d.data()).sort((a,b)=> (a.name || '').localeCompare(b.name || ''));
    renderPegawaiSelect();
    renderAllPegawaiProgress();
  });
}
function detachProfiles(){ if(profilesUnsub){ profilesUnsub(); profilesUnsub = null; } profilesCache = []; }

function renderPegawaiSelect(){
  const prev = viewingUid;
  pegawaiSelect.innerHTML = '';
  profilesCache.forEach(p=>{
    const opt = document.createElement('option');
    opt.value = p.uid; opt.textContent = p.name || p.uid;
    pegawaiSelect.appendChild(opt);
  });
  if(profilesCache.length){
    const target = prev && profilesCache.find(p => p.uid === prev)
      ? prev : (currentUser ? currentUser.uid : profilesCache[0].uid);
    pegawaiSelect.value = target; setViewingUid(target, {reRenderSelect:false});
  }
}
pegawaiSelect.addEventListener('change', ()=> setViewingUid(pegawaiSelect.value));

function setViewingUid(uid, opts={reRenderSelect:true}){
  viewingUid = uid;
  if(opts.reRenderSelect) pegawaiSelect.value = uid;
  const myMode = currentUser && viewingUid === currentUser.uid;
  modeInfo.value = myMode ? 'Mode Input (data Anda)' : 'Mode Baca (pegawai lain)';
  setFormEnabled(myMode);
  listenEntries(viewingUid);
}
function setFormEnabled(enabled){
  entryForm.querySelectorAll('input, button').forEach(el => {
    if(el.type === 'reset') return;
    el.disabled = !enabled;
  });
}

function listenEntries(uid){
  detachEntries();
  const qRef = query(collection(db, 'users', uid, 'entries'), orderBy('createdAt', 'desc'));
  entriesUnsub = onSnapshot(qRef, (snap)=>{
    entriesCache = snap.docs.map(d=> ({ id: d.id, ...d.data() }));
    renderEntriesTable(); renderKPI();
    if(currentUser && uid === currentUser.uid){
      const total = entriesCache.reduce((s,r)=> s + (Number(r.jp)||0), 0);
      setDoc(doc(db, 'profiles', currentUser.uid), { totalJP: total, updatedAt: serverTimestamp() }, { merge: true });
    }
  });
}
function detachEntries(){ if(entriesUnsub){ entriesUnsub(); entriesUnsub = null; } entriesCache = []; }

function renderKPI(){
  const total = entriesCache.reduce((s,r)=> s + (Number(r.jp)||0), 0);
  totalJPEl.textContent = total;
  const sisa = Math.max(0, TARGET_JP - total);
  sisaJPEl.textContent = sisa;
  statusEl.textContent = total >= TARGET_JP ? 'Target Tercapai' : 'Belum Tercapai';
  statusEl.style.background = total >= TARGET_JP ? 'rgba(46,196,182,.15)' : 'rgba(255,107,44,.12)';
  statusEl.style.color = total >= TARGET_JP ? '#127a71' : '#b5471d';
}

searchInput.addEventListener('input', renderEntriesTable);
function renderEntriesTable(){
  const q = searchInput.value.trim().toLowerCase();
  const filtered = entriesCache.filter(r =>
    (r.namaDiklat || '').toLowerCase().includes(q) ||
    (r.nomorSertifikat || '').toLowerCase().includes(q)
  );

  entriesTbody.innerHTML = '';
  const canEdit = currentUser && viewingUid === currentUser.uid;

  filtered.forEach(r=>{
    const tr = document.createElement('tr');
    const createdAt = r.createdAt?.toDate ? r.createdAt.toDate() : new Date();

    const tdTgl = document.createElement('td'); tdTgl.textContent = fmtDate(createdAt);
    const tdNo = document.createElement('td'); tdNo.textContent = r.nomorSertifikat || '';
    const tdDiklat = document.createElement('td'); tdDiklat.textContent = r.namaDiklat || '';
    const tdJP = document.createElement('td'); tdJP.textContent = r.jp;

    const tdPDF = document.createElement('td');
    const link = document.createElement('a');
    link.href = '#'; link.className = 'badge-link'; link.textContent = 'Lihat PDF';
    link.addEventListener('click', (e)=>{
      e.preventDefault();
      showPdf(r.fileId);
    });
    tdPDF.appendChild(link);

    const tdActions = document.createElement('td'); tdActions.className = 'actions';
    if(canEdit){
      const btnReplace = document.createElement('button');
      btnReplace.className = 'btn btn-soft'; btnReplace.textContent = 'Ganti PDF';
      btnReplace.addEventListener('click', ()=> replacePdfForRecord(r.id, r.fileId));

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn';
      btnDelete.style.background = 'linear-gradient(180deg, #ef4444, #dc2626)';
      btnDelete.textContent = 'Hapus';
      btnDelete.addEventListener('click', ()=> deleteRecord(r.id, r.fileId));

      tdActions.append(btnReplace, btnDelete);
    }else{
      tdActions.textContent = '—';
    }

    tr.append(tdTgl, tdNo, tdDiklat, tdJP, tdPDF, tdActions);
    entriesTbody.appendChild(tr);
  });
}

function showPdf(fileId){
  if(!fileId){ pdfFrame.hidden = true; pdfEmpty.hidden = false; return; }
  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  pdfFrame.src = previewUrl;
  pdfFrame.hidden = false; pdfEmpty.hidden = true;
}

// ==== Upload ke Apps Script (Drive) ====
// Kirim file sebagai base64 di field "data" (hindari preflight CORS)
async function uploadToDrive(file){
  const base64 = await fileToBase64(file); // "data:application/pdf;base64,AAA..."
  const payload = {
    secret: APPS_SCRIPT_SECRET,
    action: 'upload',
    fileName: file.name,
    mimeType: file.type,
    dataUrl: base64
  };
  const form = new FormData();
  form.append('data', JSON.stringify(payload));
  const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: form });
  if(!resp.ok){ throw new Error('Upload gagal'); }
  const json = await resp.json();
  if(json.status !== 'ok'){ throw new Error(json.message || 'Upload gagal'); }
  return json; // {status:'ok', fileId, webViewLink, webContentLink}
}

async function deleteFromDrive(fileId){
  const payload = { secret: APPS_SCRIPT_SECRET, action: 'delete', fileId };
  const form = new FormData();
  form.append('data', JSON.stringify(payload));
  const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: form });
  if(!resp.ok) return false;
  const json = await resp.json();
  return json.status === 'ok';
}

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Form submit
entryForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!currentUser || viewingUid !== currentUser.uid){
    toast('Login dan pastikan Anda sedang melihat data Anda sendiri.'); return;
  }
  const no = (nomorSertifikat.value || '').trim();
  const diklat = (namaDiklat.value || '').trim();
  const jp = Number(jumlahJP.value);
  const file = pdfFile.files[0];

  if(!no || !diklat || !(jp >= 0) || !file){ toast('Lengkapi semua field & pilih PDF.'); return; }
  if(file.type !== 'application/pdf'){ toast('File harus PDF.'); return; }

  try{
    const { fileId, webViewLink } = await uploadToDrive(file);

    await addDoc(collection(db, 'users', currentUser.uid, 'entries'), {
      nomorSertifikat: no,
      namaDiklat: diklat,
      jp,
      fileId,
      webViewLink,
      createdAt: new Date() // bisa pakai serverTimestamp(), tapi untuk sort real-time sudah cukup
    });

    entryForm.reset();
    toast('Entri tersimpan (Drive) & dashboard terupdate.');
  }catch(e){
    console.error(e); toast('Gagal menyimpan. Coba lagi.');
  }
});

// Delete & Replace
async function deleteRecord(entryId, fileId){
  if(!confirm('Hapus entri ini?')) return;
  try{
    await deleteDoc(doc(db, 'users', currentUser.uid, 'entries', entryId));
    if(fileId) await deleteFromDrive(fileId);
    toast('Entri dihapus.');
    pdfFrame.src = ''; pdfFrame.hidden = true; pdfEmpty.hidden = false;
  }catch(e){
    console.error(e); toast('Gagal menghapus entri.');
  }
}

function replacePdfForRecord(entryId, oldFileId){
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/pdf';
  input.onchange = async ()=>{
    const file = input.files[0];
    if(!file) return;
    if(file.type !== 'application/pdf'){ toast('File harus PDF.'); return; }
    try{
      const { fileId } = await uploadToDrive(file);
      await updateDoc(doc(db, 'users', currentUser.uid, 'entries', entryId), { fileId });
      if(oldFileId) try{ await deleteFromDrive(oldFileId); }catch(_){}
      showPdf(fileId);
      toast('PDF berhasil diganti.');
    }catch(e){
      console.error(e); toast('Gagal mengganti PDF.');
    }
  };
  input.click();
}

// Progress semua pegawai
function renderAllPegawaiProgress(){
  allPegawaiList.innerHTML = '';
  if(!profilesCache.length){
    const empty = document.createElement('div');
    empty.className = 'hint'; empty.textContent = 'Belum ada data pegawai.';
    allPegawaiList.appendChild(empty); return;
  }
  profilesCache.forEach(p=>{
    const total = Number(p.totalJP || 0);
    const pct = Math.min(100, Math.round((total / TARGET_JP) * 100));
    const item = document.createElement('div'); item.className = 'pegawai-item';
    const nm = document.createElement('div'); nm.className = 'pegawai-name'; nm.textContent = p.name || p.uid;
    const prog = document.createElement('div'); prog.className = 'progress';
    const bar = document.createElement('span'); bar.style.width = pct + '%'; prog.appendChild(bar);
    const val = document.createElement('div'); val.style.textAlign = 'right'; val.innerHTML = `<strong>${total}</strong> / ${TARGET_JP} JP`;
    item.append(nm, prog, val);
    allPegawaiList.appendChild(item);
  });
}
